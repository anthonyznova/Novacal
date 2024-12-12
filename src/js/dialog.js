/**
 * Manages dialog windows for calibration and FIR filter operations
 */
class DialogManager {
    /**
     * Initialize dialog manager with WebSocket client
     * @param {WebSocketClient} wsClient - WebSocket client instance
     */
    constructor(wsClient) {
        this.ws = wsClient;
        this.setupDialogs();
        this.setupWebSocketHandlers();
    }

    /**
     * Set up dialog elements and event handlers
     */
    setupDialogs() {
        // Calibration dialog setup
        this.calibrationDialog = document.getElementById('calibrationDialog');
        this.setupCalibrationDialogHandlers();

        // FIR dialog setup
        this.firDialog = document.getElementById('firDialog');
        this.setupFIRDialogHandlers();
    }

    /**
     * Set up WebSocket message handlers for dialog operations
     */
    setupWebSocketHandlers() {
        this.ws.on('calibrationProgress', (data) => this.updateCalibrationProgress(data));
        this.ws.on('calibrationResults', (data) => this.handleCalibrationResults(data));
        this.ws.on('configData', (data) => this.handleConfigData(data));
        this.ws.on('firProgress', (data) => this.updateFIRProgress(data));
        this.ws.on('firComplete', (data) => this.handleFIRComplete(data));
    }

    /**
     * Set up event handlers for calibration dialog
     */
    setupCalibrationDialogHandlers() {
        // Import config button
        document.getElementById('importConfigBtn').onclick = () => {
            const selectedPaths = this.getSelectedPaths();
            selectedPaths.forEach(path => {
                this.ws.send({
                    type: 'checkConfig',
                    path: path
                });
            });
        };

        // Run calibration button
        document.getElementById('runCalibrationBtn').onclick = () => {
            const calibrationData = this.collectCalibrationData();
            this.ws.send({
                type: 'calibrate',
                data: calibrationData
            });
        };

        // Export results button
        document.getElementById('exportResultsBtn').onclick = () => {
            this.exportCalibrationResults();
        };

        // Close button
        document.getElementById('closeCalibrationBtn').onclick = () => {
            this.calibrationDialog.close();
        };
    }

    /**
     * Set up event handlers for FIR dialog
     */
    setupFIRDialogHandlers() {
        // Import config button
        document.getElementById('importFIRConfigBtn').onclick = () => {
            const selectedPaths = this.getSelectedPaths();
            selectedPaths.forEach(path => {
                this.ws.send({
                    type: 'checkConfig',
                    path: path
                });
            });
        };

        // Calculate FIR button
        document.getElementById('calculateFIRBtn').onclick = () => {
            const firData = this.collectFIRData();
            this.ws.send({
                type: 'calculateFIR',
                data: firData
            });
        };

        // Close button
        document.getElementById('closeFIRBtn').onclick = () => {
            this.firDialog.close();
        };
    }

    /**
     * Show calibration dialog with data for selected paths
     * @param {Array} selectedPaths - Array of selected directory paths
     */
    showCalibrationDialog(selectedPaths) {
        const table = this.calibrationDialog.querySelector('tbody');
        table.innerHTML = '';
        
        selectedPaths.forEach(path => {
            const row = this.createCalibrationRow(path);
            table.appendChild(row);
        });
        
        this.calibrationDialog.showModal();
    }

    /**
     * Create a row for the calibration table
     * @param {string} path - Directory path
     * @returns {HTMLTableRowElement} - Table row element
     */
    createCalibrationRow(path) {
        const row = document.createElement('tr');
        row.dataset.path = path;
        
        row.innerHTML = `
            <td>${path.split('\\').pop()}</td>
            <td>
                <select class="waveform-select">
                    <option value="Square">Square</option>
                    <option value="Sine">Sine</option>
                </select>
            </td>
            <td><input type="number" class="frequency-input" step="0.1" value="0"></td>
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
                </select>
            </td>
        `;
        
        return row;
    }

    /**
     * Show FIR dialog with data for selected paths
     * @param {Array} selectedPaths - Array of selected directory paths
     */
    showFIRDialog(selectedPaths) {
        const table = this.firDialog.querySelector('tbody');
        table.innerHTML = '';
        
        selectedPaths.forEach(path => {
            const row = this.createFIRRow(path);
            table.appendChild(row);
        });
        
        this.firDialog.showModal();
    }

    /**
     * Create a row for the FIR table
     * @param {string} path - Directory path
     * @returns {HTMLTableRowElement} - Table row element
     */
    createFIRRow(path) {
        const row = document.createElement('tr');
        row.dataset.path = path;
        
        row.innerHTML = `
            <td>${path.split('\\').pop()}</td>
            <td><input type="text" class="coil-name-input"></td>
            <td><input type="number" class="base-frequency-input" step="0.1"></td>
            <td><input type="number" class="sample-rate-input" value="51200"></td>
            <td>
                <select class="coil-channel-select">
                    <option value="channel1.bin">channel1.bin</option>
                    <option value="channel2.bin">channel2.bin</option>
                </select>
            </td>
        `;
        
        return row;
    }

    /**
     * Collect data from calibration dialog
     * @returns {Array} - Array of calibration data objects
     */
    collectCalibrationData() {
        const rows = this.calibrationDialog.querySelectorAll('tbody tr');
        return Array.from(rows).map(row => ({
            station: row.dataset.path,
            waveform: row.querySelector('.waveform-select').value,
            frequency: parseFloat(row.querySelector('.frequency-input').value),
            tx: row.querySelector('.tx-select').value,
            rx: row.querySelector('.rx-select').value,
            coil: row.querySelector('.coil-select').value
        }));
    }

    /**
     * Collect data from FIR dialog
     * @returns {Array} - Array of FIR data objects
     */
    collectFIRData() {
        const rows = this.firDialog.querySelectorAll('tbody tr');
        return Array.from(rows).map(row => ({
            station: row.dataset.path,
            coilName: row.querySelector('.coil-name-input').value,
            baseFrequency: parseFloat(row.querySelector('.base-frequency-input').value),
            sampleRate: parseFloat(row.querySelector('.sample-rate-input').value),
            coilChannel: row.querySelector('.coil-channel-select').value
        }));
    }

    /**
     * Update calibration progress bar
     * @param {Object} data - Progress data
     */
    updateCalibrationProgress(data) {
        const progressBar = document.querySelector('.calibration-progress');
        if (progressBar) {
            progressBar.value = data.progress;
        }
    }

    /**
     * Handle calibration results from backend
     * @param {Object} data - Calibration results data
     */
    handleCalibrationResults(data) {
        // Results handling logic here
        console.log('Calibration results:', data);
    }

    /**
     * Handle configuration data from backend
     * @param {Object} data - Configuration data
     */
    handleConfigData(data) {
        const row = this.findRowByStation(data.station);
        if (row && data.config) {
            this.populateRowWithConfig(row, data.config);
        }
    }

    /**
     * Find table row by station name
     * @param {string} station - Station name
     * @returns {HTMLTableRowElement} - Table row element
     */
    findRowByStation(station) {
        return document.querySelector(`tr[data-path*="${station}"]`);
    }

    /**
     * Populate row with configuration data
     * @param {HTMLTableRowElement} row - Table row element
     * @param {Object} config - Configuration data
     */
    populateRowWithConfig(row, config) {
        if (row.closest('#calibrationDialog')) {
            // Populate calibration row
            if (config.waveform) row.querySelector('.waveform-select').value = config.waveform;
            if (config.frequency) row.querySelector('.frequency-input').value = config.frequency;
            if (config.tx) row.querySelector('.tx-select').value = config.tx;
            if (config.rx) row.querySelector('.rx-select').value = config.rx;
            if (config.coil) row.querySelector('.coil-select').value = config.coil;
        } else if (row.closest('#firDialog')) {
            // Populate FIR row
            if (config.coilName) row.querySelector('.coil-name-input').value = config.coilName;
            if (config.baseFrequency) row.querySelector('.base-frequency-input').value = config.baseFrequency;
            if (config.sampleRate) row.querySelector('.sample-rate-input').value = config.sampleRate;
            if (config.coilChannel) row.querySelector('.coil-channel-select').value = config.coilChannel;
        }
    }
}