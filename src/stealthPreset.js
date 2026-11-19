/** SzVideo — preset «TikTok Studio» (antes «Evasión completa»).
 *  Obfuscación LEGAL: transformaciones autorales sutiles (velocidad, encuadre, color,
 *  ruido visual ligero, tono y ruido rosa en audio) que cambian la firma del vídeo como
 *  haría cualquier editor creativo — sin técnicas agresivas que los clasificadores
 *  marcan como manipulación. Compatibilidad con la subida web de TikTok Studio:
 *  el archivo sale siempre MP4 con H.264 High / yuv420p / AAC / moov al inicio (+faststart),
 *  dimensiones pares y dentro de los límites documentados de duración y tamaño. */

import { buildAudioGraph } from './audioLayer.js';
import { buildVideoChain, describeVisualLayers } from './visualLayer.js';

export const STEALTH_PRESET = {
  // Vídeo (creativo, sutil)
  speedPercent: 2, zoomPercent: 3, offsetXPercent: 1, offsetYPercent: 0,
  noiseStrength: 3, saturationPercent: 2, contrastPercent: 0, brightnessPercent: 0,
  tint: 'ninguno', tintOpacity: 2, barsPercent: 0, sticker: true, stickerOpacity: 6,
  // Audio
  audioNoiseType: 'rosa', audioNoiseVolume: 2, pitchPercent: 1,
};

/** Límites de la subida a TikTok Studio (documentados por TikTok / creator center).
 *  Política SzVideo: tope duro de 10 minutos — los vídeos largos entran en la cola de
 *  revisión más agresiva y elevan el riesgo de marcado como spam. */
export const TIKTOK_STUDIO = {
  maxDurationSeconds: 600,          // 10 min: límite duro SzVideo/TikTok Studio
  maxSizeBytes: 2 * 1024 * 1024 * 1024, // 2 GB en escritorio
  minDimension: 360,                // resolución mínima aceptada
  recommendedAspect: '9:16',        // vertical recomendado
  videoCodec: 'H.264 (avc1) · High profile · yuv420p',
  audioCodec: 'AAC',
};

/** Validación técnica del archivo ANTES de subirlo a TikTok Studio.
 *  Detecta los rechazos típicos del validador de subida web: duración excesiva,
 *  tamaño fuera de límite, resolución mínima o dimensiones impares. */
export function validateTikTokUpload({ duration = null, size = null, width = null, height = null } = {}) {
  const issues = [];
  const warnings = [];
  if (duration !== null && Number.isFinite(duration)) {
    if (duration > TIKTOK_STUDIO.maxDurationSeconds) issues.push(`Duración ${(duration / 60).toFixed(1)} min supera el límite de 10 min (los vídeos largos elevan el riesgo de marcado como spam o revisión forzada)`);
    else if (duration > 180) warnings.push('Más de 3 min: TikTok Studio lo acepta, pero los clips cortos (≤ 3 min) rinden mejor en la distribución');
  }
  if (size !== null && Number.isFinite(size) && size > TIKTOK_STUDIO.maxSizeBytes) issues.push(`El archivo (${(size / 1048576).toFixed(0)} MB) supera el máximo de 2 GB de la subida web`);
  if (width !== null && Number.isFinite(width) && height !== null && Number.isFinite(height)) {
    if (width < TIKTOK_STUDIO.minDimension || height < TIKTOK_STUDIO.minDimension) issues.push(`Resolución ${width}×${height} por debajo del mínimo de ${TIKTOK_STUDIO.minDimension} px`);
    if (width % 2 !== 0 || height % 2 !== 0) issues.push(`Dimensiones impares (${width}×${height}): el H.264 yuv420p exige lados pares`);
    const ratio = width / height;
    // Vertical 9:16 = 0.56. Aviso si es cuadrado/horizontal (≥0.9) o demasiado alargado (≤~1:2.2).
    if (ratio >= 0.9 || ratio <= 1 / 2.2) warnings.push(`Proporción ${(width / height).toFixed(2)}: TikTok recomienda vertical 9:16 (0.56) para máxima superficie en pantalla`);
  }
  return { compatible: issues.length === 0, issues, warnings };
}

/** Garantías de compatibilidad que se aplican SIEMPRE al vídeo exportado. */
export const TIKTOK_COMPAT_VIDEO = ['format=yuv420p']; // píxeles 8-bit 4:2:0: lo que el validador y el decodificador de TikTok esperan

/** Argumentos FFmpeg del preset completo en un pase.
 *  `start`/`seconds` extraen un segmento (clip); `metadata` borra los metadatos viejos y aplica los nuevos. */
export function buildStealthPresetArgs({ input, output, includeAudio = true, stripStreams = true, compatMix = false, start = null, seconds = null, metadata = null, ...overrides } = {}) {
  if (!input || !output) throw new Error('Input and output are required');
  const settings = { ...STEALTH_PRESET, ...overrides };
  const baseChain = buildVideoChain(settings);
  if (!baseChain) throw new Error('El preset debe incluir al menos un efecto visual');
  const videoChain = `${baseChain},${TIKTOK_COMPAT_VIDEO.join(',')}`;
  const graphParts = [`[0:v]${videoChain}[v]`];
  if (includeAudio) {
    const vozFilters = settings.speedPercent ? [`atempo=${(1 + settings.speedPercent / 100).toFixed(4)}`] : [];
    const audio = buildAudioGraph({ noiseType: settings.audioNoiseType, noiseVolume: settings.audioNoiseVolume, pitchPercent: settings.pitchPercent, compatMix, vozFilters });
    graphParts.push(audio.filter);
  }
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (start !== null && start !== undefined && Number(start) > 0) args.push('-ss', String(Number(start).toFixed(3)));
  args.push('-i', input);
  if (seconds !== null && seconds !== undefined && Number(seconds) > 0) args.push('-t', String(Number(seconds).toFixed(3)));
  args.push('-filter_complex', graphParts.join(';'), '-map', '[v]');
  if (includeAudio) args.push('-map', '[out]', '-c:a', 'aac', '-b:a', '192k');
  else args.push('-an');
  // Compatibilidad TikTok Studio: H.264 High + contenedor con moov al inicio (subida/procesado sin fallos).
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high');
  args.push('-movflags', '+faststart');
  args.push('-map_metadata', '-1');
  if (metadata && typeof metadata === 'object') {
    for (const [key, value] of Object.entries(metadata)) {
      if (value === undefined || value === null || value === '') continue;
      args.push('-metadata', `${key}=${String(value)}`);
    }
  }
  if (stripStreams) args.push('-map_metadata:s', '-1');
  args.push('-progress', 'pipe:1', '-nostats', '-y', output);
  return args;
}

/** Descripción legible de todo lo que aplica el preset. */
export function describeStealthPreset(settings = STEALTH_PRESET) {
  const visual = describeVisualLayers(settings);
  const audio = [];
  if (settings.audioNoiseType && settings.audioNoiseType !== 'ninguno') audio.push(`${settings.audioNoiseType} a ${settings.audioNoiseVolume}%`);
  if (settings.pitchPercent) audio.push(`tono ${settings.pitchPercent > 0 ? '+' : ''}${settings.pitchPercent}%`);
  const partes = [visual];
  if (audio.length) partes.push(`audio: ${audio.join(' · ')}`);
  partes.push('metadatos eliminados');
  partes.push(`compatible TikTok Studio (${TIKTOK_STUDIO.videoCodec} · ${TIKTOK_STUDIO.audioCodec} · faststart)`);
  return partes.join(' · ');
}
