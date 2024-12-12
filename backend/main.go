package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	fft "novacal/FFT"
	"novacal/calibration"
	"novacal/fir"
	"novacal/timeseries"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type Message struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type DirectoryRequest struct {
	Type string `json:"type"`
	Path string `json:"path"`
}

type FileInfo struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"isDir"`
}

type DirectoryResponse struct {
	Type  string     `json:"type"`
	Files []FileInfo `json:"files"`
}

type PlotRequest struct {
	Type             string   `json:"type"`
	Files            []string `json:"files"`
	StartIndex       int      `json:"startIndex"`
	EndIndex         int      `json:"endIndex"`
	DecimationFactor int      `json:"decimationFactor"`
}

// Add these constants at the top
const (
	maxSamples = 1000000 // Maximum number of samples to process at once
	bufferSize = 4096    // Size of read buffer
)

// Add a mutex to protect WebSocket writes
var wsWriteMutex sync.Mutex

// Create a safe write method
func safeWriteJSON(conn *websocket.Conn, v interface{}) error {
	wsWriteMutex.Lock()
	defer wsWriteMutex.Unlock()
	return conn.WriteJSON(v)
}

// findAvailablePort tries to find an available port starting from the given port
func findAvailablePort(startPort int) (int, error) {
	for port := startPort; port < startPort+100; port++ {
		addr := fmt.Sprintf(":%d", port)
		listener, err := net.Listen("tcp", addr)
		if err != nil {
			continue
		}
		listener.Close()
		return port, nil
	}
	return 0, fmt.Errorf("no available ports found between %d and %d", startPort, startPort+100)
}

func main() {
	// Try to find an available port starting from 8080
	port, err := findAvailablePort(8080)
	if err != nil {
		log.Fatal("Could not find available port:", err)
	}

	addr := fmt.Sprintf(":%d", port)
	log.Printf("Starting Go backend server on http://localhost%s", addr)

	http.HandleFunc("/ws", handleWebSocket)
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatal("Server error:", err)
	}
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Upgrade error:", err)
		return
	}
	defer conn.Close()

	log.Println("New client connected")

	for {
		messageType, message, err := conn.ReadMessage()
		if err != nil {
			log.Println("Read error:", err)
			break
		}

		handleMessage(conn, messageType, message)
	}
}

func handleMessage(conn *websocket.Conn, messageType int, message []byte) {
	var msg struct {
		Type  string   `json:"type"`
		Files []string `json:"files"`
		Path  string   `json:"path"`
	}

	if err := json.Unmarshal(message, &msg); err != nil {
		log.Println("Error parsing message:", err)
		return
	}

	switch msg.Type {
	case "listDirectory":
		files, err := listDirectory(msg.Path)
		if err != nil {
			log.Println("Error listing directory:", err)
			return
		}

		response := DirectoryResponse{
			Type:  "directoryContents",
			Files: files,
		}

		if err := safeWriteJSON(conn, response); err != nil {
			log.Println("Write error:", err)
		}
	case "plot":
		var plotReq PlotRequest
		if err := json.Unmarshal(message, &plotReq); err != nil {
			safeWriteJSON(conn, Message{
				Type:    "error",
				Message: "Invalid plot request format",
			})
			return
		}

		if len(plotReq.Files) == 0 {
			safeWriteJSON(conn, Message{
				Type:    "error",
				Message: "No files selected for plotting",
			})
			return
		}

		// Filter for .bin files
		var binFiles []string
		for _, file := range plotReq.Files {
			if filepath.Ext(file) == ".bin" {
				binFiles = append(binFiles, file)
			}
		}

		if len(binFiles) == 0 {
			safeWriteJSON(conn, Message{
				Type:    "error",
				Message: "No .bin files selected",
			})
			return
		}

		// If this is the initial plot request (startIndex and endIndex are 0)
		if plotReq.StartIndex == 0 && plotReq.EndIndex == 0 {
			// Get total length first
			totalLength, err := timeseries.GetTotalFileLength(binFiles)
			if err != nil {
				safeWriteJSON(conn, Message{
					Type:    "error",
					Message: fmt.Sprintf("Error getting file length: %v", err),
				})
				return
			}
			plotReq.EndIndex = int(totalLength)
		}

		// Read and downsample the data
		fileData, err := timeseries.ReadAndDownsample(
			binFiles,
			plotReq.StartIndex,
			plotReq.EndIndex,
			plotReq.DecimationFactor,
		)
		if err != nil {
			safeWriteJSON(conn, Message{
				Type:    "error",
				Message: fmt.Sprintf("Error reading files: %v", err),
			})
			return
		}

		// Send the plot data back to the client
		plotData := struct {
			Type  string                `json:"type"`
			Files []timeseries.FileData `json:"files"`
		}{
			Type:  "plotData",
			Files: fileData,
		}

		if err := safeWriteJSON(conn, plotData); err != nil {
			log.Println("Error sending plot data:", err)
		}
	case "getTotalLength":
		var lengthReq struct {
			Type  string   `json:"type"`
			Files []string `json:"files"`
		}
		if err := json.Unmarshal(message, &lengthReq); err != nil {
			safeWriteJSON(conn, Message{
				Type:    "error",
				Message: "Invalid length request format",
			})
			return
		}

		// Validate file paths
		validPaths, err := validateFilePaths(lengthReq.Files)
		if err != nil {
			safeWriteJSON(conn, Message{
				Type:    "error",
				Message: fmt.Sprintf("Error validating files: %v", err),
			})
			return
		}

		totalLength, err := timeseries.GetTotalFileLength(validPaths)
		if err != nil {
			safeWriteJSON(conn, Message{
				Type:    "error",
				Message: fmt.Sprintf("Error getting file length: %v", err),
			})
			return
		}

		response := struct {
			Type        string `json:"type"`
			TotalLength int64  `json:"totalLength"`
		}{
			Type:        "totalLength",
			TotalLength: totalLength,
		}

		if err := safeWriteJSON(conn, response); err != nil {
			log.Println("Write error:", err)
		}
	case "calibrate":
		var calibrationReq struct {
			Type string `json:"type"`
			Data []struct {
				Station   string  `json:"station"`
				FullPath  string  `json:"fullPath"`
				Waveform  string  `json:"waveform"`
				Frequency float64 `json:"frequency"`
				Tx        string  `json:"tx"`
				Rx        string  `json:"rx"`
				Coil      string  `json:"coil"`
			} `json:"data"`
		}

		log.Printf("Received calibration request")

		if err := json.Unmarshal(message, &calibrationReq); err != nil {
			log.Printf("Error unmarshaling calibration request: %v", err)
			safeWriteJSON(conn, Message{
				Type:    "error",
				Message: "Invalid calibration request format",
			})
			return
		}

		log.Printf("Calibration data: %+v", calibrationReq.Data)

		// Organize data for calibration
		sineFilePaths := make(map[string]map[float64]map[string]string)
		squareFilePaths := make(map[string]map[float64]map[string]string)

		for _, item := range calibrationReq.Data {
			var targetMap map[string]map[float64]map[string]string
			if item.Waveform == "Sine" {
				targetMap = sineFilePaths
			} else {
				targetMap = squareFilePaths
			}

			if _, exists := targetMap[item.Coil]; !exists {
				targetMap[item.Coil] = make(map[float64]map[string]string)
			}
			if _, exists := targetMap[item.Coil][item.Frequency]; !exists {
				targetMap[item.Coil][item.Frequency] = make(map[string]string)
			}

			targetMap[item.Coil][item.Frequency]["tx"] = item.Tx
			targetMap[item.Coil][item.Frequency]["rx"] = item.Rx
		}

		log.Printf("Running calibration with sine files: %+v and square files: %+v", sineFilePaths, squareFilePaths)

		// Create progress callback
		progressCallback := func(progress int) {
			safeWriteJSON(conn, map[string]interface{}{
				"type":     "calibrationProgress",
				"progress": progress,
			})
		}

		// Run calibration with RunCalibration instead of Calibrate
		results, err := calibration.RunCalibration(sineFilePaths, squareFilePaths, progressCallback)
		if err != nil {
			log.Printf("Calibration error: %v", err)
			safeWriteJSON(conn, Message{
				Type:    "error",
				Message: fmt.Sprintf("Calibration failed: %v", err),
			})
			return
		}

		log.Printf("Calibration completed, results: %+v", results)

		// Send the actual results
		safeWriteJSON(conn, map[string]interface{}{
			"type":    "calibrationComplete",
			"results": results,
		})
	case "checkConfig":
		var configReq struct {
			Type string `json:"type"`
			Path string `json:"path"`
		}
		if err := json.Unmarshal(message, &configReq); err != nil {
			safeWriteJSON(conn, Message{
				Type:    "error",
				Message: "Invalid config check request",
			})
			return
		}

		// Check for config.csv in the directory
		configPath := filepath.Join(configReq.Path, "config.csv")
		config, err := readConfigFile(configPath)
		if err != nil {
			log.Printf("No config file found at %s or error reading it: %v", configPath, err)
			safeWriteJSON(conn, map[string]interface{}{
				"type":    "configData",
				"station": filepath.Base(configReq.Path),
				"config":  map[string]interface{}{},
			})
			return
		}

		// Send config data back to client
		safeWriteJSON(conn, map[string]interface{}{
			"type":    "configData",
			"station": filepath.Base(configReq.Path),
			"config":  config,
		})
	case "calculateFIR":
		var firReq struct {
			Type string `json:"type"`
			Data []struct {
				Station       string  `json:"station"`
				FullPath      string  `json:"fullPath"`
				CoilName      string  `json:"coilName"`
				BaseFrequency float64 `json:"baseFrequency"`
				SampleRate    float64 `json:"sampleRate"`
				CoilChannel   string  `json:"coilChannel"`
			} `json:"data"`
		}

		if err := json.Unmarshal(message, &firReq); err != nil {
			log.Printf("Error unmarshaling FIR request: %v", err)
			safeWriteJSON(conn, Message{
				Type:    "error",
				Message: "Invalid FIR calculation request",
			})
			return
		}

		log.Printf("Processing FIR request with data: %+v", firReq.Data)

		// Process each FIR request sequentially
		for _, item := range firReq.Data {
			// Create progress callback for this item
			progressCallback := func(progress int) {
				safeWriteJSON(conn, map[string]interface{}{
					"type":     "firProgress",
					"station":  item.Station,
					"progress": progress,
				})
			}

			// Create FIR configuration from request data
			config := fir.FIRConfig{
				FilePath:      filepath.Join(item.FullPath, item.CoilChannel),
				CoilName:      item.CoilName,
				SampleRate:    item.SampleRate,
				BaseFrequency: item.BaseFrequency,
				Stabilization: 0.01, // Default stabilization value
			}

			log.Printf("Processing FIR for station %s with config: %+v", item.Station, config)

			// Process FIR with configuration and callback
			result, err := fir.ProcessFIR(config, progressCallback)
			if err != nil {
				log.Printf("Error processing FIR for %s: %v", item.Station, err)
				safeWriteJSON(conn, Message{
					Type:    "error",
					Message: fmt.Sprintf("Error processing FIR for %s: %v", item.Station, err),
				})
				continue
			}

			log.Printf("FIR processing completed for %s", item.Station)

			// Send completion message with results
			safeWriteJSON(conn, map[string]interface{}{
				"type":    "firComplete",
				"station": item.Station,
				"results": result,
				"message": fmt.Sprintf("FIR coefficients saved to %s/fir_results/fir_coefficients_%s.csv",
					item.FullPath, item.CoilName),
			})
		}
	case "exportCalibration":
		var exportReq struct {
			Type string `json:"type"`
			Data struct {
				Results    map[string]interface{} `json:"results"`
				CSVData    string                 `json:"csvData"`
				ExportPath string                 `json:"exportPath"`
			} `json:"data"`
		}
		if err := json.Unmarshal(message, &exportReq); err != nil {
			log.Printf("Error unmarshaling export request: %v", err)
			return
		}

		// Write CSV file
		csvPath := filepath.Join(exportReq.Data.ExportPath, "calibration_results.csv")
		if err := os.WriteFile(csvPath, []byte(exportReq.Data.CSVData), 0644); err != nil {
			log.Printf("Error writing CSV file: %v", err)
			return
		}

		// Save plots as PNG
		// TODO: Implement plot saving

		safeWriteJSON(conn, map[string]interface{}{
			"type": "exportComplete",
			"path": exportReq.Data.ExportPath,
		})
	case "computeFFT":
		log.Printf("Received FFT request")
		var fftReq struct {
			Type  string   `json:"type"`
			Files []string `json:"files"`
		}
		if err := json.Unmarshal(message, &fftReq); err != nil {
			log.Printf("Error unmarshaling FFT request: %v", err)
			safeWriteJSON(conn, Message{
				Type:    "error",
				Message: "Invalid FFT request format",
			})
			return
		}

		log.Printf("Computing FFT for files: %v", fftReq.Files)

		// Process each file
		results := make(map[string]*fft.FFTResult)
		for _, file := range fftReq.Files {
			data, err := timeseries.ReadBinaryFile(file)
			if err != nil {
				log.Printf("Error reading file %s: %v", file, err)
				continue
			}

			log.Printf("Read %d samples from %s", len(data), file)
			result, err := fft.ComputeFFT(data, 51200.0)
			if err != nil {
				log.Printf("Error computing FFT for file %s: %v", file, err)
				continue
			}

			log.Printf("FFT computed successfully for %s", file)
			log.Printf("FFT result contains %d frequencies and %d magnitudes",
				len(result.Frequencies), len(result.Magnitudes))
			results[filepath.Base(file)] = result
		}

		log.Printf("Sending FFT results back to client")
		// Get map keys manually
		keys := make([]string, 0, len(results))
		for k := range results {
			keys = append(keys, k)
		}
		log.Printf("Results map contains entries for: %v", strings.Join(keys, ", "))

		// Send results back
		if err := safeWriteJSON(conn, map[string]interface{}{
			"type": "fftResults",
			"data": results,
		}); err != nil {
			log.Printf("Error sending FFT results: %v", err)
			return
		}
		// Log the structure being sent
		if resultBytes, err := json.MarshalIndent(results, "", "  "); err == nil {
			log.Printf("Sent FFT results structure: %s", string(resultBytes))
		}
	case "generateFIR":
		var firReq struct {
			Type string `json:"type"`
			Data struct {
				FilePath      string  `json:"filePath"`
				CoilName      string  `json:"coilName"`
				SampleRate    float64 `json:"sampleRate"`
				BaseFrequency float64 `json:"baseFrequency"`
				Stabilization float64 `json:"stabilization"`
			} `json:"data"`
		}

		if err := json.Unmarshal(message, &firReq); err != nil {
			safeWriteJSON(conn, Message{
				Type:    "error",
				Message: "Invalid FIR request format",
			})
			return
		}

		// Create progress callback
		progressCallback := func(progress int) {
			safeWriteJSON(conn, map[string]interface{}{
				"type":     "firProgress",
				"progress": progress,
			})
		}

		// Create FIR configuration from request data
		config := fir.FIRConfig{
			FilePath:      firReq.Data.FilePath,
			CoilName:      firReq.Data.CoilName,
			SampleRate:    firReq.Data.SampleRate,
			BaseFrequency: firReq.Data.BaseFrequency,
			Stabilization: firReq.Data.Stabilization,
		}

		// Process FIR with configuration and callback
		result, err := fir.ProcessFIR(config, progressCallback)
		if err != nil {
			safeWriteJSON(conn, Message{
				Type:    "error",
				Message: fmt.Sprintf("Error processing FIR: %v", err),
			})
			return
		}

		// Send results back to client
		safeWriteJSON(conn, map[string]interface{}{
			"type":    "firResults",
			"results": result,
		})

	case "exportFIR":
		var exportReq struct {
			Type string `json:"type"`
			Data struct {
				CSVContent string `json:"csvContent"`
				ExportPath string `json:"exportPath"`
				FileName   string `json:"fileName"`
			} `json:"data"`
		}

		if err := json.Unmarshal(message, &exportReq); err != nil {
			safeWriteJSON(conn, Message{
				Type:    "error",
				Message: "Invalid export request format",
			})
			return
		}

		// Write CSV file with provided filename
		filePath := filepath.Join(exportReq.Data.ExportPath, exportReq.Data.FileName)
		if err := os.WriteFile(filePath, []byte(exportReq.Data.CSVContent), 0644); err != nil {
			safeWriteJSON(conn, Message{
				Type:    "error",
				Message: fmt.Sprintf("Error writing CSV file: %v", err),
			})
			return
		}

		safeWriteJSON(conn, map[string]interface{}{
			"type": "exportComplete",
			"path": filePath,
		})
	default:
		log.Printf("Received message: %+v\n", msg)
		response := Message{
			Type:    "response",
			Message: "Received " + msg.Type + " command",
		}
		if err := safeWriteJSON(conn, response); err != nil {
			log.Println("Write error:", err)
		}
	}
}

func listDirectory(path string) ([]FileInfo, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}

	var files []FileInfo
	for _, entry := range entries {
		fullPath := filepath.Join(path, entry.Name())
		files = append(files, FileInfo{
			Name:  entry.Name(),
			Path:  fullPath,
			IsDir: entry.IsDir(),
		})
	}
	return files, nil
}

// Add this helper function
func validateFilePaths(paths []string) ([]string, error) {
	var validPaths []string
	for _, path := range paths {
		// Check if the path is absolute, if not make it absolute
		if !filepath.IsAbs(path) {
			absPath, err := filepath.Abs(path)
			if err != nil {
				continue
			}
			path = absPath
		}

		// Verify file exists and is readable
		if _, err := os.Stat(path); err == nil {
			validPaths = append(validPaths, path)
		} else {
			log.Printf("Invalid file path: %s, error: %v", path, err)
		}
	}
	if len(validPaths) == 0 {
		return nil, fmt.Errorf("no valid files found in the provided paths")
	}
	return validPaths, nil
}

// Update the readConfigFile function
func readConfigFile(path string) (map[string]interface{}, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	// Parse CSV
	lines := strings.Split(string(data), "\n")
	if len(lines) < 2 {
		return nil, fmt.Errorf("invalid config file format")
	}

	// Parse headers and values
	headers := strings.Split(strings.TrimSpace(lines[0]), ",")
	values := strings.Split(strings.TrimSpace(lines[1]), ",")

	config := make(map[string]interface{})

	for i, header := range headers {
		if i >= len(values) {
			break
		}
		value := strings.TrimSpace(values[i])

		switch strings.ToLower(header) {
		case "name":
			config["name"] = value
		case "waveform":
			config["waveform"] = value
		case "freq":
			if f, err := strconv.ParseFloat(value, 64); err == nil {
				config["freq"] = f
			}
		case "tx":
			config["tx"] = value
		case "rx":
			config["rx"] = value
		case "coil":
			config["coil"] = value
		}
	}

	log.Printf("Parsed config: %+v", config)
	return config, nil
}

// In the calibration processing code
func processCalibrationData(files map[string]map[float64]map[string]string) (map[string]calibration.CalResults, error) {
	results := make(map[string]calibration.CalResults)

	// Use a buffer pool for file reading
	bufferPool := sync.Pool{
		New: func() interface{} {
			buffer := make([]byte, bufferSize)
			return &buffer
		},
	}

	for coilName, freqMap := range files {
		frequencies := make([]float64, 0, len(freqMap))
		amplitudes := make([]float64, 0, len(freqMap))
		phases := make([]float64, 0, len(freqMap))

		for freq, fileMap := range freqMap {
			// Get buffer from pool
			buffer := bufferPool.Get().(*[]byte)

			// Process files in chunks
			err := processFilesInChunks(fileMap["tx"], fileMap["rx"], *buffer, maxSamples, func(chunk []float64) error {
				// Process chunk here
				// ...
				return nil
			})

			// Return buffer to pool
			bufferPool.Put(buffer)

			if err != nil {
				return nil, err
			}

			frequencies = append(frequencies, freq)
			// ... append other results
		}

		results[coilName] = calibration.CalResults{
			Frequencies: frequencies,
			Amplitudes:  amplitudes,
			Phases:      phases,
		}
	}

	return results, nil
}

func processFilesInChunks(txPath, rxPath string, buffer []byte, maxSamples int, processChunk func([]float64) error) error {
	txFile, err := os.Open(txPath)
	if err != nil {
		return fmt.Errorf("error opening tx file: %v", err)
	}
	defer txFile.Close()

	rxFile, err := os.Open(rxPath)
	if err != nil {
		return fmt.Errorf("error opening rx file: %v", err)
	}
	defer rxFile.Close()

	chunkSize := len(buffer) / 8 // 8 bytes per float64
	data := make([]float64, chunkSize)

	for {
		n, err := txFile.Read(buffer)
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("error reading tx file: %v", err)
		}

		// Convert bytes to float64
		reader := bytes.NewReader(buffer[:n])
		err = binary.Read(reader, binary.LittleEndian, &data)
		if err != nil {
			return fmt.Errorf("error converting data: %v", err)
		}

		// Process chunk
		err = processChunk(data)
		if err != nil {
			return fmt.Errorf("error processing chunk: %v", err)
		}
	}

	return nil
}

// GetExecutablePath returns the correct path to the executable based on the environment
func GetExecutablePath() string {
	ex, err := os.Executable()
	if err != nil {
		log.Printf("Error getting executable path: %v", err)
		return ""
	}
	return filepath.Dir(ex)
}
