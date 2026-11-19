/** SzVideo — núcleo de decisión del editor ("LLM del core").
 *  Motor local heurístico (siempre disponible) + proveedor de modelo opcional (Ollama local).
 *  Todo plan pasa por validación dura: clips ≤ 180 s, efectos dentro de los límites imperceptibles. */

import { STEALTH_PRESET, buildStealthPresetArgs } from './stealthPreset.js';
import { validateVisualLayersRequest } from './visualLayer.js';
import { validateAudioLayersRequest } from './audioLayer.js';
import { classifyContent, selectBestMoments, scoreTimeline, summarizeInsights } from './videoInsights.js';

export const RESOURCE_CAP_SECONDS = 180;

export function summarizeInsightsForModel(insights = {}) {
  return summarizeInsights(insights);
}

/* ==== Director heurístico 100 % local (sin IA externa) ====
 * Todo es determinista: mismo vídeo + mismos ajustes → mismo plan exacto.
 * La "inteligencia" vive en tres reglas:
 *  1. Los mejores momentos salen del análisis perceptual (movimiento + cortes).
 *  2. El preset se adapta al tipo de contenido (estático/medio/dinámico).
 *  3. Cada clip recibe una variación única e imperceptible (huellas distintas entre clips). */

/** Hash FNV-1a de 32 bits: convierte texto en semilla. */
export function hashSeed(text) {
  let hash = 2166136261;
  const string = String(text ?? '');
  for (let index = 0; index < string.length; index += 1) {
    hash ^= string.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** PRNG determinista (mulberry32) a partir de una semilla entera. */
export function seededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));
const pickInt = (rng, min, max) => Math.round(min + rng() * (max - min));

/** Preset adaptado al tipo de contenido, con variación determinista por clip.
 *  Todos los valores quedan dentro de los límites imperceptibles (LIMITS / audio). */
export function derivePreset(classification = {}, { seed = 0, variation = 0 } = {}) {
  const rng = seededRandom(hashSeed(`${seed}:${variation}`));
  const type = classification.type || 'medio';
  // Un talking-head (estático) soporta más transformación sin que se note;
  // una escena de acción (dinámico) ya tiene movimiento: la capa debe ser más sutil.
  const ranges = type === 'estático'
    ? { speed: [2, 3], zoom: [3, 5], bars: [1, 4], noise: [2, 4] }
    : type === 'dinámico'
      ? { speed: [1, 2], zoom: [2, 3], bars: [0, 2], noise: [1, 3] }
      : { speed: [1, 3], zoom: [2, 4], bars: [0, 3], noise: [2, 4] };
  const tints = ['ninguno', 'ninguno', 'azul', 'magenta', 'rojo'];
  return {
    speedPercent: pickInt(rng, ...ranges.speed),
    zoomPercent: pickInt(rng, ...ranges.zoom),
    offsetXPercent: pickInt(rng, -2, 2),
    offsetYPercent: pickInt(rng, 0, 2),
    barsPercent: pickInt(rng, ...ranges.bars),
    noiseStrength: pickInt(rng, ...ranges.noise),
    saturationPercent: pickInt(rng, 1, 2) * (rng() > 0.5 ? 1 : -1),
    contrastPercent: pickInt(rng, 0, 2),
    brightnessPercent: pickInt(rng, 0, 2),
    tint: tints[Math.floor(rng() * tints.length)],
    tintOpacity: pickInt(rng, 1, 3),
    sticker: true,
    stickerOpacity: pickInt(rng, 4, 8),
    audioNoiseType: variation % 2 ? 'blanco' : 'rosa',
    audioNoiseVolume: pickInt(rng, 1, 2),
    pitchPercent: pickInt(rng, 1, 2) * (variation % 2 ? -1 : 1),
  };
}

/** Metadatos nuevos por clip, derivados del nombre del original (sin IA). */
export function deriveClipMetadata(sourceName = '', clip = {}, index = 0) {
  const base = String(sourceName || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'SzVideo clip';
  return {
    title: `${base} · clip ${index + 1}`,
    copyright: 'All rights reserved',
    provenance: 'Created with SzVideo',
    comment: `${Math.round(clip.duration || 0)}s desde ${Number(clip.start || 0).toFixed(0)}s`,
  };
}

/** Razón legible por clip: por qué se eligió ese momento. */
export function describeClipReason(clip = {}, classification = {}) {
  const parts = [`puntuación ${clip.score ?? 0}`];
  if (clip.cuts) parts.push(`${clip.cuts} corte(s) de escena`);
  parts.push(`duración ${clip.duration}s`);
  return `Elegido por ${parts.join(' · ')}${classification.type ? ` (contenido ${classification.type})` : ''}`;
}

/** Plan por defecto: heurística local sobre el análisis — clasifica, selecciona, adapta y varía. */
export function buildLocalPlan(insights = {}, { clipDuration = 45, maxClips = 3, sourceName = '' } = {}) {
  const scored = insights.scored || scoreTimeline(insights.samples || []);
  const classification = insights.classification || classifyContent(scored);
  const clips = selectBestMoments(scored, { clipDuration, maxClips, capSeconds: RESOURCE_CAP_SECONDS });
  const seed = insights.seed ?? hashSeed(sourceName || 'szvideo');
  // Preset y metadatos a nivel de plan (compatibilidad con la ruta nativa y previews).
  const planPreset = derivePreset(classification, { seed, variation: -1 });
  const planMetadata = deriveClipMetadata(sourceName, clips[0] || {}, 0);
  return {
    engine: 'local',
    classification,
    seed,
    clips: clips.map((clip, index) => ({
      ...clip,
      preset: derivePreset(classification, { seed, variation: index }),
      metadata: deriveClipMetadata(sourceName, clip, index),
      reason: describeClipReason(clip, classification),
    })),
    preset: planPreset,
    metadata: planMetadata,
    rationale: [
      `Heurística local (sin IA): contenido ${classification.type} — movimiento medio ${classification.avgMotion}, ${classification.cutCount} cortes (${classification.cutsPerMinute}/min).`,
      `Los clips salen de las ventanas con más movimiento acumulado y cortes de escena, con tope de ${RESOURCE_CAP_SECONDS}s.`,
      `Preset adaptado a contenido ${classification.type} y cada clip lleva variación única (zoom/desplazamiento/color/ruido alternados) para huellas distintas entre clips.`,
    ].join(' '),
  };
}

/** Extrae el primer objeto JSON de la respuesta del modelo. */
export function parsePlanResponse(text) {
  if (!text) return null;
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

/** Normaliza un plan del modelo: tipos, recortes al tope y valores por defecto. */
export function normalizePlan(candidate = {}) {
  const clips = Array.isArray(candidate.clips) ? candidate.clips
    .map(clip => ({
      rawStart: Number(clip?.start ?? clip?.startSeconds ?? NaN),
      duration: Math.min(RESOURCE_CAP_SECONDS, Math.max(5, Number(clip?.duration ?? clip?.seconds ?? clip?.durationSeconds ?? 45))),
    }))
    .filter(clip => Number.isFinite(clip.rawStart) && clip.rawStart >= 0 && Number.isFinite(clip.duration))
    .map(clip => ({ start: clip.rawStart, duration: clip.duration }))
    .slice(0, 5) : [];
  return {
    engine: 'model',
    clips,
    preset: { ...STEALTH_PRESET, ...(candidate.preset || {}) },
    metadata: { title: 'SzVideo clip', copyright: 'All rights reserved', provenance: 'Created with SzVideo', ...(candidate.metadata || {}) },
    rationale: String(candidate.rationale || 'Plan propuesto por el modelo.'),
  };
}

/** Validación dura del plan. Devuelve true o lanza. */
export function validatePlan(plan = {}) {
  if (!Array.isArray(plan.clips) || !plan.clips.length) throw new Error('El plan no tiene clips');
  for (const clip of plan.clips) {
    if (!(clip.duration >= 5 && clip.duration <= RESOURCE_CAP_SECONDS)) throw new Error(`Clip fuera del tope de recursos (5–${RESOURCE_CAP_SECONDS}s): ${clip.duration}s`);
    if (!(clip.start >= 0)) throw new Error('Un clip empieza antes del inicio del vídeo');
  }
  const preset = plan.preset || {};
  validateVisualLayersRequest({ ...preset, output: 'out.mp4' });
  if (plan.clips.length && (preset.audioNoiseType || preset.pitchPercent)) {
    validateAudioLayersRequest({ output: 'out.mp4', noiseType: preset.audioNoiseType || 'rosa', noiseVolume: preset.audioNoiseVolume ?? 2, pitchPercent: preset.pitchPercent ?? 1 });
  }
  // Los presets por clip también deben respetar los límites imperceptibles.
  for (const clip of plan.clips) {
    if (!clip.preset) continue;
    validateVisualLayersRequest({ ...clip.preset, output: 'out.mp4' });
    if (clip.preset.audioNoiseType || clip.preset.pitchPercent) {
      validateAudioLayersRequest({ output: 'out.mp4', noiseType: clip.preset.audioNoiseType || 'rosa', noiseVolume: clip.preset.audioNoiseVolume ?? 2, pitchPercent: clip.preset.pitchPercent ?? 1 });
    }
  }
  return true;
}

/** Núcleo: intenta el modelo (si hay proveedor), valida su plan y cae al motor local ante cualquier fallo.
 *  `options` (clipDuration, maxClips) puede pasarse al planificar o al crear el core. */
export function createIntelligenceCore({ askModel = null, clipDuration = 45, maxClips = 3 } = {}) {
  const resolveNumber = value => Number(value) || clipDuration;
  return {
    async plan(insights, options = {}) {
      const localOptions = {
        clipDuration: resolveNumber(options.clipDuration ?? clipDuration),
        maxClips: options.maxClips ?? maxClips,
        sourceName: options.sourceName ?? '',
      };
      if (typeof askModel === 'function') {
        try {
          const prompt = [
            'Eres el director de edición de SzVideo. Devuelve SOLO un JSON con la forma',
            '{"clips":[{"start":0,"duration":45}],"preset":{"speedPercent":2,"zoomPercent":3,"audioNoiseVolume":2,"pitchPercent":1},"metadata":{"title":"..."},"rationale":"..."}',
            'Reglas: clips de 5 a 180 s (tope duro), máximo 5, los más dinámicos/interesantes.',
            `Análisis del vídeo: ${summarizeInsightsForModel(insights)}`,
          ].join('\n');
          const response = await askModel(prompt);
          const candidate = normalizePlan(parsePlanResponse(response));
          if (candidate.clips.length) {
            validatePlan(candidate);
            return { ...candidate, engine: 'model' };
          }
        } catch { /* el modelo falló o propuso algo inválido: fallback local */ }
      }
      return buildLocalPlan(insights, localOptions);
    },
  };
}

/** Nombres de salida automáticos junto al original (sin diálogos por clip). */
export function clipOutputPath(sourcePath, clip, suffix = 'stealth') {
  const source = String(sourcePath);
  const separator = Math.max(source.lastIndexOf('/'), source.lastIndexOf('\\'));
  const name = source.slice(separator + 1);
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : 'mp4';
  return `${source.slice(0, separator + 1)}${base}-${suffix}-clip${Math.round(clip.start)}s.${ext === 'webm' ? 'webm' : 'mp4'}`;
}

/** Verificación rápida: el preset del plan genera argumentos válidos de FFmpeg. */
export function planArgsPreview(plan, sourcePath = 'in.mp4') {
  const clip = plan.clips?.[0];
  if (!clip) throw new Error('El plan no tiene clips');
  return buildStealthPresetArgs({
    input: sourcePath,
    output: 'out.mp4',
    start: clip.start,
    seconds: clip.duration,
    metadata: plan.metadata,
    ...plan.preset,
  });
}
