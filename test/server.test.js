import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createSzVideoServer } from '../electron/server.cjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(__dirname, '..', 'public');
const projectRoot = path.resolve(publicRoot, '..');

function fetchAsync(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, options, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
  });
}

async function withServer(fn) {
  const instance = createSzVideoServer({ publicRoot, projectRoot });
  instance.listen(0, '127.0.0.1');
  await new Promise(resolve => instance.server.once('listening', resolve));
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  try {
    return await fn(base, instance);
  } finally {
    instance.stop();
  }
}

test('sirve la UI desde public/', async () => {
  await withServer(async base => {
    const html = await fetchAsync(`${base}/index.html`);
    assert.equal(html.status, 200);
    assert.match(html.body.toString(), /script type="module"/);
    const css = await fetchAsync(`${base}/styles.css`);
    assert.equal(css.status, 200);
    assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
  });
});

test('sirve los módulos ES de ../src (antes 404, era el bug que mataba la app)', async () => {
  await withServer(async base => {
    for (const modulePath of ['/src/analyzer.js', '/src/intelligenceCore.js', '/src/localMediaUrl.js']) {
      const response = await fetchAsync(`${base}${modulePath}`);
      assert.equal(response.status, 200, modulePath);
      assert.match(response.headers['content-type'], /text\/javascript/);
    }
    const app = await fetchAsync(`${base}/app.js`);
    assert.equal(app.status, 200);
  });
});

test('bloquea el acceso fuera del proyecto', async () => {
  await withServer(async base => {
    assert.equal((await fetchAsync(`${base}/package.json`)).status, 404);
    assert.equal((await fetchAsync(`${base}/electron/main.cjs`)).status, 404);
    const traversal = await fetchAsync(`${base}/..%2F..%2Fpackage.json`);
    assert.ok([403, 404].includes(traversal.status));
  });
});

test('sirve medios locales con Range completo y sufijo', async () => {
  const mediaFile = path.join(os.tmpdir(), `szvideo-test-${Date.now()}.mp4`);
  const payload = Buffer.from('0123456789'.repeat(20)); // 200 bytes
  fs.writeFileSync(mediaFile, payload);
  await withServer(async base => {
    const url = `${base}/local-media?path=${encodeURIComponent(mediaFile)}`;
    const full = await fetchAsync(url);
    assert.equal(full.status, 200);
    assert.equal(full.body.length, 200);
    assert.equal(full.headers['accept-ranges'], 'bytes');
    const partial = await fetchAsync(url, { headers: { range: 'bytes=10-19' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.body.toString(), '0123456789');
    assert.equal(partial.headers['content-range'], 'bytes 10-19/200');
    const suffix = await fetchAsync(url, { headers: { range: 'bytes=-5' } });
    assert.equal(suffix.status, 206);
    assert.equal(suffix.body.toString(), '56789');
    const rejected = await fetchAsync(`${base}/local-media?path=${encodeURIComponent(path.join(projectRoot, 'package.json'))}`);
    assert.equal(rejected.status, 403); // extensión no permitida
  });
  fs.unlinkSync(mediaFile);
});

test('stop() destruye las conexiones activas y libera el puerto al instante', async () => {
  const instance = createSzVideoServer({ publicRoot, projectRoot });
  instance.listen(0, '127.0.0.1');
  await new Promise(resolve => instance.server.once('listening', resolve));
  const port = instance.server.address().port;
  // Deja una conexión abierta (como un <video> reproduciéndose)
  const held = http.get(`http://127.0.0.1:${port}/index.html`, () => {});
  await new Promise(resolve => setTimeout(resolve, 150));
  instance.stop();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(instance.connections.size, 0);
  // El puerto queda libre: otro servidor puede usarlo
  const second = createSzVideoServer({ publicRoot, projectRoot });
  await new Promise((resolve, reject) => {
    second.server.once('error', reject);
    second.server.once('listening', resolve);
    second.listen(port, '127.0.0.1');
  });
  second.stop();
  held.destroy();
});
