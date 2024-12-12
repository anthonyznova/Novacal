// Global state
let currentPath = '';
export let ws = null;  // Make ws exportable
const checkedPaths = new Map();  // Store checked state with full paths
window.checkedPaths = checkedPaths;

// Add this import at the top
import { calibrationStore } from './calibrationStore.js';
import plotManager from './plotting.js';
import { setupCalibrationDialog, importConfigData, exportCalibrationResults } from './calibration.js';
import { setupFIRDialog } from './fir.js';

// Add this at the top with other constants
const ALLOWED_EXTENSIONS = ['.txt', '.ini', '.bin', '.csv'];

// Initialize everything when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeWindowControls();
    initializeFileExplorer();
    initializeToolbar();
    initializeResizer();
    initializeWebSocket();
});

// Initialize WebSocket connection
function initializeWebSocket() {
    // Try to connect to the WebSocket server
    function connect() {
        ws = new WebSocket('ws://localhost:8080/ws');

        ws.onopen = () => {
            console.log('Connected to backend');
        };

        ws.onclose = () => {
            console.log('Connection closed. Retrying in 5 seconds...');
            setTimeout(connect, 5000);
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Main WebSocket received message:', data.type);
                
                switch (data.type) {
                    case 'totalLength':
                        handleTotalLength(data);
                        break;
                    case 'plotData':
                        handlePlotData(data);
                        break;
                    case 'calibrationProgress':
                        // Handle progress updates if needed
                        console.log('Calibration progress:', data.progress);
                        break;
                    case 'calibrationComplete':
                        console.log('Received calibration results in main handler:', data.results);
                        if (data.results) {
                            calibrationStore.setResults(data.results);
                            // This will trigger the plot via the listener in PlotManager
                        }
                        break;
                    case 'error':
                        console.error('Backend error:', data.message);
                        alert('Error: ' + data.message);
                        break;
                    case 'fftProgress':
                        updateFFTProgress(data.progress);
                        break;
                    case 'fftResults':
                        hideFFTProgress();
                        console.log('Received FFT results:', data);
                        if (data.data) {
                            plotManager.plotFFTResults(data.data);
                        } else {
                            console.error('FFT results missing data property');
                        }
                        break;
                    default:
                        console.log('Unhandled message type:', data.type);
                }
            } catch (error) {
                console.error('Error processing WebSocket message:', error);
                console.log('Raw message:', event.data);
            }
        };
    }

    connect();
}

// Initialize resizable panel
function initializeResizer() {
    const resizer = document.getElementById('dragMe');
    const leftPanel = document.querySelector('.file-explorer');

    let isResizing = false;
    let startX;
    let startWidth;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.pageX;
        startWidth = leftPanel.offsetWidth;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const width = startWidth + (e.pageX - startX);
        if (width >= 200 && width <= 600) {
            leftPanel.style.width = `${width}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        isResizing = false;
    });
}

// Initialize window controls
function initializeWindowControls() {
    document.getElementById('minimizeBtn').addEventListener('click', () => {
        window.electron.window.minimize();
    });

    document.getElementById('maximizeBtn').addEventListener('click', () => {
        window.electron.window.maximize();
    });

    document.getElementById('closeBtn').addEventListener('click', () => {
        window.electron.window.close();
    });
}

// Initialize file explorer
function initializeFileExplorer() {
    const selectFolderBtn = document.getElementById('selectFolderBtn');
    const backBtn = document.querySelector('.nav-button.back');
    const fileList = document.querySelector('.file-list');
    const pathDisplay = document.querySelector('.path-display');

    // Handle folder selection button
    selectFolderBtn.addEventListener('click', async () => {
        try {
            const directory = await window.electron.fileSystem.selectDirectory({
                icon: '../assets/icon.ico',  // Add icon to dialog
                title: 'Select Folder'
            });
            if (directory) {
                navigateToDirectory(directory);
            }
        } catch (error) {
            console.error('Error selecting directory:', error);
        }
    });

    // Handle back button (up directory)
    backBtn?.addEventListener('click', async () => {
        try {
            if (currentPath) {
                const parentPath = await window.electron.fileSystem.navigateUp(currentPath);
                if (parentPath && parentPath !== currentPath) {
                    currentPath = parentPath;
                    const files = await window.electron.fileSystem.readDirectory(parentPath);
                    updateFileList(files);
                    document.querySelector('.path-display').textContent = parentPath;
                }
            }
        } catch (error) {
            console.error('Navigation error:', error);
        }
    });

    // Function to navigate to a directory
    async function navigateToDirectory(directory) {
        try {
            const files = await window.electron.fileSystem.readDirectory(directory);
            currentPath = directory;
            pathDisplay.textContent = directory;
            updateFileList(files);
        } catch (error) {
            console.error('Error reading directory:', error);
        }
    }

    // Update file list display
    function updateFileList(files) {
        const fileList = document.querySelector('.file-list');
        fileList.innerHTML = '';

        files.forEach(file => {
            const fileItem = createFileItem(file);
            if (fileItem) {
                fileList.appendChild(fileItem);
            }
        });
    }

    function createFileItem(file) {
        // Only show directories and allowed file types
        if (!file.isDirectory && !ALLOWED_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext))) {
            return null;
        }

        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        if (file.isDirectory) fileItem.classList.add('directory');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'file-checkbox';
        
        const fullPath = currentPath.endsWith('/') ? 
            `${currentPath}${file.name}` : 
            `${currentPath}/${file.name}`;
        
        fileItem.dataset.fullPath = fullPath;
        checkbox.checked = checkedPaths.has(fullPath);

        // Add change listener to handle recursive selection
        checkbox.addEventListener('change', async () => {
            if (checkbox.checked) {
                if (file.isDirectory) {
                    // Recursively check all subfolders
                    await checkDirectory(fullPath);
                } else {
                    checkedPaths.set(fullPath, {
                        isDirectory: file.isDirectory,
                        name: file.name
                    });
                }
            } else {
                if (file.isDirectory) {
                    // Recursively uncheck all subfolders
                    await uncheckDirectory(fullPath);
                } else {
                    checkedPaths.delete(fullPath);
                }
            }
        });

        const fileName = document.createElement('span');
        fileName.className = 'file-name';
        fileName.textContent = file.name;

        fileItem.appendChild(checkbox);
        fileItem.appendChild(fileName);

        // Add double-click handler for directories
        if (file.isDirectory) {
            fileItem.addEventListener('dblclick', () => {
                navigateToDirectory(fullPath);
            });
        }

        return fileItem;
    }

    async function checkDirectory(dirPath) {
        try {
            const files = await window.electron.fileSystem.readDirectory(dirPath);
            for (const file of files) {
                const fullPath = `${dirPath}/${file.name}`;
                
                if (file.isDirectory) {
                    await checkDirectory(fullPath);
                } else if (file.name.endsWith('.bin')) {
                    // Only store paths for .bin files
                    checkedPaths.set(fullPath, {
                        isDirectory: false,
                        name: file.name
                    });
                }
            }
            // Store the directory itself
            checkedPaths.set(dirPath, {
                isDirectory: true,
                name: dirPath.split('/').pop()
            });
        } catch (error) {
            console.error('Error checking directory:', error);
        }
    }

    async function uncheckDirectory(dirPath) {
        try {
            const files = await window.electron.fileSystem.readDirectory(dirPath);
            for (const file of files) {
                const fullPath = `${dirPath}/${file.name}`;
                if (file.isDirectory) {
                    await uncheckDirectory(fullPath);
                }
                checkedPaths.delete(fullPath);
            }
            checkedPaths.delete(dirPath);
        } catch (error) {
            console.error('Error unchecking directory:', error);
        }
    }

    function updateCalibrationTable() {
        // Get only directories that contain .bin files
        const calibrationFolders = Array.from(checkedPaths.entries())
            .filter(([_, info]) => info.isDirectory)
            .map(([path]) => path)
            .filter(path => {
                // Check if this directory contains any .bin files in checkedPaths
                return Array.from(checkedPaths.keys())
                    .some(checkedPath => 
                        checkedPath.startsWith(path) && 
                        checkedPath.endsWith('.bin'));
            });

        if (calibrationFolders.length > 0) {
            showCalibrationDialog(calibrationFolders);
        }
    }
}

// Initialize toolbar functionality
function initializeToolbar() {
    // Handle plot button
    document.getElementById('plotBtn').addEventListener('click', () => {
        const selectedBinFiles = Array.from(checkedPaths.entries())
            .filter(([path, info]) => path.endsWith('.bin'))
            .map(([path]) => path);

        if (selectedBinFiles.length > 0) {
            plotManager.plotFiles(selectedBinFiles);
        }
    });

    // Handle clear button
    document.getElementById('clearBtn').addEventListener('click', () => {
        plotManager.clear();
    });

    // Handle clear selection button
    document.querySelector('.clear-selection').addEventListener('click', () => {
        // Clear the stored checked paths
        checkedPaths.clear();
        
        // Uncheck all visible checkboxes
        const checkboxes = document.querySelectorAll('.file-checkbox');
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
        });

        // Clear the plot
        plotManager.clear();
    });

    // Handle calibrate button
    document.getElementById('calibrateBtn').addEventListener('click', () => {
        // Get selected folders from checkedPaths
        const selectedFolders = Array.from(checkedPaths.entries())
            .filter(([_, info]) => info.isDirectory)
            .map(([path]) => path)
            .filter(path => {
                // Check if this directory DIRECTLY contains any .bin files in checkedPaths
                return Array.from(checkedPaths.keys())
                    .some(checkedPath => {
                        // Get parent directory of the checked path
                        const parentDir = checkedPath.substring(0, checkedPath.lastIndexOf('/'));
                        // Only include if the .bin file is directly in this folder (not in subfolders)
                        return parentDir === path && checkedPath.endsWith('.bin');
                    });
            });

        if (selectedFolders.length === 0) {
            alert('Please select at least one folder containing .bin files');
            return;
        }

        // Show calibration dialog
        showCalibrationDialog(selectedFolders);
    });

    // Handle FFT button
    document.getElementById('fftBtn').addEventListener('click', () => {
        const selectedBinFiles = Array.from(checkedPaths.entries())
            .filter(([path, info]) => path.endsWith('.bin'))
            .map(([path]) => path);

        if (selectedBinFiles.length === 0) {
            alert('Please select at least one .bin file for FFT analysis');
            return;
        }

        console.log('Computing FFT for files:', selectedBinFiles);
        
        try {
            // Send FFT request to backend
            ws.send(JSON.stringify({
                type: 'computeFFT',
                files: selectedBinFiles
            }));
        } catch (error) {
            console.error('Error sending FFT request:', error);
        }
    });

    // Handle FIR button
    document.getElementById('firBtn').addEventListener('click', () => {
        const dialog = document.getElementById('firDialog');
        dialog.show();
        setupFIRDialog(dialog);
    });
}

// Move showCalibrationDialog outside of initializeToolbar
function showCalibrationDialog(folders) {
    const dialog = document.getElementById('calibrationDialog');
    const tableBody = dialog.querySelector('tbody');
    tableBody.innerHTML = ''; // Clear existing rows

    // Create a row for each folder
    folders.forEach(folderPath => {
        const row = document.createElement('tr');
        const folderName = folderPath.split('/').pop();
        
        row.innerHTML = `
            <td>${folderName}</td>
            <td>
                <select class="waveform-select">
                    <option value="Square">Square</option>
                    <option value="Sine">Sine</option>
                </select>
            </td>
            <td><input type="number" class="frequency-input" value="0"></td>
            <td>
                <select class="tx-select">
                    <option value="channel1.bin">channel1.bin</option>
                    <option value="channel2.bin">channel2.bin</option>
                </select>
            </td>
            <td>
                <select class="rx-select">
                    <option value="channel1.bin">channel1.bin</option>
                    <option value="channel2.bin">channel2.bin</option>
                </select>
            </td>
            <td>
                <select class="coil-select">
                    <option value="Coil 1">Coil 1</option>
                    <option value="Coil 2">Coil 2</option>
                    <option value="Coil 3">Coil 3</option>
                </select>
            </td>
        `;
        
        tableBody.appendChild(row);
    });
    
    // Make dialog floating
    dialog.style.position = 'fixed';
    dialog.style.left = '50%';
    dialog.style.top = '50%';
    dialog.style.transform = 'translate(-50%, -50%)';
    
    // Show the dialog
    dialog.show();
    
    // Initialize window controls and other functionality
    setupCalibrationDialog(dialog, folders);
}

// Handle total length response
function handleTotalLength(data) {
    const selectedFiles = Array.from(document.querySelectorAll('.file-checkbox:checked'))
        .map(checkbox => checkbox.closest('.file-item'))
        .filter(item => item.querySelector('.file-name').textContent.endsWith('.bin'))
        .map(item => `${currentPath}/${item.querySelector('.file-name').textContent}`);

    ws.send(JSON.stringify({
        type: 'plot',
        files: selectedFiles,
        startIndex: 0,
        endIndex: data.totalLength,
        screenWidth: document.getElementById('plotContainer').clientWidth
    }));
}

// Handle plot data response
function handlePlotData(data) {
    const trace = {
        x: data.times,
        y: data.values,
        type: 'scatter',
        mode: 'lines'
    };

    const layout = {
        autosize: true,
        margin: { t: 20, r: 20, b: 40, l: 60 },
        xaxis: {
            title: 'Time',
            showgrid: true,
            zeroline: false
        },
        yaxis: {
            title: 'Value',
            showgrid: true,
            zeroline: false
        }
    };

    Plotly.newPlot('plotContainer', [trace], layout, {
        responsive: true,
        scrollZoom: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ['lasso2d', 'select2d']
    });
}

function updateFFTProgress(progress) {
    const progressBar = document.getElementById('fftProgress');
    const progressElement = progressBar.querySelector('.progress-bar');
    const progressText = progressBar.querySelector('.progress-text');
    
    progressBar.style.display = 'block';
    progressElement.style.width = `${progress}%`;
    progressText.textContent = `Computing FFT... ${progress}%`;
}

function hideFFTProgress() {
    const progressBar = document.getElementById('fftProgress');
    progressBar.style.display = 'none';
}