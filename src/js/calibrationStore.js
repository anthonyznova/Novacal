// Store for calibration-related state
class CalibrationStore {
    constructor() {
        this.results = null;
        this.listeners = new Set();
    }

    // Update results and notify listeners
    setResults(results) {
        this.results = results;
        this.notifyListeners();
    }

    // Add a listener for result changes
    addListener(callback) {
        this.listeners.add(callback);
    }

    // Remove a listener
    removeListener(callback) {
        this.listeners.delete(callback);
    }

    // Notify all listeners of changes
    notifyListeners() {
        this.listeners.forEach(callback => callback(this.results));
    }

    // Get current results
    getResults() {
        return this.results;
    }
}

export const calibrationStore = new CalibrationStore(); 