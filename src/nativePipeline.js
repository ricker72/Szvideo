/** SzVideo — ruta nativa de Windows (sin FFmpeg): decodificación Media Foundation (HTML5 <video>),
 *  efectos por canvas, mezcla de ruido por WebAudio y codificación MediaRecorder.
 *  La parte de captura necesita DOM; las funciones puras (efectos, ruido, capacidades) son testeables. */

export const NATIVE_MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

export function describeNativeSupport(globalObject = globalThis) {
  const documentRef = globalObject?.document;
  return {
    canvas: Boolean(documentRef?.createElement),
    mediaRecorder: typeof globalObject?.MediaRecorder === 'function',
    captureStream: typeof (documentRef?.createElement('canvas') || {}).captureStream === 'function',
    webAudio: typeof globalObject?.AudioContext === 'function' || typeof globalObject?.webkitAudioContext === 'function',
  };
}

export function pickNativeMime(MediaRecorder = globalThis.MediaRecorder) {
  if (typeof MediaRecorder?.isTypeSupported !== 'function') return null;
  return NATIVE_MIME_CANDIDATES.find(candidate => MediaRecorder.isTypeSupported(candidate)) || null;
}

/** Buffer de ruido blanco (el «ruido rosa» nativo se aproxima con un filtro lowpass en WebAudio). */
export function whiteNoiseBuffer(length = 48000, rng = Math.random) {
  const buffer = new Float32Array(length);
  for (let i = 0; i < length; i += 1) buffer[i] = rng() * 2 - 1;
  return buffer;
}

/** Aplica los efectos del preset sobre un frame del canvas. `ctx` es inyectable para tests. */
export function drawProcessedFrame(ctx, video, effects = {}) {
  const { zoomPercent = 0, offsetXPercent = 0, offsetYPercent = 0, barsPercent = 0, tint = 'ninguno', tintOpacity = 2, sticker = false, stickerOpacity = 6, watermark = '© SzVideo' } = effects;
  const width = ctx.canvas.width, height = ctx.canvas.height;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  if (zoomPercent) {
    const z = 1 + zoomPercent / 100;
    const sw = width / z, sh = height / z;
    const dx = (width - sw) / 2 + (offsetXPercent / 100) * width;
    const dy = (height - sh) / 2 + (offsetYPercent / 100) * height;
    ctx.drawImage(video, dx, dy, sw, sh);
  } else {
    ctx.drawImage(video, 0, 0, width, height);
  }
  if (barsPercent) {
    const bar = height * (barsPercent / 100);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, bar);
    ctx.fillRect(0, height - bar, width, bar);
  }
  if (tint && tint !== 'ninguno') {
    const colors = { azul: '#0000FF', magenta: '#FF00FF', rojo: '#FF0000' };
    ctx.globalAlpha = tintOpacity / 100;
    ctx.fillStyle = colors[tint] || '#0000FF';
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }
  if (sticker) {
    const size = width * 0.12, margin = width * 0.03;
    ctx.globalAlpha = stickerOpacity / 100;
    ctx.fillStyle = '#fff';
    ctx.fillRect(width - size - margin, height - size - margin, size, size);
    ctx.globalAlpha = 1;
  }
  if (watermark) {
    const fontSize = Math.max(12, Math.round(width * 0.018));
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    const padding = Math.max(8, Math.round(fontSize * 0.6));
    const textWidth = ctx.measureText(watermark).width;
    ctx.fillRect(width - textWidth - padding * 1.5, height - fontSize - padding * 1.5, textWidth + padding, fontSize + padding / 2);
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillText(watermark, width - textWidth - padding, height - padding);
  }
  ctx.restore();
}

/** Grafo de audio nativo: audio del vídeo + capa de ruido filtrada (≈rosa).
 *  Debe crearse UNA vez por elemento <video>: Chromium lanza un error si se llama
 *  `createMediaElementSource` dos veces sobre el mismo elemento. */
export function createNoiseAudio(video, noiseVolume = 2) {
  try {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass || !video) return null;
    const audioCtx = new AudioContextClass();
    const source = audioCtx.createMediaElementSource(video);
    const destination = audioCtx.createMediaStreamDestination();
    source.connect(destination);
    // Capa de ruido: buffer blanco → lowpass (aprox. rosa) → ganancia mínima.
    const noise = audioCtx.createBufferSource();
    noise.buffer = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
    noise.buffer.copyToChannel(whiteNoiseBuffer(audioCtx.sampleRate), 0);
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;
    const gain = audioCtx.createGain();
    gain.gain.value = Math.min(0.05, noiseVolume / 100);
    noise.connect(filter).connect(gain).connect(destination);
    noise.loop = true;
    noise.start();
    return { audioCtx, destination, gain, tracks: destination.stream.getAudioTracks() };
  } catch {
    return null; // sin audio: graba solo vídeo
  }
}

/** Ajusta el volumen de la capa de ruido (0–5 % del pico). */
export function setNoiseVolume(audio, noiseVolume = 2) {
  if (audio?.gain) audio.gain.gain.value = Math.min(0.05, Math.max(0, noiseVolume / 100));
}

/** Cierra el grafo de audio (libera el AudioContext). */
export function closeNoiseAudio(audio) {
  try { audio?.audioCtx?.close?.(); } catch { /* ya cerrado */ }
}

/** Captura un segmento procesado con MediaRecorder (ruta nativa). Devuelve un Blob WebM.
 *  `audio` es un grafo creado con createNoiseAudio (reutilizable entre clips). */
export async function recordProcessedCopy({ video, start = 0, duration = 30, effects = {}, audio = null, onProgress = null } = {}) {
  const support = describeNativeSupport();
  if (!support.mediaRecorder || !support.canvas) throw new Error('La ruta nativa requiere MediaRecorder y canvas (Chromium/Electron)');
  const mimeType = pickNativeMime();
  if (!mimeType) throw new Error('MediaRecorder no admite WebM en este equipo');
  const noiseAudio = audio || createNoiseAudio(video, 2);
  const ownsAudio = !audio;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(30);
  noiseAudio?.tracks.forEach(track => stream.addTrack(track));
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  const finished = new Promise(resolve => { recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType })); });
  video.currentTime = start;
  await new Promise(resolve => { if (video.readyState >= 2) resolve(); else video.addEventListener('loadeddata', resolve, { once: true }); });
  recorder.start(1000);
  await video.play();
  const end = start + duration;
  await new Promise(resolve => {
    const tick = () => {
      drawProcessedFrame(ctx, video, effects);
      onProgress?.(Math.min(100, ((video.currentTime - start) / duration) * 100));
      if (video.currentTime >= end || video.ended) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  video.pause();
  recorder.stop();
  const blob = await finished;
  if (ownsAudio) closeNoiseAudio(noiseAudio);
  return blob;
}
