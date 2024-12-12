import { calibrationStore } from './calibrationStore.js';

class PlotManager {
    constructor() {
        this.plot = null;
        this.currentFiles = [];
        this.ws = null;
        this.isConnected = false;
        this.decimationFactor = 1;
        this.sampleRate = 51200;
        this.colors = [
            '#4365E0',  // Strong blue
            '#FF5733',  // Vibrant orange
            '#33B034',  // Forest green
            '#E02D44',  // Ruby red
            '#7D3CE0',  // Royal purple
            '#E07F3C',  // Burnt orange
            '#2DCCFF',  // Sky blue
            '#808080'   // Neutral gray
        ];
        this.connectWebSocket();

        // Add listener for calibration results
        calibrationStore.addListener(results => this.plotCalibrationResults(results));
    }

    connectWebSocket() {
        this.ws = new WebSocket('ws://localhost:8080/ws');

        this.ws.onopen = () => {
            console.log('Connected to backend');
            this.isConnected = true;
        };

        this.ws.onclose = () => {
            console.log('Connection closed. Attempting to reconnect...');
            this.isConnected = false;
            setTimeout(() => this.connectWebSocket(), 2000);
        };

        this.ws.onmessage = (event) => this.handleWebSocketMessage(event);
    }

    handleWebSocketMessage(event) {
        try {
            const data = JSON.parse(event.data);
            console.log('PlotManager received WebSocket message:', data.type); // Debug log
            
            switch (data.type) {
                case 'plotData':
                    this.updatePlot(data);
                    break;
                case 'totalLength':
                    this.handleTotalLength(data.totalLength);
                    break;
                case 'calibrationComplete':
                    console.log('PlotManager: Received calibration results:', data.results); // Debug log
                    if (data.results) {
                        if (!this.plot) {
                            this.setupPlot('plotContainer');
                        }
                        this.plotCalibrationResults(data.results);
                    }
                    break;
                case 'error':
                    console.error('Backend error:', data.message);
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    }

    handleTotalLength(totalLength) {
        this.requestPlotData(0, totalLength);
    }

    setupPlot(containerId) {
        const layout = {
            autosize: true,
            margin: { t: 20, r: 20, b: 40, l: 60 },
            xaxis: {
                title: 'Time (s)',
                showgrid: true,
                zeroline: true,
                zerolinecolor: '#969696',
                gridcolor: '#E1E1E1'
            },
            yaxis: {
                title: 'Value',
                showgrid: true,
                zeroline: true,
                zerolinecolor: '#969696',
                gridcolor: '#E1E1E1'
            },
            showlegend: true,
            plot_bgcolor: '#FFFFFF',
            paper_bgcolor: '#FFFFFF'
        };

        const config = {
            responsive: true,
            scrollZoom: false,
            displayModeBar: true,
            modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'],
            displaylogo: false,
            doubleClick: false
        };

        Plotly.newPlot(containerId, [], layout, config);
        this.plot = document.getElementById(containerId);

        this.plot.on('plotly_doubleclick', () => {
            if (this.currentFiles.length > 0) {
                // Store current files
                const files = [...this.currentFiles];
                
                // Clear everything
                this.clear();
                
                // Wait for clear to complete
                setTimeout(() => {
                    // Request fresh plot with full data range
                    this.plotFiles(files);
                }, 0);
            }
        });

        this.plot.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            if (!this.plot.layout.xaxis.range) return;

            const layout = this.plot.layout;
            const xrange = layout.xaxis.range;
            const yrange = layout.yaxis.range;
            
            const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;

            if (e.ctrlKey) {
                const yMax = Math.max(Math.abs(yrange[0]), Math.abs(yrange[1]));
                Plotly.relayout(this.plot, {
                    'yaxis.range': [-yMax * zoomFactor, yMax * zoomFactor]
                });
            } else {
                const rect = this.plot.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const xFraction = (x - rect.left) / rect.width;
                const xCenter = xrange[0] + (xrange[1] - xrange[0]) * xFraction;
                
                let newXRange = [
                    xCenter - (xCenter - xrange[0]) * zoomFactor,
                    xCenter + (xrange[1] - xCenter) * zoomFactor
                ];

                // Prevent negative time values
                if (newXRange[0] < 0) {
                    newXRange[0] = 0;
                    // Adjust the right bound to maintain zoom level
                    newXRange[1] = newXRange[1] - newXRange[0];
                }

                Plotly.relayout(this.plot, {
                    'xaxis.range': newXRange
                });
            }
        }, { passive: false });

        this.plot.on('plotly_relayout', (eventData) => {
            if (!this.plot.layout.xaxis.range) return;

            let xRange = this.plot.layout.xaxis.range;
            
            if (xRange[0] < 0) {
                xRange[0] = 0;
                Plotly.relayout(this.plot, {'xaxis.range[0]': 0});
            }

            const timeSpan = xRange[1] - xRange[0];
            const startIndex = Math.max(0, Math.floor(xRange[0] * this.sampleRate));
            const endIndex = Math.ceil(xRange[1] * this.sampleRate);
            const pointsInView = endIndex - startIndex;

            // Store current marker state
            this.showMarkers = timeSpan < 0.01 && pointsInView < 1000;

            if (startIndex >= 0 && endIndex > startIndex) {
                this.requestPlotData(startIndex, endIndex);
            }
        });
    }

    requestPlotData(startIndex, endIndex) {
        if (!this.isConnected || !this.currentFiles.length) return;

        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout);
        }

        this.updateTimeout = setTimeout(() => {
            const pointsInView = endIndex - startIndex;
            const screenWidth = this.plot.clientWidth;
            this.decimationFactor = Math.max(1, Math.floor(pointsInView / (screenWidth * 2)));

            this.ws.send(JSON.stringify({
                type: 'plot',
                files: this.currentFiles,
                startIndex: startIndex,
                endIndex: endIndex,
                decimationFactor: this.decimationFactor
            }));
        }, 50);
    }

    updatePlot(data) {
        const traces = [];
        
        data.files.forEach((file, index) => {
            const times = file.times.map(t => t / this.sampleRate);
            
            traces.push({
                x: times,
                y: file.values,
                type: 'scattergl',
                mode: 'lines',
                line: { 
                    width: 1.5,
                    color: this.colors[index % this.colors.length]
                },
                name: `Channel ${index + 1}`,
                hoverinfo: 'x+y'
            });
        });

        Plotly.react(this.plot, traces, this.plot.layout);
    }

    plotFiles(files) {
        if (!files.length || !this.isConnected) return;

        this.currentFiles = files;
        
        if (!this.plot) {
            this.setupPlot('plotContainer');
        }

        this.ws.send(JSON.stringify({
            type: 'getTotalLength',
            files: files
        }));
    }

    clear() {
        // Clear the plot container
        const plotContainer = document.getElementById('plotContainer');
        if (plotContainer) {
            Plotly.purge(plotContainer);
            while (plotContainer.firstChild) {
                plotContainer.removeChild(plotContainer.firstChild);
            }
        }
        
        // Reset plot manager state
        this.plot = null;
        this.currentFiles = [];
        this.showMarkers = false;
    }

    plotCalibrationResults(results) {
        console.log('Attempting to plot calibration results:', results); // Debug log
        if (!results || !results['Coil 1']) {
            console.error('Invalid calibration results:', results);
            return;
        }

        if (!this.plot) {
            console.log('Setting up plot container');
            this.setupPlot('plotContainer');
        }

        const coilData = results['Coil 1'];
        console.log('Plotting data:', coilData); // Debug log

        // Create traces for amplitude and phase
        const traces = [
            {
                x: coilData.Frequencies,
                y: coilData.Amplitudes,
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Amplitude',
                yaxis: 'y1',
                line: { color: 'red' }
            },
            {
                x: coilData.Frequencies,
                y: coilData.Phases,
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Phase',
                yaxis: 'y2',
                line: { color: 'blue' }
            }
        ];

        const layout = {
            title: 'Calibration Results',
            showlegend: true,
            grid: {
                rows: 2,
                columns: 1,
                pattern: 'independent'
            },
            xaxis: {
                title: 'Frequency (Hz)',
                type: 'log',
                showgrid: true,
                domain: [0, 0.9]
            },
            yaxis: {
                title: 'Amplitude (dB)',
                showgrid: true,
                domain: [0.55, 1]
            },
            xaxis2: {
                title: 'Frequency (Hz)',
                type: 'log',
                showgrid: true,
                domain: [0, 0.9]
            },
            yaxis2: {
                title: 'Phase (degrees)',
                showgrid: true,
                domain: [0, 0.45]
            },
            height: 800,
            margin: {
                l: 60,
                r: 30,
                t: 30,
                b: 60
            }
        };

        const config = {
            responsive: true,
            displayModeBar: true,
            displaylogo: false
        };

        Plotly.newPlot(this.plot, traces, layout, config);
    }

    plotFFTResults(results) {
        if (!results || typeof results !== 'object') {
            console.error('Invalid FFT results:', results);
            return;
        }

        console.log('Raw FFT results:', JSON.stringify(results, null, 2));

        const plotContainer = document.getElementById('plotContainer');
        const traces = [];
        
        const fftData = results.data || results;
        console.log('Processing FFT data:', {
            hasData: 'data' in results,
            dataType: typeof fftData,
            isObject: typeof fftData === 'object',
            keys: Object.keys(fftData)
        });

        const validResults = Object.entries(fftData).filter(([_, result]) => {
            console.log('Checking result structure:', {
                hasFrequencies: Array.isArray(result?.frequencies),
                hasMagnitudes: Array.isArray(result?.magnitudes),
                hasHarmonics: Array.isArray(result?.harmonics),
                frequenciesLength: result?.frequencies?.length,
                magnitudesLength: result?.magnitudes?.length,
                harmonicsLength: result?.harmonics?.length
            });
            return result && 
                Array.isArray(result.frequencies) && 
                Array.isArray(result.magnitudes) && 
                Array.isArray(result.harmonics);
        });

        if (validResults.length === 0) {
            console.error('No valid FFT data to plot. Results validation failed.');
            return;
        }

        validResults.forEach(([filename, result]) => {
            console.log(`Creating trace for ${filename} with ${result.frequencies.length} points`);
            // Plot main FFT only
            traces.push({
                x: result.frequencies,
                y: result.magnitudes,
                type: 'scatter',
                mode: 'lines',
                name: filename,
                line: { color: 'black' }
            });
        });

        if (traces.length === 0) {
            console.error('No valid traces to plot');
            return;
        }

        console.log(`Created ${traces.length} traces for plotting`);

        const layout = {
            title: 'FFT',
            showlegend: false,
            xaxis: {
                title: 'Frequency (Hz)',
                type: 'log',
                showgrid: true,
                gridcolor: '#E1E1E1'
            },
            yaxis: {
                title: 'Magnitude (dB)',
                showgrid: true,
                gridcolor: '#E1E1E1'
            },
            plot_bgcolor: '#FFFFFF',
            paper_bgcolor: '#FFFFFF'
        };

        Plotly.newPlot(plotContainer, traces, layout, {
            displayModeBar: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'],
            responsive: true
        });
    }
}

export const plotManager = new PlotManager();
export default plotManager;