# NOVACAL


##  Overview

NOVACAL is an Electron application with a GO backend, designed to be able to quickly load and plot timeseries data and perform calibrations on data collected with novaminex instruments. 

![Nova Toolkit Logo](assets/novacal.png)

## ✨ Features

- 📂 File and folder navigation
- 📊 Time series viewer
![Nova Toolkit Logo](assets/calibrationwindow.png)
![Nova Toolkit Logo](assets/calibrationresults.png)
- 🔧 Calibration tool & FIR Filter creation
![Nova Toolkit Logo](assets/firwindow.png)
![Nova Toolkit Logo](assets/firresults.png)
- 💾 Import/Export functionality for calibration settings

## Technology Stack

- Frontend: Electron, JavaScript, HTML, CSS
- Backend: Go
- Plotting: Plotly.js

## Getting Started


### Installation

Download NOVACAL Setup 1.0.0.exe from releases tab and run the installer. 

OR 

1. Clone the repository:
   ```
   git clone https://github.com/anthonyznova/novacal.git
   ```

2. Navigate to the project directory:
   ```
   cd novacal
   ```

3. Install dependencies:
   ```
   npm install
   ```
   
4. Start the application:
   ```
   npm start
   ```

## 🖥️ Usage

1. **Select Folder**: Choose a directory containing your NOVABOX data folders.
2. **Calibration**: Select folders for calibration, hit "calibrate" button and adjust parameters in the calibration window either manually or by importing a settings.csv file.
4. **FIR filter generation**: export FIR filter coefficients to for calibration data collected with the Novabox.
5. **Plot Controls**: Double click to reset view, left click + drag to zoom to area, control + scroll to zoom vertically, scroll to zoom horizontally.
6. **Export Results**: Save calibration data as CSV for further analysis.

## 🔧 Configuration

Populate your novabox station folders with a config.csv to auto populate the calibration variables. 


## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
