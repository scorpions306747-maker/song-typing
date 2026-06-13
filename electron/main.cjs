const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;
let viteProcess = null;
let whisperProcess = null;

function getHistoryPath() {
  return path.join(app.getPath('userData'), 'song_history.json');
}

function getRankingPath() {
  return path.join(app.getPath('userData'), 'ranking.json');
}

function loadRanking() {
  try {
    const p = getRankingPath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { return {}; }
}

function saveRanking(ranking) {
  fs.writeFileSync(getRankingPath(), JSON.stringify(ranking, null, 2), 'utf-8');
}

function getUsersPath() {
  return path.join(app.getPath('userData'), 'users.json');
}

function loadUsers() {
  try {
    const p = getUsersPath();
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { return []; }
}

function saveUsers(users) {
  fs.writeFileSync(getUsersPath(), JSON.stringify(users, null, 2), 'utf-8');
}

function loadHistory() {
  try {
    const p = getHistoryPath();
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { return []; }
}

function saveHistory(history) {
  fs.writeFileSync(getHistoryPath(), JSON.stringify(history, null, 2), 'utf-8');
}

function startVite() {
  return new Promise((resolve) => {
    viteProcess = spawn('npx vite', [], {
      cwd: path.join(__dirname, '..'),
      shell: true,
      windowsHide: true,
    });

    viteProcess.stdout.on('data', (data) => {
      const text = data.toString();
      if (text.includes('localhost:')) resolve();
    });

    viteProcess.stderr.on('data', () => {});
    viteProcess.on('error', () => resolve());

    // フォールバック: 5秒後に強制的に進む
    setTimeout(resolve, 5000);
  });
}

async function createWindow() {
  if (isDev) await startVite();

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: '歌でタイピング',
    backgroundColor: '#1a1a2e',
    autoHideMenuBar: true,
  });

  if (isDev) {
    // Viteが使用中のポートを検出
    const port = await detectVitePort();
    win.loadURL(`http://localhost:${port}`);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

async function detectVitePort() {
  const http = require('http');
  for (const port of [5173, 5174, 5175]) {
    const ok = await new Promise(r => {
      http.get(`http://localhost:${port}`, () => r(true)).on('error', () => r(false));
    });
    if (ok) return port;
  }
  return 5173;
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (viteProcess) viteProcess.kill();
  app.quit();
});

ipcMain.handle('open-file-dialog', async (_, filters) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('cancel-whisper', () => {
  if (whisperProcess) {
    whisperProcess.kill('SIGTERM');
    whisperProcess = null;
  }
});

ipcMain.handle('write-temp-file', async (_, { content }) => {
  const os = require('os');
  const tmpPath = path.join(os.tmpdir(), `lyrics_${Date.now()}.txt`);
  fs.writeFileSync(tmpPath, content, 'utf-8');
  return tmpPath;
});

ipcMain.handle('run-whisper', async (event, { audioPath, lyricsPath, model }) => {
  const { spawn } = require('child_process');
  const scriptPath = path.join(__dirname, '../scripts/whisper_timing.py');

  return new Promise((resolve) => {
    const proc = spawn('python', [scriptPath, audioPath, lyricsPath, model || 'small'], {
      shell: true,
    });
    whisperProcess = proc;

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => {
      const msg = d.toString().trim();
      stderr += msg;
      if (msg) event.sender.send('whisper-progress', msg);
    });
    proc.on('close', (code) => {
      whisperProcess = null;
      if (code === null || code === 1 && !stdout) {
        resolve({ cancelled: true });
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ error: stderr || '出力の解析に失敗しました' });
      }
    });
    proc.on('error', (e) => { whisperProcess = null; resolve({ error: e.message }); });
  });
});

ipcMain.handle('get-history', () => loadHistory());

ipcMain.handle('add-history', (_, entry) => {
  const history = loadHistory();
  // 同じlrcPathが既にあれば更新、なければ先頭に追加
  const idx = history.findIndex(h => h.lrcPath === entry.lrcPath);
  if (idx >= 0) {
    history[idx] = { ...history[idx], ...entry, usedAt: new Date().toISOString() };
  } else {
    history.unshift({ ...entry, id: Date.now().toString(), addedAt: new Date().toISOString(), usedAt: new Date().toISOString() });
  }
  // 最大30件
  saveHistory(history.slice(0, 30));
});

ipcMain.handle('remove-history', (_, id) => {
  const history = loadHistory().filter(h => h.id !== id);
  saveHistory(history);
});

ipcMain.handle('get-ranking', (_, { lrcPath, userId }) => {
  const ranking = loadRanking();
  const key = userId ? `${lrcPath}::${userId}` : lrcPath;
  return ranking[key] || [];
});

ipcMain.handle('get-all-ranking', (_, lrcPath) => {
  // 全ユーザー合算でlrcPathに関連するランキングを返す（ユーザー名付き）
  const ranking = loadRanking();
  const users = loadUsers();
  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
  const all = [];
  for (const [key, entries] of Object.entries(ranking)) {
    if (!key.startsWith(lrcPath + '::')) continue;
    const uid = key.slice(lrcPath.length + 2);
    for (const e of entries) {
      all.push({ ...e, userName: userMap[uid] || uid });
    }
  }
  all.sort((a, b) => b.accuracy - a.accuracy || b.correct - a.correct);
  return all.slice(0, 20);
});

ipcMain.handle('add-ranking', (_, { lrcPath, userId, entry }) => {
  const ranking = loadRanking();
  const key = `${lrcPath}::${userId}`;
  const list = ranking[key] || [];
  list.push({ ...entry, date: new Date().toISOString() });
  list.sort((a, b) => b.accuracy - a.accuracy || b.correct - a.correct);
  ranking[key] = list.slice(0, 10);
  saveRanking(ranking);
  return ranking[key];
});

ipcMain.handle('get-users', () => loadUsers());

ipcMain.handle('add-user', (_, name) => {
  const users = loadUsers();
  if (users.some(u => u.name === name)) return { error: '同じ名前のユーザーが既に存在します' };
  const user = { id: Date.now().toString(), name };
  users.push(user);
  saveUsers(users);
  return { user };
});

ipcMain.handle('remove-user', (_, id) => {
  const users = loadUsers().filter(u => u.id !== id);
  saveUsers(users);
});

ipcMain.handle('check-files', (_, paths) => {
  const result = {};
  for (const [key, p] of Object.entries(paths)) {
    result[key] = p ? fs.existsSync(p) : true;
  }
  return result;
});

ipcMain.handle('save-file', async (_, { defaultName, content }) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'LRCファイル', extensions: ['lrc'] }],
  });
  if (result.filePath) {
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return true;
  }
  return false;
});

ipcMain.handle('read-file', async (_, filePath) => {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
});

ipcMain.handle('read-file-buffer', async (_, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch { return null; }
});
