import { ws } from './renderer.js';
import { calibrationStore } from './calibrationStore.js';

export function setupCalibrationDialog(dialog, folders) {
    setupWindowControls(dialog);
    setupCalibrationButtons(dialog, folders);
}

function setupWindowControls(dialog) {
    const closeBtn = dialog.querySelector('.control-button.close');
    const titleBar = dialog.querySelector('.title-bar');

    // Make dialog draggable by title bar
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

    // Add resize functionality
    const resizeHandle = dialog.querySelector('.resize-handle');
    let isResizing = false;
    let startWidth, startHeight, startX, startY;

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = dialog.offsetWidth;
        startHeight = dialog.offsetHeight;
        
        dialog.classList.add('resizing');
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const newWidth = startWidth + (e.clientX - startX);
        const newHeight = startHeight + (e.clientY - startY);

        // Apply minimum dimensions
        if (newWidth >= 600) {
            dialog.style.width = `${newWidth}px`;
        }
        if (newHeight >= 400) {
            dialog.style.height = `${newHeight}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            dialog.classList.remove('resizing');
        }
    });
}

function setupCalibrationButtons(dialog, folders) {
    // Get button references with correct IDs
    const runCalibrationBtn = dialog.querySelector('#runCalibrationBtn');
    const importFromConfigBtn = dialog.querySelector('#importFromConfigBtn');
    const exportResultsBtn = dialog.querySelector('#exportResultsBtn');

    console.log('Setting up calibration buttons:', {
        runBtn: runCalibrationBtn,
        importBtn: importFromConfigBtn,
        exportBtn: exportResultsBtn
    });

    // Remove any existing event listeners
    const newImportBtn = importFromConfigBtn.cloneNode(true);
    const newExportBtn = exportResultsBtn.cloneNode(true);
    const newRunBtn = runCalibrationBtn.cloneNode(true);

    importFromConfigBtn.parentNode.replaceChild(newImportBtn, importFromConfigBtn);
    exportResultsBtn.parentNode.replaceChild(newExportBtn, exportResultsBtn);
    runCalibrationBtn.parentNode.replaceChild(newRunBtn, runCalibrationBtn);

    // Add new event listeners
    newImportBtn.addEventListener('click', (e) => {
        console.log('Import From Config button clicked');
        e.preventDefault();
        importConfigData(dialog, folders);
    });

    newRunBtn.addEventListener('click', (e) => {
        console.log('Run Calibration button clicked');
        e.preventDefault();
        const calibrationData = getCalibrationData(dialog, folders);
        startCalibration(dialog, calibrationData);
    });

    newExportBtn.addEventListener('click', (e) => {
        console.log('Export Results button clicked');
        e.preventDefault();
        exportCalibrationResults();
    });

    // Setup WebSocket message handler for calibration progress
    setupCalibrationProgressHandler(dialog, newRunBtn, newExportBtn);
}

function getCalibrationData(dialog, folders) {
    return Array.from(dialog.querySelectorAll('tbody tr')).map((row, index) => {
        const folderPath = folders[index];
        // Log the data we're collecting
        console.log('Processing folder:', folderPath);
        
        const data = {
            folder: folderPath,
            waveform: row.querySelector('.waveform-select').value,
            frequency: parseFloat(row.querySelector('.frequency-input').value),
            tx: `${folderPath}/${row.querySelector('.tx-select').value}`,  // Add full path
            rx: `${folderPath}/${row.querySelector('.rx-select').value}`,  // Add full path
            coil: row.querySelector('.coil-select').value
        };
        
        // Log the calibration data for this row
        console.log('Calibration data:', data);
        
        return data;
    });
}

function startCalibration(dialog, calibrationData) {
    // Show progress bar
    const progressBar = dialog.querySelector('.progress-bar-container');
    progressBar.style.display = 'block';

    // Send calibration request to backend
    ws.send(JSON.stringify({
        type: 'calibrate',
        data: calibrationData
    }));

    // Disable run button while calibrating
    dialog.querySelector('#runCalibrationBtn').disabled = true;
}

function setupCalibrationProgressHandler(dialog, runBtn, exportBtn) {
    const messageHandler = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('Calibration handler received message:', data); // Full message debug
            
            if (data.type === 'calibrationProgress') {
                console.log('Progress update:', data.progress);
                updateProgressBar(dialog, data.progress);
            } else if (data.type === 'calibrationComplete' && data.results) {
                console.log('Calibration handler: Received results for coils:', Object.keys(data.results));
                runBtn.disabled = false;
                exportBtn.disabled = false;

                // Store results in both dialog and store
                dialog.calibrationResults = data.results;
                calibrationStore.setResults(data.results);

                // Plot the results
                const plotContainer = document.getElementById('plotContainer');
                if (!plotContainer) {
                    console.error('Plot container not found');
                    return;
                }

                // Create traces for each coil
                const traces = [];
                Object.entries(data.results).forEach(([coilName, coilData]) => {
                    console.log(`Creating traces for ${coilName}:`, {
                        frequencies: coilData.Frequencies.length,
                        amplitudes: coilData.Amplitudes.length,
                        phases: coilData.Phases.length
                    });

                    // Add amplitude trace
                    traces.push({
                        x: coilData.Frequencies,
                        y: coilData.Amplitudes,
                        type: 'scatter',
                        mode: 'lines+markers',
                        name: `${coilName} - Amplitude`,
                        line: { 
                            color: coilName === 'Coil 1' ? 'red' : 'blue',
                            width: 2
                        },
                        yaxis: 'y1'
                    });

                    // Add phase trace
                    traces.push({
                        x: coilData.Frequencies,
                        y: coilData.Phases,
                        type: 'scatter',
                        mode: 'lines+markers',
                        name: `${coilName} - Phase`,
                        line: { 
                            color: coilName === 'Coil 1' ? 'red' : 'blue',
                            dash: 'dot',
                            width: 2
                        },
                        yaxis: 'y2'
                    });
                });

                const layout = {
                    grid: {
                        rows: 2,
                        columns: 1,
                        pattern: 'independent',
                        roworder: 'top to bottom'
                    },
                    height: 800,
                    showlegend: true,
                    plot_bgcolor: '#FFFFFF',
                    paper_bgcolor: '#FFFFFF',
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
                    legend: {
                        orientation: 'h',
                        yanchor: 'bottom',
                        y: -0.2,
                        xanchor: 'center',
                        x: 0.5
                    }
                };

                console.log('Plotting with traces:', traces.map(t => t.name));
                Plotly.newPlot(plotContainer, traces, layout);
            }
        } catch (error) {
            console.error('Error processing WebSocket message in calibration handler:', error);
        }
    };

    ws.addEventListener('message', messageHandler);
    console.log('Added calibration message handler');

    dialog.addEventListener('close', () => {
        ws.removeEventListener('message', messageHandler);
        console.log('Removed calibration message handler');
    });
}

function updateProgressBar(dialog, progress) {
    const progressBar = dialog.querySelector('.progress-bar');
    const progressText = dialog.querySelector('.progress-text');
    progressBar.style.width = `${progress}%`;
    progressText.textContent = `${progress}%`;
}

function setupExportButton(dialog) {
    const exportBtn = dialog.querySelector('#exportResultsBtn');
    
    exportBtn.addEventListener('click', () => {
        const results = calibrationStore.getResults();
        if (!results) {
            console.error('No calibration results to export');
            return;
        }

        console.log('Sending export request with data:', results);
        ws.send(JSON.stringify({
            type: 'exportCalibration',
            data: results
        }));
    });
}

function setupWindowDragging(dialog) {
    const titleBar = dialog.querySelector('.title-bar');
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;

    titleBar.addEventListener('mousedown', (e) => {
        // Don't start drag if clicking window controls
        if (e.target.closest('.window-controls')) return;

        isDragging = true;
        dialog.classList.add('dragging');

        const rect = dialog.getBoundingClientRect();
        initialX = e.clientX - rect.left;
        initialY = e.clientY - rect.top;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        e.preventDefault();
        
        const newX = e.clientX - initialX;
        const newY = e.clientY - initialY;

        dialog.style.left = `${newX}px`;
        dialog.style.top = `${newY}px`;
        dialog.style.transform = 'none';
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        dialog.classList.remove('dragging');
    });
} 

function plotCalibrationResults(results) {
    console.log('Raw calibration results:', results);
    console.log('Available coils:', Object.keys(results));
    
    const plotContainer = document.getElementById('plotContainer');
    const colors = {
        'Coil 1': 'red',
        'Coil 2': 'blue',
        'Coil 3': 'green'
    };
    
    // Create traces for each coil
    const traces = [];
    Object.entries(results).forEach(([coilName, coilData]) => {
        console.log(`Processing ${coilName} data:`, {
            frequencies: coilData.Frequencies.length,
            amplitudes: coilData.Amplitudes.length,
            phases: coilData.Phases.length
        });
        
        // Add amplitude trace for this coil
        traces.push({
            x: coilData.Frequencies,
            y: coilData.Amplitudes,
            type: 'scatter',
            mode: 'lines+markers',
            name: coilName,  // Simplified name for legend
            line: { color: colors[coilName] },
            yaxis: 'y1',
            legendgroup: coilName,
            showlegend: true
        });

        // Add phase trace for this coil
        traces.push({
            x: coilData.Frequencies,
            y: coilData.Phases,
            type: 'scatter',
            mode: 'lines+markers',
            name: coilName + ' (Phase)',  // Add phase indicator
            line: { 
                color: colors[coilName],
                dash: 'dot'
            },
            yaxis: 'y2',
            legendgroup: coilName,
            showlegend: true
        });
    });

    const layout = {
        title: 'Calibration Results',
        grid: {
            rows: 2,
            columns: 1,
            pattern: 'independent',
            roworder: 'top to bottom'
        },
        height: 800,
        showlegend: true,
        plot_bgcolor: '#FFFFFF',
        paper_bgcolor: '#FFFFFF',
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
        legend: {
            orientation: 'h',
            yanchor: 'bottom',
            y: -0.2,
            xanchor: 'center',
            x: 0.5,
            traceorder: 'grouped',  // Group by coil
            groupclick: 'toggleitem'  // Allow toggling individual traces
        }
    };

    console.log('Creating plot with layout:', layout);
    Plotly.newPlot(plotContainer, traces, layout);
} 

export async function importConfigData(dialog, folders) {
    console.log('Starting config import for folders:', folders);
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket not connected');
        return;
    }
    
    // For each folder, check for config.csv
    for (let i = 0; i < folders.length; i++) {
        const folder = folders[i];
        const row = dialog.querySelectorAll('tbody tr')[i];
        
        console.log(`Checking folder ${i + 1}/${folders.length}:`, folder);
        
        try {
            // Create a promise to handle the response
            const configPromise = new Promise((resolve, reject) => {
                const messageHandler = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        console.log('Received config response:', data);
                        
                        if (data.type === 'configData') {
                            ws.removeEventListener('message', messageHandler);
                            resolve(data);
                        }
                    } catch (error) {
                        console.error('Error processing config response:', error);
                        reject(error);
                    }
                };
                
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.addEventListener('message', messageHandler);
                } else {
                    reject(new Error('WebSocket not connected'));
                }
            });

            // Send request to backend
            console.log('Sending config check request for folder:', folder);
            ws.send(JSON.stringify({
                type: 'checkConfig',
                path: folder
            }));

            // Wait for and handle response
            const response = await configPromise;
            console.log('Processing config response:', response);
            
            if (response.config) {
                if (row) {
                    const config = response.config;
                    console.log('Updating row with config:', config);

                    // Update waveform (convert to proper case)
                    if (config.waveform) {
                        const waveform = config.waveform.toLowerCase() === 'square' ? 'Square' : 'Sine';
                        row.querySelector('.waveform-select').value = waveform;
                        console.log('Set waveform to:', waveform);
                    }

                    // Update frequency (ensure it's a number)
                    if (typeof config.freq === 'number') {
                        row.querySelector('.frequency-input').value = config.freq;
                        console.log('Set frequency to:', config.freq);
                    }

                    // Update tx and rx (ensure they match available options)
                    if (config.tx && ['channel1.bin', 'channel2.bin'].includes(config.tx)) {
                        row.querySelector('.tx-select').value = config.tx;
                        console.log('Set tx to:', config.tx);
                    }
                    if (config.rx && ['channel1.bin', 'channel2.bin'].includes(config.rx)) {
                        row.querySelector('.rx-select').value = config.rx;
                        console.log('Set rx to:', config.rx);
                    }

                    // Update coil (ensure it matches available options)
                    if (config.coil) {
                        const coil = config.coil.toLowerCase() === 'coil1' ? 'Coil 1' : 'Coil 2';
                        row.querySelector('.coil-select').value = coil;
                        console.log('Set coil to:', coil);
                    }

                    // Log the final state of the row
                    console.log('Row final values:', {
                        waveform: row.querySelector('.waveform-select').value,
                        freq: row.querySelector('.frequency-input').value,
                        tx: row.querySelector('.tx-select').value,
                        rx: row.querySelector('.rx-select').value,
                        coil: row.querySelector('.coil-select').value
                    });
                }
            }
        } catch (error) {
            console.error(`Error processing folder ${folder}:`, error);
        }
    }
} 

export async function exportCalibrationResults() {
    console.log('Starting export process');
    
    const results = calibrationStore.getResults();
    if (!results) {
        console.error('No calibration results to export');
        return;
    }

    try {
        console.log('Opening directory selector');
        const exportDir = await window.electron.fileSystem.selectDirectory();
        if (!exportDir) {
            console.log('Directory selection cancelled');
            return;
        }

        console.log('Selected export directory:', exportDir);
        const csvData = formatResultsForCSV(results);
        console.log('Formatted CSV data:', csvData.substring(0, 200) + '...');
        
        console.log('Sending export request to backend');
        ws.send(JSON.stringify({
            type: 'exportCalibration',
            data: {
                results: results,
                csvData: csvData,
                exportPath: exportDir
            }
        }));

    } catch (error) {
        console.error('Error during export:', error);
    }
}

function formatResultsForCSV(results) {
    const rows = ['Frequency,Amplitude,Phase,Coil'];
    
    // For each coil in results
    Object.entries(results).forEach(([coilName, coilData]) => {
        // Combine the data arrays
        for (let i = 0; i < coilData.Frequencies.length; i++) {
            rows.push(`${coilData.Frequencies[i]},${coilData.Amplitudes[i]},${coilData.Phases[i]},${coilName}`);
        }
    });

    return rows.join('\n');
} 