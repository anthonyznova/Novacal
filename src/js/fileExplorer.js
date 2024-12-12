// File: src/js/fileExplorer.js
class FileExplorer {
    constructor() {
        this.currentPath = '';
        this.history = [];
        this.historyIndex = -1;
        
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Folder selection button
        document.getElementById('selectFolderBtn').addEventListener('click', async () => {
            try {
                const selectedPath = await window.electron.dialog.selectFolder();
                if (selectedPath) {
                    this.navigateTo(selectedPath);
                }
            } catch (error) {
                console.error('Error selecting folder:', error);
            }
        });

        // Navigation buttons
        document.querySelector('.nav-button.back').addEventListener('click', () => {
            this.navigateHistory(-1);
        });

        document.querySelector('.nav-button.forward').addEventListener('click', () => {
            this.navigateHistory(1);
        });
    }

    async navigateTo(path) {
        if (path && path !== this.currentPath) {
            try {
                const files = await window.electron.files.readDirectory(path);
                this.updateFileList(files);
                
                // Update history
                this.history = this.history.slice(0, this.historyIndex + 1);
                this.history.push(path);
                this.historyIndex = this.history.length - 1;
                
                // Update path display
                this.currentPath = path;
                document.querySelector('.path-display').textContent = path;
            } catch (error) {
                console.error('Error navigating to path:', error);
            }
        }
    }

    updateFileList(files) {
        const fileList = document.querySelector('.file-list');
        fileList.innerHTML = '';
        
        files.forEach(file => {
            const item = this.createFileItem(file);
            fileList.appendChild(item);
        });
    }

    createFileItem(file) {
        const item = document.createElement('div');
        item.className = 'file-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'file-checkbox';
        
        const icon = document.createElement('img');
        icon.src = `../assets/${file.isDirectory ? 'folder' : 'file'}.svg`;
        icon.className = 'file-icon';
        
        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = file.name;
        
        item.appendChild(checkbox);
        item.appendChild(icon);
        item.appendChild(name);
        
        if (file.isDirectory) {
            item.ondblclick = () => this.navigateTo(file.path);
        }
        
        return item;
    }

    navigateHistory(direction) {
        const newIndex = this.historyIndex + direction;
        if (newIndex >= 0 && newIndex < this.history.length) {
            this.historyIndex = newIndex;
            this.navigateTo(this.history[newIndex]);
        }
    }
}

// Initialize file explorer
document.addEventListener('DOMContentLoaded', () => {
    window.fileExplorer = new FileExplorer();
});