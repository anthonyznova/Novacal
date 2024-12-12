package fir

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
)

// ProcessFIRResult holds all return values from ProcessFIR
type ProcessFIRResult struct {
	FIRCoefficients []float64
	FilteredSignal  []float64
	StackedWaveform []float64
	PerfectSquare   []float64
}

// FIRConfig holds the configuration for FIR filter generation
type FIRConfig struct {
	FilePath      string  `json:"filePath"`
	CoilName      string  `json:"coilName"`
	SampleRate    float64 `json:"sampleRate"`
	BaseFrequency float64 `json:"baseFrequency"`
	Stabilization float64 `json:"stabilization"`
}

// ProcessFIR processes the FIR filter on binary data
func ProcessFIR(config FIRConfig, progressCallback func(int)) (*ProcessFIRResult, error) {
	// Read and parse binary data - only read first few cycles worth of data
	samplesPerCycle := int(config.SampleRate / config.BaseFrequency)
	samplesToRead := samplesPerCycle * 10 // Read 10 cycles worth of data

	data, err := readPartialBinaryFile(config.FilePath, samplesToRead)
	if err != nil {
		return nil, err
	}
	progressCallback(20)

	// Process signals with progress updates
	nSamples := 2048
	stackedCoil := stackAndResample(data, config.SampleRate, config.BaseFrequency, nSamples)
	progressCallback(40)

	perfectSquare := generatePerfectSquareWave(stackedCoil)
	progressCallback(60)

	// Calculate FIR coefficients and apply filter
	firCoefficients := regularizedLeastSquares(stackedCoil, perfectSquare, config.Stabilization)
	progressCallback(80)

	filteredSignal := applyFIRFilter(stackedCoil, firCoefficients)
	progressCallback(100)

	// Create results directory
	resultsDir := filepath.Join(filepath.Dir(config.FilePath), "fir_results")
	if err := os.MkdirAll(resultsDir, 0755); err != nil {
		return nil, fmt.Errorf("error creating results directory: %v", err)
	}

	return &ProcessFIRResult{
		FIRCoefficients: firCoefficients,
		FilteredSignal:  filteredSignal,
		StackedWaveform: stackedCoil,
		PerfectSquare:   perfectSquare,
	}, nil
}

// Add this new function to read only part of the file
func readPartialBinaryFile(filePath string, numSamples int) ([]float64, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	// Read only the bytes we need (4 bytes per float32)
	bytesToRead := numSamples * 4
	buffer := make([]byte, bytesToRead)

	n, err := file.Read(buffer)
	if err != nil && err != io.EOF {
		return nil, err
	}

	// Convert bytes to float64
	samples := n / 4
	data := make([]float64, samples)
	for i := 0; i < samples; i++ {
		bits := binary.LittleEndian.Uint32(buffer[i*4 : (i+1)*4])
		data[i] = float64(math.Float32frombits(bits))
	}

	return data, nil
}

func stackAndResample(data []float64, sampleRate, waveFrequency float64, nSamples int) []float64 {
	samplesPerCycle := int(sampleRate / waveFrequency)

	// Add safety check for data length
	if len(data) < samplesPerCycle*2 {
		// If we don't have enough data for 2 cycles, return what we have resampled
		return resample(data, nSamples)
	}

	// Find mean for zero crossings
	mean := calculateMean(data)

	// Only look for zero crossings in first few cycles
	searchLength := min(len(data), samplesPerCycle*4)
	zeroCrossings := findZeroCrossings(data[:searchLength], mean)

	// If we can't find zero crossings, just use fixed intervals
	if len(zeroCrossings) < 2 {
		// Just take first cycle worth of data
		if len(data) > samplesPerCycle {
			data = data[:samplesPerCycle]
		}
		return resample(data, nSamples)
	}

	// Stack a maximum of 5 cycles
	maxCycles := 5
	var stackedCycles [][]float64

	for i := 0; i < len(zeroCrossings)-1 && len(stackedCycles) < maxCycles; i += 2 {
		start := zeroCrossings[i]
		end := start + samplesPerCycle

		if end > len(data) {
			break
		}

		cycle := make([]float64, samplesPerCycle)
		copy(cycle, data[start:end])
		stackedCycles = append(stackedCycles, cycle)
	}

	// If we couldn't stack any cycles, return resampled input
	if len(stackedCycles) == 0 {
		if len(data) > samplesPerCycle {
			data = data[:samplesPerCycle]
		}
		return resample(data, nSamples)
	}

	// Average cycles
	avgCycle := make([]float64, samplesPerCycle)
	for i := 0; i < samplesPerCycle; i++ {
		sum := 0.0
		for j := 0; j < len(stackedCycles); j++ {
			sum += stackedCycles[j][i]
		}
		avgCycle[i] = sum / float64(len(stackedCycles))
	}

	// Resample to nSamples
	return resample(avgCycle, nSamples)
}

func generatePerfectSquareWave(signal []float64) []float64 {
	n := len(signal)
	mean := calculateMean(signal)

	// Determine if first half is high or low
	firstHalfMean := calculateMean(signal[:n/2])
	isFirstHalfHigh := firstHalfMean > mean

	// Get high and low values
	var highValue, lowValue float64
	var highCount, lowCount int

	for _, v := range signal {
		if v > mean {
			highValue += v
			highCount++
		} else {
			lowValue += v
			lowCount++
		}
	}

	highValue /= float64(highCount)
	lowValue /= float64(lowCount)

	// Create square wave
	result := make([]float64, n)
	if isFirstHalfHigh {
		for i := 0; i < n/2; i++ {
			result[i] = highValue
		}
		for i := n / 2; i < n; i++ {
			result[i] = lowValue
		}
	} else {
		for i := 0; i < n/2; i++ {
			result[i] = lowValue
		}
		for i := n / 2; i < n; i++ {
			result[i] = highValue
		}
	}

	return result
}

func regularizedLeastSquares(imperfect, perfect []float64, regParam float64) []float64 {
	n := len(imperfect)

	// Create Toeplitz matrix
	A := make([][]float64, n)
	for i := range A {
		A[i] = roll(imperfect, i)
	}

	// Compute A^T * A and A^T * b
	ATA := matrixMultiply(transposeMatrix(A), A)
	ATb := matrixVectorMultiply(transposeMatrix(A), perfect)

	// Add regularization
	diagMean := 0.0
	for i := 0; i < n; i++ {
		diagMean += ATA[i][i]
	}
	diagMean /= float64(n)

	for i := 0; i < n; i++ {
		ATA[i][i] += diagMean * regParam
	}

	// Solve system using Gaussian elimination
	return solveLinearSystem(ATA, ATb)
}

func applyFIRFilter(signal, coeffs []float64) []float64 {
	N := len(signal)
	filtered := make([]float64, N)

	for i := 0; i < N; i++ {
		rolled := roll(signal, i)
		filtered[i] = dotProduct(coeffs, rolled)
	}

	return filtered
}

// Helper functions
func calculateMean(data []float64) float64 {
	sum := 0.0
	for _, v := range data {
		sum += v
	}
	return sum / float64(len(data))
}

func findZeroCrossings(data []float64, mean float64) []int {
	var crossings []int
	for i := 0; i < len(data)-1; i++ {
		if (data[i]-mean)*(data[i+1]-mean) < 0 {
			crossings = append(crossings, i)
		}
	}
	return crossings
}

func resample(data []float64, newLen int) []float64 {
	result := make([]float64, newLen)
	ratio := float64(len(data)-1) / float64(newLen-1)

	for i := 0; i < newLen; i++ {
		pos := float64(i) * ratio
		idx := int(pos)
		frac := pos - float64(idx)

		if idx+1 < len(data) {
			result[i] = data[idx]*(1-frac) + data[idx+1]*frac
		} else {
			result[i] = data[idx]
		}
	}
	return result
}

func roll(data []float64, shift int) []float64 {
	n := len(data)
	result := make([]float64, n)
	for i := 0; i < n; i++ {
		result[i] = data[(i+shift)%n]
	}
	return result
}

func dotProduct(a, b []float64) float64 {
	sum := 0.0
	for i := range a {
		sum += a[i] * b[i]
	}
	return sum
}

// Matrix operations
func transposeMatrix(m [][]float64) [][]float64 {
	rows := len(m)
	cols := len(m[0])
	result := make([][]float64, cols)
	for i := range result {
		result[i] = make([]float64, rows)
	}
	for i := 0; i < rows; i++ {
		for j := 0; j < cols; j++ {
			result[j][i] = m[i][j]
		}
	}
	return result
}

func matrixMultiply(a, b [][]float64) [][]float64 {
	rows := len(a)
	cols := len(b[0])
	result := make([][]float64, rows)
	for i := range result {
		result[i] = make([]float64, cols)
		for j := 0; j < cols; j++ {
			sum := 0.0
			for k := 0; k < len(b); k++ {
				sum += a[i][k] * b[k][j]
			}
			result[i][j] = sum
		}
	}
	return result
}

func matrixVectorMultiply(m [][]float64, v []float64) []float64 {
	result := make([]float64, len(m))
	for i := range m {
		sum := 0.0
		for j := range m[i] {
			sum += m[i][j] * v[j]
		}
		result[i] = sum
	}
	return result
}

func solveLinearSystem(A [][]float64, b []float64) []float64 {
	n := len(A)
	x := make([]float64, n)

	// Forward elimination
	for i := 0; i < n; i++ {
		pivot := A[i][i]
		for j := i; j < n; j++ {
			A[i][j] /= pivot
		}
		b[i] /= pivot

		for k := i + 1; k < n; k++ {
			factor := A[k][i]
			for j := i; j < n; j++ {
				A[k][j] -= factor * A[i][j]
			}
			b[k] -= factor * b[i]
		}
	}

	// Back substitution
	for i := n - 1; i >= 0; i-- {
		x[i] = b[i]
		for j := i + 1; j < n; j++ {
			x[i] -= A[i][j] * x[j]
		}
	}

	return x
}

// Add helper function
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
