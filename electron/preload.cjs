const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFileDialog: (filters) => ipcRenderer.invoke('open-file-dialog', filters),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  readFileBuffer: (filePath) => ipcRenderer.invoke('read-file-buffer', filePath),
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  runWhisper: (opts) => ipcRenderer.invoke('run-whisper', opts),
  onWhisperProgress: (cb) => ipcRenderer.on('whisper-progress', (_, msg) => cb(msg)),
  offWhisperProgress: () => ipcRenderer.removeAllListeners('whisper-progress'),
  cancelWhisper: () => ipcRenderer.invoke('cancel-whisper'),
  getHistory: () => ipcRenderer.invoke('get-history'),
  addHistory: (entry) => ipcRenderer.invoke('add-history', entry),
  removeHistory: (id) => ipcRenderer.invoke('remove-history', id),
  checkFiles: (paths) => ipcRenderer.invoke('check-files', paths),
  getRanking: (lrcPath, userId) => ipcRenderer.invoke('get-ranking', { lrcPath, userId }),
  getAllRanking: (lrcPath) => ipcRenderer.invoke('get-all-ranking', lrcPath),
  addRanking: (lrcPath, userId, entry) => ipcRenderer.invoke('add-ranking', { lrcPath, userId, entry }),
  getUsers: () => ipcRenderer.invoke('get-users'),
  addUser: (name) => ipcRenderer.invoke('add-user', name),
  removeUser: (id) => ipcRenderer.invoke('remove-user', id),
  writeTempFile: (opts) => ipcRenderer.invoke('write-temp-file', opts),
});
