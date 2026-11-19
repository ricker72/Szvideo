const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { createSzVideoServer } = require('./server.cjs');
const { writeFileAtomic, recoverAtomicFile, cleanupAtomicFiles } = require('./atomicFile.cjs');

// Una sola instancia: evita dos apps peleándose por trabajos, ventanas y FFmpeg.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let metadataPrivacyModule = null;
async function loadMetadataPrivacy() {
  if (!metadataPrivacyModule) metadataPrivacyModule = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'metadataPrivacy.js')).href);
  return metadataPrivacyModule;
}
let audioLayerModule = null;
async function loadAudioLayer() {
  if (!audioLayerModule) audioLayerModule = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'audioLayer.js')).href);
  return audioLayerModule;
}
let visualLayerModule = null;
async function loadVisualLayer() {
  if (!visualLayerModule) visualLayerModule = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'visualLayer.js')).href);
  return visualLayerModule;
}
let stealthPresetModule = null;
async function loadStealthPreset() {
  if (!stealthPresetModule) stealthPresetModule = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'stealthPreset.js')).href);
  return stealthPresetModule;
}
let intelligenceCoreModule = null;
async function loadIntelligenceCore() {
  if (!intelligenceCoreModule) intelligenceCoreModule = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'intelligenceCore.js')).href);
  return intelligenceCoreModule;
}
let advancedObfuscationModule = null;
async function loadAdvancedObfuscation() {
  if (!advancedObfuscationModule) advancedObfuscationModule = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'advancedObfuscation.js')).href);
  return advancedObfuscationModule;
}
let mp4PatchModule = null;
async function loadMp4Patch() {
  if (!mp4PatchModule) mp4PatchModule = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'mp4Patch.js')).href);
  return mp4PatchModule;
}



let errorLogPath;
function logMainError(error, context) {
  if (!errorLogPath) return;
  const record = JSON.stringify({ context, message: error?.message || String(error), stack: error?.stack, time: new Date().toISOString() }) + '\n';
  fs.promises.appendFile(errorLogPath, record, 'utf8').catch(() => {});
}
function ffmpegConfigPath() { return path.join(app.getPath('userData'), 'ffmpeg.json'); }
async function configuredFfmpeg() {
  if (process.env.SZVIDEO_FFMPEG) return process.env.SZVIDEO_FFMPEG;
  try { return JSON.parse(await fs.promises.readFile(ffmpegConfigPath(), 'utf8')).path || 'ffmpeg'; } catch { return 'ffmpeg'; }
}
function checkFfmpeg(executable) { return new Promise(resolve => { const child = spawn(executable, ['-version'], { windowsHide: true }); let output = ''; child.stdout.on('data', chunk => { output += chunk.toString(); }); child.on('error', error => resolve({ available: false, executable, error: error.message })); child.on('close', code => { const match = output.match(/^ffmpeg version\s+([^\s]+)/m); resolve(code === 0 ? { available: true, executable, version: match?.[1] || 'unknown' } : { available: false, executable, error: `exit code ${code}` }); }); }); }

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

let closing = false;
let rendererDirty = false;
let mainWindow;
let closeSafetyTimer = null;
const exportJobs = new Map();
const metadataJobs = new Map();
const audioJobs = new Map();
const videoJobs = new Map();
const stealthJobs = new Map();
const advancedJobs = new Map();
const noblurJobs = new Map();
const noblurCancelled = new Set();

function createWindow() {
  if (!server) return;
  // Blindaje: nunca dos ventanas de la misma instancia.
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  const win = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 960,
    minHeight: 600,
    useContentSize: true, // el tamaño es del contenido: nunca queda bajo la barra de tareas
    show: false,          // no se muestra hasta estar lista y maximizada
    maximizable: true,
    title: 'SzVideo — Editor y expediente de autoría',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow = win;
  win.loadURL(`http://127.0.0.1:${server.address().port}/index.html`);
  // Arranca en ventana maximizada: usa el área de trabajo libre (sin tapar la barra de tareas).
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  win.on('close', event => {
    if (closing || !rendererDirty) return;
    event.preventDefault();
    win.webContents.send('request-safe-close');
    // Red de seguridad: si el renderer nunca confirma (JS colgado), se cierra igualmente.
    clearTimeout(closeSafetyTimer);
    closeSafetyTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      closing = true;
      win.destroy();
    }, 5000);
  });
}

let server;
let serverConnections = new Set();
const publicRoot = path.join(__dirname, '..', 'public');
const projectRoot = path.resolve(publicRoot, '..');

/** Arranca el servidor interno en segundo plano (sin ventana, puerto aleatorio en 127.0.0.1).
 *  La app lo lanza sola al iniciar y lo apaga al cerrar: el usuario no tiene que hacer nada. */
function startBackgroundServer(attempt = 0) {
  if (closing) return;
  const instance = createSzVideoServer({
    publicRoot,
    projectRoot,
    onError: error => logMainError(error, 'servidor interno'),
  });
  server = instance.server;
  serverConnections = instance.connections;
  server.once('listening', () => createWindow());
  server.once('error', error => {
    logMainError(error, 'servidor interno');
    server = undefined;
    serverConnections = new Set();
    if (attempt < 4) {
      setTimeout(() => { if (!closing) startBackgroundServer(attempt + 1); }, 300 * (attempt + 1));
    } else {
      dialog.showErrorBox('SzVideo', `No se pudo iniciar el servidor interno de la aplicación.\n\n${error.message}`);
      app.quit();
    }
  });
  instance.listen(0, '127.0.0.1');
  server.unref(); // el servidor no mantiene vivo el proceso: lo hace la propia app
}

/** Apaga el servidor y destruye las conexiones activas para que la app cierre sin colgarse. */
function stopBackgroundServer() {
  if (!server) return;
  const current = server;
  server = undefined;
  try { current.close(() => {}); } catch { /* ya cerrado */ }
  for (const socket of serverConnections) { try { socket.destroy(); } catch { /* ya cerrado */ } }
  serverConnections.clear();
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return; // ya hay otra instancia viva: esta se va a cerrar
  errorLogPath = path.join(app.getPath('userData'), 'szvideo-errors.log');
  process.on('uncaughtException', error => logMainError(error, 'main process'));
  process.on('unhandledRejection', error => logMainError(error, 'main promise'));
  startBackgroundServer();
  ipcMain.handle('choose-video', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('file-fingerprint', async (_, filePath) => {
    const stat = await fs.promises.stat(filePath);
    return { path: filePath, name: path.basename(filePath), size: stat.size, modified: stat.mtime.toISOString(), sha256: await sha256(filePath) };
  });
  ipcMain.handle('file-exists', async (_, filePath) => { try { await fs.promises.access(filePath, fs.constants.F_OK); return true; } catch { return false; } });
  ipcMain.handle('save-case', async (_, payload) => {
    const result = await dialog.showSaveDialog({ defaultPath: `${payload.original?.name || 'video'}-szvideo-case.json`, filters: [{ name: 'SzVideo case', extensions: ['json'] }] });
    if (result.canceled) return null;
    await fs.promises.writeFile(result.filePath, JSON.stringify({ schema: 'szvideo-case/v1', createdAt: new Date().toISOString(), ...payload }, null, 2), 'utf8');
    return result.filePath;
  });
  ipcMain.handle('save-report', async (_, payload) => { const result = await dialog.showSaveDialog({ defaultPath: `${payload.original?.name || 'video'}-copyright-report.json`, filters: [{ name: 'Copyright report', extensions: ['json'] }] }); if (result.canceled) return null; await fs.promises.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8'); return result.filePath; });
  ipcMain.handle('save-evidence-case', async (_, content) => { const result = await dialog.showSaveDialog({ defaultPath: 'szvideo-evidence.szcase', filters: [{ name: 'SzVideo evidence', extensions: ['szcase'] }] }); if (result.canceled) return null; await fs.promises.writeFile(result.filePath, content, 'utf8'); return result.filePath; });
  ipcMain.handle('load-evidence-case', async () => { const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'SzVideo evidence', extensions: ['szcase', 'json'] }] }); if (result.canceled) return null; return { path: result.filePaths[0], content: await fs.promises.readFile(result.filePaths[0], 'utf8') }; });
  ipcMain.handle('save-mlt', async (_, xml) => {
    const result = await dialog.showSaveDialog({ defaultPath: 'szvideo-project.mlt', filters: [{ name: 'MLT project', extensions: ['mlt', 'xml'] }] });
    if (result.canceled) return null;
    await fs.promises.writeFile(result.filePath, xml, 'utf8');
    return result.filePath;
  });
  ipcMain.handle('save-project', async (_, { content, filePath }) => {
    if (!filePath) {
      const result = await dialog.showSaveDialog({ defaultPath: 'szvideo-project.szvideo', filters: [{ name: 'SzVideo project', extensions: ['szvideo'] }] });
      if (result.canceled) return null;
      filePath = result.filePath;
    }
    return writeFileAtomic(filePath, content);
  });
  ipcMain.handle('load-project', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'SzVideo project', extensions: ['szvideo', 'json'] }] });
    if (result.canceled) return null;
    const selectedPath = result.filePaths[0];
    await recoverAtomicFile(selectedPath);
    await cleanupAtomicFiles(selectedPath);
    return { path: selectedPath, content: await fs.promises.readFile(selectedPath, 'utf8') };
  });
  ipcMain.on('project-dirty', (_, dirty) => { rendererDirty = Boolean(dirty); });
  ipcMain.handle('allow-close', () => {
    clearTimeout(closeSafetyTimer);
    closeSafetyTimer = null;
    closing = true;
    rendererDirty = false;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    return true;
  });
  ipcMain.handle('write-recovery', async (_, content) => {
    const recoveryPath = path.join(app.getPath('userData'), 'szvideo-recovery.szvideo');
    return writeFileAtomic(recoveryPath, content);
  });
  ipcMain.handle('read-recovery', async () => {
    const recoveryPath = path.join(app.getPath('userData'), 'szvideo-recovery.szvideo');
    try { return { path: recoveryPath, content: await fs.promises.readFile(recoveryPath, 'utf8') }; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  });
  ipcMain.handle('delete-recovery', async () => {
    const recoveryPath = path.join(app.getPath('userData'), 'szvideo-recovery.szvideo');
    try { await fs.promises.unlink(recoveryPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return true;
  });
  ipcMain.handle('log-renderer-error', async (_, error) => { logMainError(error, 'renderer'); return true; });
  ipcMain.handle('create-proxy', async (event, { source, duration = 0, width = 640, height = -2, crf = 28 }) => {
    if (!source || !path.isAbsolute(source)) throw new Error('Proxy source must be an absolute local path');
    const proxyDir = path.join(app.getPath('userData'), 'proxies');
    await fs.promises.mkdir(proxyDir, { recursive: true });
    const id = crypto.createHash('sha256').update(`${source}|${width}|${height}|${crf}`).digest('hex').slice(0, 24);
    const output = path.join(proxyDir, `${id}.mp4`);
    try { await fs.promises.access(output); return { path: output, cached: true }; } catch {}
    const executable = await configuredFfmpeg();
    await new Promise((resolve, reject) => {
      const child = spawn(executable, ['-hide_banner', '-loglevel', 'error', '-i', source, '-vf', `scale=${width}:${height}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-an', '-progress', 'pipe:1', '-nostats', '-y', output], { windowsHide: true });
      let stderr = ''; let progress = {};
      child.stdout.on('data', chunk => {
        for (const line of chunk.toString().split(/\r?\n/)) {
          const separator = line.indexOf('='); if (separator < 0) continue;
          progress[line.slice(0, separator)] = line.slice(separator + 1);
          if (progress.out_time_ms && duration > 0) event.sender.send('proxy-progress', { percent: Math.min(99, Number(progress.out_time_ms) / 1000 / duration * 100), time: Number(progress.out_time_ms) / 1000000 });
        }
      });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.on('error', error => reject(new Error(`FFmpeg unavailable: ${error.message}`)));
      child.on('close', code => { if (code === 0) { event.sender.send('proxy-progress', { percent: 100, time: duration }); resolve(); } else reject(new Error(`FFmpeg proxy failed (${code}): ${stderr.trim()}`)); });
    });
    return { path: output, cached: false };
  });
  ipcMain.handle('ffmpeg-status', async () => {
    return checkFfmpeg(await configuredFfmpeg());
  });
  ipcMain.handle('choose-ffmpeg', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'FFmpeg executable', extensions: ['exe'] }] });
    if (result.canceled) return null;
    const status = await checkFfmpeg(result.filePaths[0]);
    if (!status.available) throw new Error(`El archivo seleccionado no es FFmpeg: ${status.error}`);
    await fs.promises.mkdir(path.dirname(ffmpegConfigPath()), { recursive: true });
    await fs.promises.writeFile(ffmpegConfigPath(), JSON.stringify({ path: result.filePaths[0], version: status.version }, null, 2), 'utf8');
    return status;
  });
  ipcMain.handle('choose-export-output', async (_, format = 'mp4') => { const result = await dialog.showSaveDialog({ defaultPath: `szvideo-export.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] }); return result.canceled ? null : result.filePath; });
  ipcMain.handle('validate-export-path', async (_, { input, output }) => {
    if (!input || !output) throw new Error('Fuente y salida son obligatorias');
    const inputStat = await fs.promises.stat(input); await fs.promises.access(input, fs.constants.R_OK);
    await fs.promises.access(path.dirname(output), fs.constants.W_OK);
    const stats = await fs.promises.statfs(path.dirname(output));
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    if (freeBytes < Math.max(100 * 1024 * 1024, inputStat.size * 2)) throw new Error('Espacio libre insuficiente');
    return { inputBytes: inputStat.size, freeBytes };
  });
  ipcMain.handle('inspect-metadata', async (_, input) => {
    if (!input || !path.isAbsolute(input)) throw new Error('Se requiere una ruta absoluta de vídeo');
    try { await fs.promises.access(input, fs.constants.R_OK); }
    catch { throw new Error('El archivo de vídeo no está disponible'); }
    const executable = await configuredFfmpeg();
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, ['-hide_banner', '-i', input], { windowsHide: true });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.on('error', error => reject(new Error(`FFmpeg no está disponible: ${error.message}`)));
      // `-i` sin salida devuelve un código distinto de 0 a propósito: el volcado vive en stderr.
      child.on('close', () => { if (stderr.includes('Input #')) resolve({ path: input, raw: stderr }); else reject(new Error(`FFmpeg no pudo leer el vídeo: ${stderr.trim().slice(-300)}`)); });
    });
  });
  ipcMain.handle('clean-metadata', async (event, { jobId, input, output, duration = 0 } = {}) => {
    if (!input || !output || !path.isAbsolute(input) || !path.isAbsolute(output)) throw new Error('Se requieren rutas absolutas de entrada y salida');
    const executable = await configuredFfmpeg();
    const { buildCleanArgs } = await loadMetadataPrivacy();
    let stripStreams = true;
    while (true) {
      try {
        return await new Promise((resolve, reject) => {
          const child = spawn(executable, buildCleanArgs({ input, output, stripStreams }), { windowsHide: true });
          metadataJobs.set(jobId, child);
          let stderr = '', progress = {};
          child.stdout.on('data', chunk => {
            for (const line of chunk.toString().split(/\r?\n/)) {
              const separator = line.indexOf('='); if (separator < 0) continue;
              progress[line.slice(0, separator)] = line.slice(separator + 1);
              if (progress.out_time_ms && duration > 0) event.sender.send('metadata-progress', { jobId, percent: Math.min(99, Number(progress.out_time_ms) / 1000 / duration * 100) });
            }
          });
          child.stderr.on('data', chunk => { stderr += chunk.toString(); });
          child.on('error', error => reject(new Error(`FFmpeg no está disponible: ${error.message}`)));
          child.on('close', code => {
            metadataJobs.delete(jobId);
            if (code === 0) {
              event.sender.send('metadata-progress', { jobId, percent: 100 });
              fs.promises.stat(output).then(stat => resolve({ path: output, backend: 'ffmpeg', bytes: stat.size })).catch(() => resolve({ path: output, backend: 'ffmpeg' }));
              return;
            }
            reject(new Error(code === null ? 'Limpieza cancelada' : `FFmpeg falló al limpiar metadatos (${code}): ${stderr.trim().slice(-400)}`));
          });
        });
      } catch (error) {
        // FFmpeg antiguos no soportan `-map_metadata:s -1`: reintenta limpiando solo los metadatos globales.
        if (stripStreams && /map_metadata/.test(error.message)) { stripStreams = false; continue; }
        throw error;
      }
    }
  });
  ipcMain.handle('cancel-metadata', (_, jobId) => { const child = metadataJobs.get(jobId); if (child) { child.kill(); return true; } return false; });
  ipcMain.handle('choose-clean-output', async (_, { input, format = 'mp4' } = {}) => {
    const baseName = input ? `${path.basename(input, path.extname(input))}-clean` : 'szvideo-clean';
    const result = await dialog.showSaveDialog({ defaultPath: `${baseName}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle('apply-audio-layers', async (event, { jobId, input, output, duration = 0, noiseType = 'ninguno', noiseVolume = 2, pitchPercent = 0 } = {}) => {
    if (!input || !output || !path.isAbsolute(input) || !path.isAbsolute(output)) throw new Error('Se requieren rutas absolutas de entrada y salida');
    const executable = await configuredFfmpeg();
    const { buildAudioLayerArgs, validateAudioLayersRequest } = await loadAudioLayer();
    validateAudioLayersRequest({ output, noiseType, noiseVolume, pitchPercent });
    // Intentos degradados: (1) completo → (2) sin -map_metadata:s → (3) amix de compatibilidad.
    const attempts = [
      { stripStreams: true, compatMix: false },
      { stripStreams: false, compatMix: false },
      { stripStreams: false, compatMix: true },
    ];
    for (const attempt of attempts) {
      try {
        return await new Promise((resolve, reject) => {
          const child = spawn(executable, buildAudioLayerArgs({ input, output, ...attempt, noiseType, noiseVolume, pitchPercent }), { windowsHide: true });
          audioJobs.set(jobId, child);
          let stderr = '', progress = {};
          child.stdout.on('data', chunk => {
            for (const line of chunk.toString().split(/\r?\n/)) {
              const separator = line.indexOf('='); if (separator < 0) continue;
              progress[line.slice(0, separator)] = line.slice(separator + 1);
              if (progress.out_time_ms && duration > 0) event.sender.send('audio-layers-progress', { jobId, percent: Math.min(99, Number(progress.out_time_ms) / 1000 / duration * 100) });
            }
          });
          child.stderr.on('data', chunk => { stderr += chunk.toString(); });
          child.on('error', error => reject(new Error(`FFmpeg no está disponible: ${error.message}`)));
          child.on('close', code => {
            audioJobs.delete(jobId);
            if (code === 0) {
              event.sender.send('audio-layers-progress', { jobId, percent: 100 });
              fs.promises.stat(output).then(stat => resolve({ path: output, backend: 'ffmpeg', bytes: stat.size })).catch(() => resolve({ path: output, backend: 'ffmpeg' }));
              return;
            }
            reject(new Error(code === null ? 'Aplicación de capas cancelada' : `FFmpeg falló al aplicar las capas de audio (${code}): ${stderr.trim().slice(-400)}`));
          });
        });
      } catch (error) {
        if (attempt.stripStreams && /map_metadata/.test(error.message)) continue;
        if (!attempt.compatMix && /amix|normalize/.test(error.message)) continue;
        throw error;
      }
    }
  });
  ipcMain.handle('cancel-audio-layers', (_, jobId) => { const child = audioJobs.get(jobId); if (child) { child.kill(); return true; } return false; });
  ipcMain.handle('choose-audio-output', async (_, { input, format = 'mp4' } = {}) => {
    const baseName = input ? `${path.basename(input, path.extname(input))}-capas` : 'szvideo-capas';
    const result = await dialog.showSaveDialog({ defaultPath: `${baseName}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle('apply-video-layers', async (event, { jobId, input, output, duration = 0, ...layers } = {}) => {
    if (!input || !output || !path.isAbsolute(input) || !path.isAbsolute(output)) throw new Error('Se requieren rutas absolutas de entrada y salida');
    const executable = await configuredFfmpeg();
    const { buildVisualLayerArgs, validateVisualLayersRequest } = await loadVisualLayer();
    validateVisualLayersRequest(layers);
    // Intentos degradados: (1) con audio → (2) sin metadatos de pista → (3) solo vídeo (sin pista de audio).
    const attempts = [
      { includeAudio: true, stripStreams: true },
      { includeAudio: true, stripStreams: false },
      { includeAudio: false, stripStreams: false },
    ];
    for (const attempt of attempts) {
      try {
        return await new Promise((resolve, reject) => {
          const child = spawn(executable, buildVisualLayerArgs({ input, output, ...attempt, ...layers }), { windowsHide: true });
          videoJobs.set(jobId, child);
          let stderr = '', progress = {};
          child.stdout.on('data', chunk => {
            for (const line of chunk.toString().split(/\r?\n/)) {
              const separator = line.indexOf('='); if (separator < 0) continue;
              progress[line.slice(0, separator)] = line.slice(separator + 1);
              if (progress.out_time_ms && duration > 0) event.sender.send('video-layers-progress', { jobId, percent: Math.min(99, Number(progress.out_time_ms) / 1000 / duration * 100) });
            }
          });
          child.stderr.on('data', chunk => { stderr += chunk.toString(); });
          child.on('error', error => reject(new Error(`FFmpeg no está disponible: ${error.message}`)));
          child.on('close', code => {
            videoJobs.delete(jobId);
            if (code === 0) {
              event.sender.send('video-layers-progress', { jobId, percent: 100 });
              fs.promises.stat(output).then(stat => resolve({ path: output, backend: 'ffmpeg', bytes: stat.size })).catch(() => resolve({ path: output, backend: 'ffmpeg' }));
              return;
            }
            reject(new Error(code === null ? 'Aplicación de efectos cancelada' : `FFmpeg falló al aplicar los efectos visuales (${code}): ${stderr.trim().slice(-400)}`));
          });
        });
      } catch (error) {
        if (attempt.stripStreams && /map_metadata/.test(error.message)) continue;
        if (attempt.includeAudio && /atempo|\[0:a\]|matches no streams|no such stream/i.test(error.message)) continue;
        throw error;
      }
    }
  });
  ipcMain.handle('cancel-video-layers', (_, jobId) => { const child = videoJobs.get(jobId); if (child) { child.kill(); return true; } return false; });
  ipcMain.handle('choose-video-layers-output', async (_, { input, format = 'mp4' } = {}) => {
    const baseName = input ? `${path.basename(input, path.extname(input))}-visual` : 'szvideo-visual';
    const result = await dialog.showSaveDialog({ defaultPath: `${baseName}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle('apply-stealth-preset', async (event, { jobId, input, output, duration = 0, ...overrides } = {}) => {
    if (!input || !output || !path.isAbsolute(input) || !path.isAbsolute(output)) throw new Error('Se requieren rutas absolutas de entrada y salida');
    const executable = await configuredFfmpeg();
    const { buildStealthPresetArgs } = await loadStealthPreset();
    // Intentos degradados: con audio → sin metadatos de pista → solo vídeo.
    const attempts = [
      { includeAudio: true, stripStreams: true },
      { includeAudio: true, stripStreams: false },
      { includeAudio: false, stripStreams: true },
      { includeAudio: false, stripStreams: false },
    ];
    for (const attempt of attempts) {
      try {
        return await new Promise((resolve, reject) => {
          const child = spawn(executable, buildStealthPresetArgs({ input, output, ...attempt, ...overrides }), { windowsHide: true });
          stealthJobs.set(jobId, child);
          let stderr = '', progress = {};
          child.stdout.on('data', chunk => {
            for (const line of chunk.toString().split(/\r?\n/)) {
              const separator = line.indexOf('='); if (separator < 0) continue;
              progress[line.slice(0, separator)] = line.slice(separator + 1);
              if (progress.out_time_ms && duration > 0) event.sender.send('stealth-progress', { jobId, percent: Math.min(99, Number(progress.out_time_ms) / 1000 / duration * 100) });
            }
          });
          child.stderr.on('data', chunk => { stderr += chunk.toString(); });
          child.on('error', error => reject(new Error(`FFmpeg no está disponible: ${error.message}`)));
          child.on('close', code => {
            stealthJobs.delete(jobId);
            if (code === 0) {
              event.sender.send('stealth-progress', { jobId, percent: 100 });
              fs.promises.stat(output).then(stat => resolve({ path: output, backend: 'ffmpeg', bytes: stat.size })).catch(() => resolve({ path: output, backend: 'ffmpeg' }));
              return;
            }
            reject(new Error(code === null ? 'Preset cancelado' : `FFmpeg falló al aplicar el preset (${code}): ${stderr.trim().slice(-400)}`));
          });
        });
      } catch (error) {
        if (attempt.stripStreams && /map_metadata/.test(error.message)) continue;
        if (attempt.includeAudio && /atempo|\[0:a\]|matches no streams|no such stream/i.test(error.message)) continue;
        throw error;
      }
    }
  });
  ipcMain.handle('cancel-stealth-preset', (_, jobId) => { const child = stealthJobs.get(jobId); if (child) { child.kill(); return true; } return false; });
  ipcMain.handle('choose-stealth-output', async (_, { input, format = 'mp4' } = {}) => {
    const baseName = input ? `${path.basename(input, path.extname(input))}-stealth` : 'szvideo-stealth';
    const result = await dialog.showSaveDialog({ defaultPath: `${baseName}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle('intelligence-ask', async (_, { prompt, model } = {}) => {
    if (!prompt) throw new Error('Se requiere un prompt para el modelo');
    const ollamaUrl = process.env.SZVIDEO_OLLAMA || 'http://127.0.0.1:11434';
    const modelId = model || process.env.SZVIDEO_OLLAMA_MODEL || 'llama3.2';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${ollamaUrl}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: modelId, prompt, stream: false, options: { temperature: 0.4, num_predict: 512 } }), signal: controller.signal });
      if (!response.ok) return { available: false, error: `Ollama respondió HTTP ${response.status}` };
      const data = await response.json();
      return { available: true, text: data.response, model: modelId };
    } catch (error) {
      return { available: false, error: error.name === 'AbortError' ? 'Ollama no respondió a tiempo' : `Ollama no disponible: ${error.message}` };
    } finally {
      clearTimeout(timer);
    }
  });
  ipcMain.handle('save-native-output', async (_, { filePath, bytes } = {}) => {
    if (!filePath || !path.isAbsolute(filePath)) throw new Error('Se requiere una ruta absoluta de salida');
    if (!bytes) throw new Error('No hay datos de la captura nativa');
    return writeFileAtomic(filePath, Buffer.from(new Uint8Array(bytes)));
  });
  ipcMain.handle('choose-native-output', async (_, { input, extension = 'webm' } = {}) => {
    const baseName = input ? `${path.basename(input, path.extname(input))}-nativo` : 'szvideo-nativo';
    const result = await dialog.showSaveDialog({ defaultPath: `${baseName}.${extension}`, filters: [{ name: 'Vídeo nativo', extensions: [extension] }] });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle('apply-advanced-obfuscation', async (event, { jobId, input, output, duration = 0, modes, intensity = 5, fps = 30, start = null, seconds = null, metadata = null, includeAudio = true, stripStreams = true, chainOverride = null } = {}) => {
    if (!input || !output || !path.isAbsolute(input) || !path.isAbsolute(output)) throw new Error('Se requieren rutas absolutas de entrada y salida');
    const executable = await configuredFfmpeg();
    const { buildAdvancedObfuscationArgs, validateAdvancedRequest } = await loadAdvancedObfuscation();
    validateAdvancedRequest({ input, output, modes: chainOverride ? ['dct'] : modes, intensity, fps });
    // Intentos degradados: (1) con audio copiado → (2) sin pista de audio (vídeos sin audio o antiguos).
    const attempts = [{ includeAudio: true }, { includeAudio: false }];
    for (const attempt of attempts) {
      try {
        return await new Promise((resolve, reject) => {
          const args = buildAdvancedObfuscationArgs({ input, output, modes, intensity, fps, start, seconds, metadata, chainOverride, ...attempt });
          const child = spawn(executable, args, { windowsHide: true });
          advancedJobs.set(jobId, child);
          let stderr = '', progress = {};
          child.stdout.on('data', chunk => {
            for (const line of chunk.toString().split(/\r?\n/)) {
              const separator = line.indexOf('='); if (separator < 0) continue;
              progress[line.slice(0, separator)] = line.slice(separator + 1);
              if (progress.out_time_ms && duration > 0) event.sender.send('advanced-progress', { jobId, percent: Math.min(99, Number(progress.out_time_ms) / 1000 / duration * 100) });
            }
          });
          child.stderr.on('data', chunk => { stderr += chunk.toString(); });
          child.on('error', error => reject(new Error(`FFmpeg no está disponible: ${error.message}`)));
          child.on('close', code => {
            advancedJobs.delete(jobId);
            if (code === 0) {
              event.sender.send('advanced-progress', { jobId, percent: 100 });
              fs.promises.stat(output).then(stat => resolve({ path: output, backend: 'ffmpeg', bytes: stat.size, chain: args[args.indexOf('-filter_complex') + 1] })).catch(() => resolve({ path: output, backend: 'ffmpeg' }));
              return;
            }
            reject(new Error(code === null ? 'Ofuscación cancelada' : `FFmpeg falló al aplicar la ofuscación avanzada (${code}): ${stderr.trim().slice(-400)}`));
          });
        });
      } catch (error) {
        if (attempt.includeAudio && /atempo|0:a|matches no streams|no such stream|Stream map/i.test(error.message)) continue;
        throw error;
      }
    }
  });
  ipcMain.handle('normalize-signal', async (event, { jobId, input, output, duration = 0, level = 2, normalizeGeometry = true, seconds = null } = {}) => {
    if (!input || !output || !path.isAbsolute(input) || !path.isAbsolute(output)) throw new Error('Se requieren rutas absolutas de entrada y salida');
    const executable = await configuredFfmpeg();
    const { buildNormalizationArgs } = await loadAdvancedObfuscation();
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, buildNormalizationArgs({ input, output, level, normalizeGeometry, seconds }), { windowsHide: true });
      advancedJobs.set(jobId, child);
      let stderr = '', progress = {};
      child.stdout.on('data', chunk => {
        for (const line of chunk.toString().split(/\r?\n/)) {
          const separator = line.indexOf('='); if (separator < 0) continue;
          progress[line.slice(0, separator)] = line.slice(separator + 1);
          if (progress.out_time_ms && duration > 0) event.sender.send('advanced-progress', { jobId, percent: Math.min(99, Number(progress.out_time_ms) / 1000 / duration * 100) });
        }
      });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.on('error', error => reject(new Error(`FFmpeg no está disponible: ${error.message}`)));
      child.on('close', code => {
        advancedJobs.delete(jobId);
        if (code === 0) { event.sender.send('advanced-progress', { jobId, percent: 100 }); resolve({ path: output, backend: 'ffmpeg' }); return; }
        reject(new Error(code === null ? 'Normalización cancelada' : `FFmpeg falló al normalizar (${code}): ${stderr.trim().slice(-400)}`));
      });
    });
  });
  ipcMain.handle('noblur-inflate', async (event, { jobId, input, output, multiplier = 10 } = {}) => {
    if (!input || !output || !path.isAbsolute(input) || !path.isAbsolute(output)) throw new Error('Se requieren rutas absolutas de entrada y salida');
    const { prepareNoBlur, MULTIPLIER_MIN, MULTIPLIER_MAX } = await loadMp4Patch();
    if (!Number.isFinite(Number(multiplier)) || multiplier < MULTIPLIER_MIN || multiplier > MULTIPLIER_MAX) {
      throw new Error(`El factor de inflado debe estar entre ${MULTIPLIER_MIN} y ${MULTIPLIER_MAX}`);
    }
    event.sender.send('noblur-progress', { jobId, percent: 3 });
    const source = new Uint8Array(await fs.promises.readFile(input));
    event.sender.send('noblur-progress', { jobId, percent: 15 });
    // 100 % sin FFmpeg: normaliza el contenedor e infla la tabla de muestras en memoria.
    const result = prepareNoBlur(source, { multiplier: Number(multiplier) });
    event.sender.send('noblur-progress', { jobId, percent: 70 });
    await writeFileAtomic(output, Buffer.from(result.bytes));
    event.sender.send('noblur-progress', { jobId, percent: 100 });
    return { path: output, stats: result.stats, backend: 'noblur', bytes: (await fs.promises.stat(output)).size };
  });
  ipcMain.handle('noblur-patch', async (event, { jobId, input, output, duration = 0, multiplier = 10, legal = false } = {}) => {
    if (!input || !output || !path.isAbsolute(input) || !path.isAbsolute(output)) throw new Error('Se requieren rutas absolutas de entrada y salida');
    const { prepareNoBlur, MULTIPLIER_MIN, MULTIPLIER_MAX } = await loadMp4Patch();
    if (!Number.isFinite(Number(multiplier)) || multiplier < MULTIPLIER_MIN || multiplier > MULTIPLIER_MAX) {
      throw new Error(`El factor de inflado debe estar entre ${MULTIPLIER_MIN} y ${MULTIPLIER_MAX}`);
    }
    let workingInput = input;
    let temporaryLegal = null;
    if (legal) {
      // Fase 1: obfuscación legal (preset TikTok Studio: H.264 High · yuv420p · AAC · faststart).
      const executable = await configuredFfmpeg();
      const { buildStealthPresetArgs } = await loadStealthPreset();
      temporaryLegal = path.join(path.dirname(output), `.${path.basename(output, '.mp4')}-legal-${jobId}.mp4`);
      event.sender.send('noblur-progress', { jobId, percent: 2 });
      await new Promise((resolve, reject) => {
        const child = spawn(executable, buildStealthPresetArgs({ input, output: temporaryLegal }), { windowsHide: true });
        noblurJobs.set(jobId, child);
        let stderr = '', progress = {};
        child.stdout.on('data', chunk => {
          for (const line of chunk.toString().split(/\r?\n/)) {
            const separator = line.indexOf('='); if (separator < 0) continue;
            progress[line.slice(0, separator)] = line.slice(separator + 1);
            if (progress.out_time_ms && duration > 0) event.sender.send('noblur-progress', { jobId, percent: Math.min(59, Number(progress.out_time_ms) / 1000 / duration * 55) });
          }
        });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.on('error', error => { noblurJobs.delete(jobId); reject(new Error(`FFmpeg no está disponible: ${error.message}`)); });
        child.on('close', code => {
          noblurJobs.delete(jobId);
          if (noblurCancelled.has(jobId)) { try { fs.promises.unlink(temporaryLegal).catch(() => {}); } catch {} reject(new Error('Parche cancelado')); return; }
          if (code !== 0) { try { fs.promises.unlink(temporaryLegal).catch(() => {}); } catch {} reject(new Error(`FFmpeg falló en la obfuscación legal (${code}): ${stderr.trim().slice(-400)}`)); return; }
          resolve();
        });
      });
      workingInput = temporaryLegal;
      event.sender.send('noblur-progress', { jobId, percent: 62 });
    }
    // Fase 2: parche NoBlur del contenedor (segundos, sin re-encode).
    try {
      event.sender.send('noblur-progress', { jobId, percent: legal ? 66 : 3 });
      const source = new Uint8Array(await fs.promises.readFile(workingInput));
      event.sender.send('noblur-progress', { jobId, percent: legal ? 78 : 15 });
      const result = prepareNoBlur(source, { multiplier: Number(multiplier) });
      event.sender.send('noblur-progress', { jobId, percent: legal ? 90 : 70 });
      await writeFileAtomic(output, Buffer.from(result.bytes));
      if (temporaryLegal) { try { await fs.promises.unlink(temporaryLegal); } catch { /* best effort */ } }
      event.sender.send('noblur-progress', { jobId, percent: 100 });
      return { path: output, stats: result.stats, backend: legal ? 'legal+noblur' : 'noblur', bytes: (await fs.promises.stat(output)).size, legal };
    } catch (error) {
      if (temporaryLegal) { try { await fs.promises.unlink(temporaryLegal); } catch { /* best effort */ } }
      throw error;
    }
  });
  ipcMain.handle('noblur-vfi', async (event, { jobId, input, output, duration = 0, multiplier = 10, fps = 60, resolution = 'original' } = {}) => {
    if (!input || !output || !path.isAbsolute(input) || !path.isAbsolute(output)) throw new Error('Se requieren rutas absolutas de entrada y salida');
    const executable = await configuredFfmpeg();
    const { buildVfiArgs, prepareNoBlur, MULTIPLIER_MIN, MULTIPLIER_MAX } = await loadMp4Patch();
    if (!Number.isFinite(Number(multiplier)) || multiplier < MULTIPLIER_MIN || multiplier > MULTIPLIER_MAX) {
      throw new Error(`El factor de inflado debe estar entre ${MULTIPLIER_MIN} y ${MULTIPLIER_MAX}`);
    }
    const temporaryVfi = path.join(path.dirname(output), `.${path.basename(output, '.mp4')}-vfi-${jobId}.mp4`);
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, buildVfiArgs({ input, output: temporaryVfi, fps: Number(fps), resolution }), { windowsHide: true });
      noblurJobs.set(jobId, child);
      let stderr = '', progress = {};
      child.stdout.on('data', chunk => {
        for (const line of chunk.toString().split(/\r?\n/)) {
          const separator = line.indexOf('='); if (separator < 0) continue;
          progress[line.slice(0, separator)] = line.slice(separator + 1);
          if (progress.out_time_ms && duration > 0) event.sender.send('noblur-progress', { jobId, percent: Math.min(69, Number(progress.out_time_ms) / 1000 / duration * 60) });
        }
      });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.on('error', error => { noblurJobs.delete(jobId); reject(new Error(`FFmpeg no está disponible: ${error.message}`)); });
      child.on('close', async code => {
        noblurJobs.delete(jobId);
        if (noblurCancelled.has(jobId)) { noblurCancelled.delete(jobId); try { await fs.promises.unlink(temporaryVfi); } catch {} reject(new Error('NoBlur cancelado')); return; }
        if (code !== 0) {
          try { await fs.promises.unlink(temporaryVfi); } catch {}
          reject(new Error(`FFmpeg falló en la interpolación VFI (${code}): ${stderr.trim().slice(-400)}`));
          return;
        }
        // Fase 2: el resultado interpolado se infla (mismo parche de contenedor, sin re-encode extra).
        try {
          event.sender.send('noblur-progress', { jobId, percent: 72 });
          const source = new Uint8Array(await fs.promises.readFile(temporaryVfi));
          const inflated = prepareNoBlur(source, { multiplier: Number(multiplier) });
          event.sender.send('noblur-progress', { jobId, percent: 88 });
          await writeFileAtomic(output, Buffer.from(inflated.bytes));
          try { await fs.promises.unlink(temporaryVfi); } catch {}
          event.sender.send('noblur-progress', { jobId, percent: 100 });
          resolve({ path: output, stats: inflated.stats, backend: 'ffmpeg+noblur' });
        } catch (error) {
          try { await fs.promises.unlink(temporaryVfi); } catch {}
          reject(error);
        }
      });
    });
  });
  ipcMain.handle('cancel-noblur', (_, jobId) => {
    noblurCancelled.add(jobId);
    const child = noblurJobs.get(jobId);
    if (child) { child.kill(); return true; }
    return false;
  });
  ipcMain.handle('cancel-advanced', (_, jobId) => { const child = advancedJobs.get(jobId); if (child) { child.kill(); return true; } return false; });
  ipcMain.handle('cancel-export', (_, jobId) => { const child = exportJobs.get(jobId); if (child) { child.kill(); return true; } return false; });
  ipcMain.handle('export-video', async (event, { jobId, input, output, duration = 0, format = 'mp4', crf = 18 }) => {
    if (!input || !output) throw new Error('Input and output are required');
    const executable = await configuredFfmpeg();
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, ['-hide_banner', '-loglevel', 'error', '-i', input, '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-c:a', 'aac', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', '-f', format, '-y', output], { windowsHide: true });
      exportJobs.set(jobId, child);
      let stderr = '', progress = {};
      child.stdout.on('data', chunk => { for (const line of chunk.toString().split(/\r?\n/)) { const index = line.indexOf('='); if (index < 0) continue; progress[line.slice(0, index)] = line.slice(index + 1); if (progress.out_time_ms && duration > 0) event.sender.send('export-progress', { jobId, percent: Math.min(99, Number(progress.out_time_ms) / 1000 / duration * 100) }); } });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.on('error', error => reject(new Error(`FFmpeg unavailable: ${error.message}`)));
      child.on('close', code => { exportJobs.delete(jobId); code === 0 ? (event.sender.send('export-progress', { jobId, percent: 100 }), resolve({ path: output, backend: 'ffmpeg' })) : reject(new Error(code === null ? 'Exportación cancelada' : `FFmpeg export failed (${code}): ${stderr.trim()}`)); });
    });
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0 && server) createWindow(); });
});
app.on('before-quit', () => { closing = true; stopBackgroundServer(); });
app.on('will-quit', () => { closing = true; stopBackgroundServer(); });
app.on('window-all-closed', () => { closing = true; stopBackgroundServer(); if (process.platform !== 'darwin') app.quit(); });
