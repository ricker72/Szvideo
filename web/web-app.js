/**
 * SzVideo Web — NoBlur (cola + historial) + Salud de publicación
 * Inspirado en las mejores prácticas de UX de NoBlur (irgifebry):
 * cola secuencial, cancelación, historial IndexedDB, thumbnails, wake lock.
 * Todo corre 100 % en el navegador.
 */

import { prepareNoBlur, MULTIPLIER_DEFAULT } from './mp4Patch.js';
import {
  CHECK_ITEMS,
  assessPublishReadiness,
} from './publishReadiness.js';

const MAX_BYTES = 1.5 * 1024 * 1024 * 1024;
const DB_NAME = 'szvideo-history';
const DB_STORE = 'patched';
const DB_VERSION = 1;

/* ========== Tabs ========== */
const tabs = document.querySelectorAll('.tab');
const panels = {
  noblur: document.getElementById('panel-noblur'),
  salud: document.getElementById('panel-salud'),
  info: document.getElementById('panel-info'),
};
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const id = tab.dataset.tab;
    tabs.forEach(t => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
    });
    Object.entries(panels).forEach(([key, el]) => {
      if (!el) return;
      const active = key === id;
      el.classList.toggle('active', active);
      el.hidden = !active;
    });
  });
});

/* ========== DOM ========== */
const drop = document.getElementById('drop');
const fileInput = document.getElementById('fileInput');
const mult = document.getElementById('mult');
const multLabel = document.getElementById('multLabel');
const patchBtn = document.getElementById('patchBtn');
const cancelBtn = document.getElementById('cancelBtn');
const clearBtn = document.getElementById('clearBtn');
const bar = document.getElementById('bar');
const out = document.getElementById('out');
const queueEl = document.getElementById('queue');
const historyList = document.getElementById('historyList');
const historyBadge = document.getElementById('historyBadge');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

/* ========== State ========== */
/** @type {{ file: File, id: string, status: string, thumb?: string, result?: any, error?: string, blobUrl?: string }[]} */
let queue = [];
let cancelled = false;
let processing = false;
let wakeLock = null;

mult.addEventListener('input', () => { multLabel.textContent = mult.value; });

/* ========== Drop / file select ========== */
drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') fileInput.click();
});
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => {
  e.preventDefault();
  drop.classList.remove('over');
  addFiles([...e.dataTransfer.files]);
});
fileInput.addEventListener('change', () => {
  addFiles([...fileInput.files]);
  fileInput.value = '';
});

function addFiles(files) {
  const accepted = files.filter(f => /\.(mp4|mov|m4v)$/i.test(f.name));
  if (!accepted.length) {
    logLine('✖ Formato no soportado. Usa MP4, MOV o M4V.', 'err');
    return;
  }
  for (const file of accepted) {
    if (file.size > MAX_BYTES) {
      logLine(`✖ ${file.name}: supera ~1,5 GB. Usa la app de escritorio.`, 'err');
      continue;
    }
    if (queue.some(q => q.file.name === file.name && q.file.size === file.size)) continue;
    const item = {
      file,
      id: `${file.name}-${file.size}-${Date.now()}`,
      status: 'pending',
    };
    queue.push(item);
    captureThumb(item);
  }
  renderQueue();
  updateButtons();
  if (queue.length) logLine(`${queue.filter(q => q.status === 'pending').length} archivo(s) en cola. Pulsa «Parchear cola».`);
}

async function captureThumb(item) {
  try {
    const url = URL.createObjectURL(item.file);
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    video.src = url;
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 5000);
      video.onloadeddata = () => { clearTimeout(t); resolve(); };
      video.onerror = () => { clearTimeout(t); reject(new Error('error')); };
    });
    video.currentTime = 0.1;
    await new Promise(r => { video.onseeked = r; });
    const canvas = document.createElement('canvas');
    const max = 120;
    const ratio = video.videoWidth / video.videoHeight || 16 / 9;
    canvas.width = ratio >= 1 ? max : Math.round(max * ratio);
    canvas.height = ratio >= 1 ? Math.round(max / ratio) : max;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    item.thumb = canvas.toDataURL('image/jpeg', 0.7);
    URL.revokeObjectURL(url);
    renderQueue();
  } catch {
    // thumbnail optional
  }
}

function renderQueue() {
  if (!queue.length) {
    queueEl.hidden = true;
    queueEl.innerHTML = '';
    return;
  }
  queueEl.hidden = false;
  queueEl.innerHTML = queue.map(item => {
    const statusClass = item.status === 'done' ? 'ok' : item.status === 'error' ? 'err' : item.status === 'running' ? 'run' : '';
    const statusText = {
      pending: 'En cola',
      running: 'Procesando…',
      done: 'Listo',
      error: item.error || 'Error',
      cancelled: 'Cancelado',
    }[item.status] || item.status;
    const dl = item.blobUrl
      ? `<a class="dl" href="${item.blobUrl}" download="${item.file.name.replace(/\.[^.]+$/, '')}-noblur.mp4">⬇ Descargar</a>`
      : '';
    const thumb = item.thumb
      ? `<img class="thumb" src="${item.thumb}" alt="">`
      : `<div class="thumb"></div>`;
    return `<div class="queue-item" data-id="${item.id}">
      ${thumb}
      <div class="meta">
        <div class="name">${escapeHtml(item.file.name)}</div>
        <div class="status ${statusClass}">${statusText} · ${(item.file.size / 1048576).toFixed(1)} MB</div>
      </div>
      ${dl}
    </div>`;
  }).join('');
}

function updateButtons() {
  const hasPending = queue.some(q => q.status === 'pending');
  const hasAny = queue.length > 0;
  patchBtn.disabled = !hasPending || processing;
  clearBtn.disabled = !hasAny || processing;
  cancelBtn.hidden = !processing;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function logLine(text, cls) {
  const span = cls ? `<span class="${cls}">${text}</span>` : text;
  if (out.innerHTML.includes('Arrastra vídeos') || out.textContent.startsWith('Arrastra')) {
    out.innerHTML = span;
  } else {
    out.innerHTML += (out.innerHTML ? '\n' : '') + span;
  }
  out.scrollTop = out.scrollHeight;
}

/* ========== Processing ========== */
patchBtn.addEventListener('click', () => processQueue());
cancelBtn.addEventListener('click', () => { cancelled = true; logLine('Cancelando…', 'warn'); });
clearBtn.addEventListener('click', () => {
  queue.forEach(q => { if (q.blobUrl) URL.revokeObjectURL(q.blobUrl); });
  queue = [];
  renderQueue();
  updateButtons();
  out.textContent = 'Cola vacía.';
  bar.hidden = true;
});

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { /* ignore */ }
}
function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

async function processQueue() {
  if (processing) return;
  processing = true;
  cancelled = false;
  updateButtons();
  bar.hidden = false;
  await requestWakeLock();

  const pending = queue.filter(q => q.status === 'pending');
  let done = 0;

  for (const item of pending) {
    if (cancelled) {
      item.status = 'cancelled';
      continue;
    }
    item.status = 'running';
    renderQueue();
    logLine(`▶ ${item.file.name}…`);

    try {
      const multiplier = Math.max(2, Math.min(20, Number(mult.value) || MULTIPLIER_DEFAULT));
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      // Yield to UI
      await new Promise(r => setTimeout(r, 20));
      const result = prepareNoBlur(bytes, { multiplier });
      const blob = new Blob([result.bytes], { type: 'video/mp4' });
      item.blobUrl = URL.createObjectURL(blob);
      item.result = result.stats;
      item.status = 'done';
      logLine(`✔ ${item.file.name} — ${result.stats.codec} · ×${result.stats.multiplier} · +${(result.stats.bytesAdded / 1024).toFixed(1)} KB`, 'ok');
      await saveToHistory(item, blob);
    } catch (err) {
      item.status = 'error';
      item.error = err.message || String(err);
      logLine(`✖ ${item.file.name}: ${item.error}`, 'err');
    }

    done += 1;
    bar.value = Math.round((done / pending.length) * 100);
    renderQueue();
    updateButtons();
  }

  releaseWakeLock();
  processing = false;
  updateButtons();
  if (cancelled) logLine('Proceso cancelado.', 'warn');
  else logLine('Cola terminada.', 'ok');
  await loadHistory();
}

/* ========== IndexedDB History ========== */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveToHistory(item, blob) {
  try {
    const db = await openDb();
    const record = {
      id: item.id,
      name: item.file.name,
      size: item.file.size,
      thumb: item.thumb || null,
      stats: item.result || null,
      blob,
      createdAt: Date.now(),
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // history is best-effort
  }
}

async function loadHistory() {
  try {
    const db = await openDb();
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    records.sort((a, b) => b.createdAt - a.createdAt);
    historyBadge.textContent = String(records.length);
    if (!records.length) {
      historyList.innerHTML = '<p class="muted small">Los vídeos parcheados se guardan aquí (IndexedDB) para volver a descargarlos.</p>';
      return;
    }
    historyList.innerHTML = records.slice(0, 30).map(r => {
      const when = new Date(r.createdAt).toLocaleString();
      const thumb = r.thumb ? `<img class="thumb" src="${r.thumb}" alt="">` : '<div class="thumb"></div>';
      return `<div class="history-item" data-id="${r.id}">
        ${thumb}
        <div class="meta">
          <div class="name">${escapeHtml(r.name)}</div>
          <div class="when">${when} · ${(r.size / 1048576).toFixed(1)} MB</div>
        </div>
        <button type="button" data-action="download">Descargar</button>
        <button type="button" data-action="delete">Eliminar</button>
      </div>`;
    }).join('');

    historyList.querySelectorAll('.history-item').forEach(el => {
      const id = el.dataset.id;
      el.querySelector('[data-action="download"]')?.addEventListener('click', async () => {
        const rec = records.find(r => r.id === id);
        if (!rec?.blob) return;
        const url = URL.createObjectURL(rec.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${rec.name.replace(/\.[^.]+$/, '')}-noblur.mp4`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      });
      el.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
        await deleteHistory(id);
        await loadHistory();
      });
    });
  } catch {
    historyList.innerHTML = '<p class="muted small">Historial no disponible en este navegador.</p>';
  }
}

async function deleteHistory(id) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

clearHistoryBtn.addEventListener('click', async () => {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    await loadHistory();
  } catch { /* ignore */ }
});

loadHistory();

/* ========== Salud de publicación ========== */
const checksContainer = document.getElementById('checks');
const assessBtn = document.getElementById('assessBtn');
const resultBox = document.getElementById('result');

CHECK_ITEMS.forEach(item => {
  const label = document.createElement('label');
  label.className = 'check-item';
  label.innerHTML = `
    <input type="checkbox" value="${item.id}">
    <div>
      <div class="label">${item.label}</div>
      <div class="hint">${item.guidance}</div>
    </div>
  `;
  checksContainer.appendChild(label);
});

assessBtn.addEventListener('click', () => {
  const checked = [...checksContainer.querySelectorAll('input:checked')].map(el => el.value);
  const assessment = assessPublishReadiness({
    audioSource: document.getElementById('audioSource').value,
    checks: checked,
    noblurApplied: document.getElementById('noblurApplied').checked,
    metadataClean: document.getElementById('metadataClean').checked,
    heavyObfuscation: document.getElementById('heavyObfuscation').checked,
  });

  resultBox.hidden = false;
  resultBox.className = `result ${assessment.level}`;
  const levelLabel = { bajo: 'BAJO', medio: 'MEDIO', alto: 'ALTO' }[assessment.level];

  let html = `<div class="score-line">Riesgo: ${levelLabel} · ${assessment.score}/100</div>`;
  if (assessment.risks.length) {
    html += `<p><strong>Riesgos (${assessment.risks.length}):</strong></p><ul class="risk-list">`;
    assessment.risks.forEach(r => { html += `<li><strong>[${r.severity}]</strong> ${r.detail}</li>`; });
    html += '</ul>';
  } else {
    html += '<p class="ok">Sin riesgos detectados en los factores verificables localmente.</p>';
  }
  if (assessment.recommendations.length) {
    html += `<p style="margin-top:12px"><strong>Recomendaciones:</strong></p><ul class="rec-list">`;
    assessment.recommendations.forEach(rec => { html += `<li>${rec}</li>`; });
    html += '</ul>';
  }
  html += `<p class="muted small" style="margin-top:14px">Si un vídeo ya publicado quedó en «Solo yo» sin notificación, bórralo y vuelve a subirlo limpio con privacidad «Todo el mundo» marcada antes de publicar.</p>`;
  resultBox.innerHTML = html;
});
