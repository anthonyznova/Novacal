package fft

import (
	"fmt"
	"log"
	"math"
	"math/cmplx"
	"sort"

	"gonum.org/v1/gonum/dsp/fourier"
)

const (
	MinMagnitude = -120.0
)

type FFTResult struct {
	Frequencies []float64   `json:"frequencies"`
	Magnitudes  []float64   `json:"magnitudes"`
	Harmonics   [][]float64 `json:"harmonics"`
	SampleRate  float64     `json:"sampleRate"`
}

func ComputeFFT(data []float64, sampleRate float64) (*FFTResult, error) {
	// Validate input data
	if len(data) == 0 {
		return nil, fmt.Errorf("empty input data")
	}

	// Use larger FFT size for better low-frequency resolution
	fftSize := 65536
	log.Printf("Using %d points for FFT", fftSize)

	// Initialize FFT
	fft := fourier.NewFFT(fftSize)

	// Normalize input data
	maxAbs := 0.0
	mean := 0.0
	for _, v := range data {
		mean += v
		if abs := math.Abs(v); abs > maxAbs {
			maxAbs = abs
		}
	}
	mean /= float64(len(data))

	// Store original scale for later
	scale := maxAbs

	// Prepare input data with proper scaling
	input := make([]float64, fftSize)
	for i := 0; i < fftSize && i < len(data); i++ {
		// Center and normalize, but don't scale to unit amplitude
		input[i] = data[i] - mean
	}

	// Apply Blackman window
	windowSum := 0.0
	for i := range input {
		// Blackman window coefficients
		a0, a1, a2 := 0.42, 0.5, 0.08
		t := float64(i) / float64(fftSize-1)
		window := a0 - a1*math.Cos(2*math.Pi*t) + a2*math.Cos(4*math.Pi*t)
		input[i] *= window
		windowSum += window
	}

	// Compute FFT
	coeffs := fft.Coefficients(nil, input)

	// Process only up to Nyquist frequency
	numFreqs := fftSize/2 + 1
	frequencies := make([]float64, numFreqs)
	magnitudes := make([]float64, numFreqs)

	// Window correction factor
	windowCorrection := float64(fftSize) / windowSum

	// Calculate magnitudes with proper scaling
	for i := 0; i < numFreqs; i++ {
		// Use fft.Freq to get correct frequency mapping
		frequencies[i] = fft.Freq(i) * (sampleRate / 2)
		magnitude := cmplx.Abs(coeffs[i])

		// Apply proper scaling:
		// 1. Window correction
		// 2. FFT size normalization
		// 3. Single-sided spectrum compensation
		magnitude *= windowCorrection / float64(fftSize)
		if i > 0 && i < numFreqs-1 {
			magnitude *= 2 // Compensate for single-sided spectrum
		}

		// Convert to dB, preserving original signal scale
		power := magnitude * scale
		if power > 0 {
			magnitudes[i] = 20 * math.Log10(power)
		} else {
			magnitudes[i] = MinMagnitude
		}
	}

	return &FFTResult{
		Frequencies: frequencies,
		Magnitudes:  magnitudes,
		Harmonics:   [][]float64{},
		SampleRate:  sampleRate,
	}, nil
}

func findPeaksWithFundamental(frequencies, magnitudes []float64) [][]float64 {
	var peaks [][]float64

	// Find max magnitude
	maxMag := MinMagnitude
	for _, mag := range magnitudes {
		if mag > maxMag {
			maxMag = mag
		}
	}

	threshold := maxMag - 60 // Lower threshold to catch fundamental

	// First pass: find all significant peaks
	for i := 2; i < len(magnitudes)-2; i++ {
		// Skip very low frequencies (< 50 Hz)
		if frequencies[i] < 50 {
			continue
		}

		if magnitudes[i] > threshold &&
			magnitudes[i] > magnitudes[i-2] &&
			magnitudes[i] > magnitudes[i-1] &&
			magnitudes[i] > magnitudes[i+1] &&
			magnitudes[i] > magnitudes[i+2] {

			// Look for peaks that could be harmonics of ~1000Hz
			freq := frequencies[i]
			if freq > 500 && freq < 25000 { // Reasonable frequency range
				peaks = append(peaks, []float64{freq, magnitudes[i]})
			}
		}
	}

	// Sort by magnitude
	sort.Slice(peaks, func(i, j int) bool {
		return peaks[i][1] > peaks[j][1]
	})

	if len(peaks) > 10 {
		peaks = peaks[:10]
	}

	return peaks
}

// Approximate bessel0 function for Kaiser window
func bessel0(x float64) float64 {
	sum, term := 1.0, 1.0
	for i := 1; i <= 20; i++ {
		term *= (x * x) / (4.0 * float64(i) * float64(i))
		sum += term
	}
	return sum
}
