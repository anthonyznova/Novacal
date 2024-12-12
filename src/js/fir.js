import plotManager from './plotting.js';

export function setupFIRDialog(dialog) {
    const closeBtn = dialog.querySelector('.control-button.close');
    const generateBtn = document.getElementById('generateFIRBtn');
    const exportBtn = document.getElementById('exportFIRBtn');
    let firResults = null;

    // Get all input fields
    const coilNameInput = dialog.querySelector('.coil-name');
    const sampleRateInput = dialog.querySelector('.sample-rate');
    const baseFreqInput = dialog.querySelector('.base-freq');
    const stabilizationInput = dialog.querySelector('.stabilization');

    // Function to validate all inputs and enable/disable generate button
    function validateInputs() {
        const coilName = coilNameInput.value.trim();
        const sampleRate = sampleRateInput.value.trim();
        const baseFreq = baseFreqInput.value.trim();
        const stabilization = stabilizationInput.value.trim();

        // Check if any field is empty
        if (!coilName || !sampleRate || !baseFreq || !stabilization) {
            generateBtn.disabled = true;
            return false;
        }

        // Validate numeric values
        const sampleRateNum = parseFloat(sampleRate);
        const baseFreqNum = parseFloat(baseFreq);
        const stabilizationNum = parseFloat(stabilization);

        if (isNaN(sampleRateNum) || sampleRateNum <= 0 ||
            isNaN(baseFreqNum) || baseFreqNum <= 0 ||
            isNaN(stabilizationNum) || stabilizationNum <= 0) {
            generateBtn.disabled = true;
            return false;
        }

        // Enable button if all validations pass
        generateBtn.disabled = false;
        return true;
    }

    // Add input event listeners to all fields
    [coilNameInput, sampleRateInput, baseFreqInput, stabilizationInput].forEach(input => {
        input.addEventListener('input', validateInputs);
    });

    // Initial validation
    validateInputs();

    // Disable export button initially
    exportBtn.disabled = true;

    // Make dialog draggable
    const titleBar = dialog.querySelector('.title-bar');
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;

    titleBar.addEventListener('mousedown', (e) => {
        isDragging = true;
        initialX = e.clientX - dialog.offsetLeft;
        initialY = e.clientY - dialog.offsetTop;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;
        
        dialog.style.left = `${currentX}px`;
        dialog.style.top = `${currentY}px`;
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    closeBtn?.addEventListener('click', () => {
        dialog.close();
    });

    generateBtn.addEventListener('click', async () => {
        if (!validateInputs()) {
            return;
        }

        generateBtn.disabled = true;
        try {
            // Get selected .bin file from checkedPaths
            const selectedBinFiles = Array.from(window.checkedPaths.entries())
                .filter(([path]) => path.endsWith('.bin'))
                .map(([path]) => path);

            if (selectedBinFiles.length === 0) {
                alert('Please select a .bin file from the file explorer');
                return;
            }

            if (selectedBinFiles.length > 1) {
                alert('Please select only one .bin file for FIR filter generation');
                return;
            }

            // Show progress bar
            const progressBar = dialog.querySelector('.progress-bar-container');
            progressBar.style.display = 'block';

            // Send FIR request
            plotManager.ws.send(JSON.stringify({
                type: 'generateFIR',
                data: {
                    filePath: selectedBinFiles[0],
                    coilName: coilNameInput.value.trim(),
                    sampleRate: parseFloat(sampleRateInput.value),
                    baseFrequency: parseFloat(baseFreqInput.value),
                    stabilization: parseFloat(stabilizationInput.value)
                }
            }));
        } catch (error) {
            console.error('Error generating FIR:', error);
            alert('Error generating FIR filter');
        } finally {
            generateBtn.disabled = false;
        }
    });

    exportBtn.addEventListener('click', async () => {
        if (!firResults) return;

        try {
            const exportDir = await window.electron.fileSystem.selectDirectory();
            if (!exportDir) return;

            const coilName = dialog.querySelector('.coil-name').value;
            const now = new Date();
            const dateStr = now.toISOString().split('T')[0];
            const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
            const fileName = `${coilName}_${dateStr}_${timeStr}_fir_filter.csv`;

            // Format CSV content
            let csvContent = `"${coilName}"\nIndex,Coefficient\n`;
            firResults.FIRCoefficients.forEach((coeff, index) => {
                csvContent += `${index},${coeff}\n`;
            });

            // Send export request
            plotManager.ws.send(JSON.stringify({
                type: 'exportFIR',
                data: {
                    csvContent: csvContent,
                    exportPath: exportDir,
                    fileName: fileName
                }
            }));
        } catch (error) {
            console.error('Error exporting FIR results:', error);
        }
    });

    // Handle WebSocket messages
    const messageHandler = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'firResults') {
                firResults = data.results;
                // Enable export button only after successful FIR generation
                exportBtn.disabled = false;

                // Plot results
                const traces = [
                    {
                        y: data.results.StackedWaveform,
                        name: 'Stacked Waveform',
                        type: 'scatter',
                        mode: 'lines',
                        line: { color: 'blue' }
                    },
                    {
                        y: data.results.PerfectSquare,
                        name: 'Target Waveform',
                        type: 'scatter',
                        mode: 'lines',
                        line: { color: 'orange' }
                    },
                    {
                        y: data.results.FilteredSignal,
                        name: 'Filtered Waveform',
                        type: 'scatter',
                        mode: 'lines',
                        line: { color: 'green' }
                    }
                ];

                const layout = {
                    autosize: true,
                    height: document.getElementById('plotContainer').offsetHeight,
                    width: document.getElementById('plotContainer').offsetWidth,
                    showlegend: true,
                    title: {
                        text: 'FIR Filter Results',
                        y: 0.98,
                        x: 0.5,
                        xanchor: 'center',
                        yanchor: 'top'
                    },
                    margin: { t: 30, r: 10, b: 10, l: 50 },
                    plot_bgcolor: '#FFFFFF',
                    paper_bgcolor: '#FFFFFF',
                    showgrid: true
                };

                const config = {
                    responsive: true,
                    displayModeBar: true,
                    displaylogo: false,
                    modeBarButtonsToRemove: ['lasso2d', 'select2d']
                };

                Plotly.newPlot('plotContainer', traces, layout, config);

                // Hide progress bar AFTER plot is complete
                const progressBar = dialog.querySelector('.progress-bar-container');
                progressBar.style.display = 'none';
                progressBar.querySelector('.progress-text').textContent = 'Processing...';
                progressBar.querySelector('.progress-bar').style.width = '0%';

            } else if (data.type === 'firProgress') {
                const progressBar = dialog.querySelector('.progress-bar-container');
                const progressElement = progressBar.querySelector('.progress-bar');
                const progressText = progressBar.querySelector('.progress-text');
                
                progressBar.style.display = 'block';
                progressElement.style.width = `${data.progress}%`;
                progressText.textContent = `Processing... ${data.progress}%`;
            }
        } catch (error) {
            console.error('Error processing FIR message:', error);
            exportBtn.disabled = true;
            
            // Also hide progress bar on error
            const progressBar = dialog.querySelector('.progress-bar-container');
            progressBar.style.display = 'none';
            progressBar.querySelector('.progress-text').textContent = 'Processing...';
            progressBar.querySelector('.progress-bar').style.width = '0%';
        }
    };

    plotManager.ws.addEventListener('message', messageHandler);
    dialog.addEventListener('close', () => {
        plotManager.ws.removeEventListener('message', messageHandler);
        resizeObserver.disconnect();
    });
} 