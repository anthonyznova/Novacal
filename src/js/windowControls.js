// File: src/js/windowControls.js
document.getElementById('minimizeBtn').addEventListener('click', () => {
    window.electron.window.minimize();
});

document.getElementById('maximizeBtn').addEventListener('click', () => {
    window.electron.window.maximize();
});

document.getElementById('closeBtn').addEventListener('click', () => {
    window.electron.window.close();
});