/** Servidor HTTP interno de SzVideo: sirve la UI, los módulos ES de src/ y los medios
 *  locales con soporte de Range. Se crea por la propia app al iniciar (sin ventana) y
 *  se apaga al cerrar. Puro Node: testeable sin Electron. */

const http = require('http');
const fs = require('fs');
const path = require('path');

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const mediaMimeTypes = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };

/** Sirve un fichero local de medios con soporte de Range (necesario para buscar en el vídeo). */
function serveLocalMedia(request, response, searchParams, logError = () => {}) {
  try {
    const mediaPath = searchParams.get('path');
    if (!mediaPath || !path.isAbsolute(mediaPath)) { response.writeHead(400); response.end('Se requiere una ruta absoluta'); return; }
    const extension = path.extname(mediaPath).toLowerCase();
    if (!mediaMimeTypes[extension]) { response.writeHead(403); response.end('Tipo de archivo no permitido'); return; }
    let stat;
    try { stat = fs.statSync(mediaPath); } catch { response.writeHead(404); response.end('No encontrado'); return; }
    const headers = { 'Content-Type': mediaMimeTypes[extension], 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    let start = 0;
    let end = stat.size - 1;
    const range = (request.headers.range || '').match(/bytes=(\d*)-(\d*)/);
    if (range) {
      if (range[1] === '' && range[2]) {
        // Sufijo «bytes=-N»: los últimos N bytes.
        start = Math.max(0, stat.size - Number(range[2]));
        end = stat.size - 1;
      } else {
        if (range[1]) start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), stat.size - 1);
      }
      if (start > end || start >= stat.size) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      headers['Content-Length'] = end - start + 1;
      response.writeHead(206, headers);
    } else {
      headers['Content-Length'] = stat.size;
      response.writeHead(200, headers);
    }
    if (request.method === 'HEAD') { response.end(); return; }
    fs.createReadStream(mediaPath, { start, end }).pipe(response);
  } catch (error) {
    logError(error);
    try { response.writeHead(500); response.end('Error interno'); } catch { /* ya cerrada */ }
  }
}

/** Ficheros estáticos de public/ (y módulos ES de ../src como fallback, solo .js). */
function serveStatic(publicRoot, projectRoot, requestUrl, response) {
  const relative = decodeURIComponent(requestUrl.pathname) === '/' ? 'index.html' : decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
  let filePath = path.resolve(publicRoot, relative);
  if (!filePath.startsWith(publicRoot + path.sep)) { response.writeHead(403); response.end('Forbidden'); return Promise.resolve(); }
  if (!fs.existsSync(filePath)) {
    // Los módulos ES viven en ../src: se sirven desde la raíz del proyecto (solo .js, lectura local).
    const alternative = path.resolve(projectRoot, relative);
    if (alternative.startsWith(projectRoot + path.sep) && alternative.endsWith('.js')) filePath = alternative;
  }
  return fs.promises.readFile(filePath)
    .then(data => {
      response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(data);
    })
    .catch(() => { response.writeHead(404); response.end('Not found'); });
}

/** Crea el servidor (no escucha aún). Los errores se notifican vía onError. */
function createSzVideoServer({ publicRoot, projectRoot, onError = () => {} } = {}) {
  const connections = new Set();
  const server = http.createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://localhost');
      if (requestUrl.pathname === '/local-media') { serveLocalMedia(request, response, requestUrl.searchParams, onError); return; }
      serveStatic(publicRoot, projectRoot, requestUrl, response).catch(error => { onError(error); try { response.writeHead(500); response.end('Error interno'); } catch { /* ya cerrada */ } });
    } catch (error) {
      onError(error);
      try { response.writeHead(500); response.end('Error interno'); } catch { /* ya cerrada */ }
    }
  });
  server.on('connection', socket => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  });
  return {
    server,
    connections,
    listen(port = 0, host = '127.0.0.1') { server.listen(port, host); },
    /** Apaga el servidor y destruye las conexiones activas (el puerto queda libre al instante). */
    stop() {
      try { server.close(() => {}); } catch { /* ya cerrado */ }
      for (const socket of connections) { try { socket.destroy(); } catch { /* ya cerrado */ } }
      connections.clear();
    },
  };
}

module.exports = { createSzVideoServer, serveLocalMedia, serveStatic, mediaMimeTypes, mimeTypes };
