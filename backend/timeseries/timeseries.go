package timeseries

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
	"sort"
)

func GetTotalFileLength(filePaths []string) (int64, error) {
	var totalLength int64

	for _, filePath := range filePaths {
		fileInfo, err := os.Stat(filePath)
		if err != nil {
			return 0, fmt.Errorf("error getting file info: %v", err)
		}
		totalLength += fileInfo.Size() / 4 // Assuming 4 bytes per float32
	}

	return totalLength, nil
}

func ReadAndDownsample(filePaths []string, startIndex, endIndex, decimationFactor int) ([]FileData, error) {
	result := make([]FileData, len(filePaths))

	// Calculate points in view
	pointsInView := endIndex - startIndex

	// Target resolution based on typical screen width
	const targetResolution = 2000 // Points per screen width

	// Calculate optimal bin size
	binSize := int(math.Ceil(float64(pointsInView) / float64(targetResolution)))
	if binSize < 1 {
		binSize = 1
	}

	for i, filePath := range filePaths {
		times, values, err := readBinaryFile(filePath, startIndex, endIndex)
		if err != nil {
			return nil, err
		}

		// Apply dynamic extrema-preserving downsampling
		if binSize > 1 {
			times, values = dynamicDownsample(times, values, binSize)
		}

		result[i] = FileData{
			Times:  times,
			Values: values,
		}
	}

	return result, nil
}

type FileData struct {
	Times  []float64 `json:"times"`
	Values []float64 `json:"values"`
}

func readBinaryFile(filePath string, startIndex, endIndex int) ([]float64, []float64, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, nil, err
	}
	defer file.Close()

	fileInfo, err := file.Stat()
	if err != nil {
		return nil, nil, err
	}

	totalPoints := int(fileInfo.Size()) / 4 // Assuming 4 bytes per float32

	// Validate indices
	if startIndex < 0 {
		startIndex = 0
	}
	if endIndex <= 0 || endIndex > totalPoints {
		endIndex = totalPoints
	}
	if startIndex >= endIndex {
		return nil, nil, fmt.Errorf("invalid index range: start=%d, end=%d", startIndex, endIndex)
	}

	pointsToRead := endIndex - startIndex
	times := make([]float64, pointsToRead)
	values := make([]float64, pointsToRead)

	// Ensure we don't seek beyond file boundaries
	seekPos := int64(startIndex * 4)
	if seekPos >= fileInfo.Size() {
		return nil, nil, fmt.Errorf("seek position beyond file size")
	}

	_, err = file.Seek(seekPos, 0)
	if err != nil {
		return nil, nil, fmt.Errorf("seek error: %v", err)
	}

	data := make([]byte, pointsToRead*4)
	n, err := file.Read(data)
	if err != nil && err != io.EOF {
		return nil, nil, err
	}

	// Adjust pointsToRead if we read less than expected
	actualPoints := n / 4
	if actualPoints < pointsToRead {
		pointsToRead = actualPoints
		times = times[:actualPoints]
		values = values[:actualPoints]
	}

	for i := 0; i < pointsToRead; i++ {
		value := math.Float32frombits(binary.LittleEndian.Uint32(data[i*4 : (i+1)*4]))
		times[i] = float64(startIndex + i)
		values[i] = float64(value)
	}

	return times, values, nil
}

// Helper function to get next power of 2
func nextPowerOfTwo(v int) int {
	v--
	v |= v >> 1
	v |= v >> 2
	v |= v >> 4
	v |= v >> 8
	v |= v >> 16
	v++
	return v
}

func dynamicDownsample(times, values []float64, binSize int) ([]float64, []float64) {
	length := len(times)
	if length <= 2 || binSize <= 1 {
		return times, values
	}

	// Pre-allocate slices with estimated capacity
	estimatedPoints := (length / binSize) * 3 // 3 points per bin (min, max, avg)
	downsampledTimes := make([]float64, 0, estimatedPoints)
	downsampledValues := make([]float64, 0, estimatedPoints)

	// Process each bin
	for start := 0; start < length; start += binSize {
		end := start + binSize
		if end > length {
			end = length
		}

		// Skip empty bins
		if start == end {
			continue
		}

		// Find extrema in the bin
		minVal, maxVal := values[start], values[start]
		minIdx, maxIdx := start, start
		sum := values[start]
		count := 1

		for j := start + 1; j < end; j++ {
			val := values[j]
			sum += val
			count++

			if val < minVal {
				minVal = val
				minIdx = j
			}
			if val > maxVal {
				maxVal = val
				maxIdx = j
			}
		}

		// Calculate average for the bin
		avg := sum / float64(count)
		avgTime := (times[start] + times[end-1]) / 2

		// Add points in chronological order
		indices := make([]int, 0, 3)
		if minIdx != start && maxIdx != start {
			indices = append(indices, start) // First point
		}

		// Add extrema points if they're significant
		threshold := 0.05 * math.Abs(maxVal-minVal) // 5% of range

		if minIdx != start && math.Abs(minVal-avg) > threshold {
			indices = append(indices, minIdx)
		}
		if maxIdx != start && maxIdx != minIdx && math.Abs(maxVal-avg) > threshold {
			indices = append(indices, maxIdx)
		}

		// Sort indices to maintain chronological order
		sort.Ints(indices)

		// Add points
		for _, idx := range indices {
			downsampledTimes = append(downsampledTimes, times[idx])
			downsampledValues = append(downsampledValues, values[idx])
		}

		// Add average point for smooth appearance if we have space between points
		if len(indices) > 0 && avgTime > times[indices[len(indices)-1]] {
			downsampledTimes = append(downsampledTimes, avgTime)
			downsampledValues = append(downsampledValues, avg)
		}
	}

	return downsampledTimes, downsampledValues
}

// ReadBinaryFile reads a binary file and returns its contents as float64 slice
func ReadBinaryFile(path string) ([]float64, error) {
	file, err := os.OpenFile(path, os.O_RDONLY, 0644)
	if err != nil {
		return nil, fmt.Errorf("error opening file: %v", err)
	}
	defer file.Close()

	// Get file size
	info, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("error getting file info: %v", err)
	}

	// Read file contents
	data := make([]float64, info.Size()/8) // 8 bytes per float64
	err = binary.Read(file, binary.LittleEndian, &data)
	if err != nil {
		return nil, fmt.Errorf("error reading file: %v", err)
	}

	return data, nil
}
