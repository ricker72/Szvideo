/** SzVideo — análisis del vídeo para el director inteligente: movimiento, cortes de escena
 *  y selección de los mejores momentos (estilo TikTok). Límite de recursos: clips ≤ capSeconds. */

export const RESOURCE_CAP_SECONDS = 180; // tope duro por clip: protege el equipo
export const DEFAULT_INSIGHT_OPTIONS = { clipDuration: 45, maxClips: 3 };

export function motionScore(previousHash, nextHash) {
  if (!previousHash || !nextHash || previousHash.length !== nextHash.length) return 0;
  let distance = 0;
  for (let i = 0; i < previousHash.length; i += 1) if (previousHash[i] !== nextHash[i]) distance += 1;
  return distance / previousHash.length; // 0..1
}

/** samples: [{ time, hash }] ordenados por time. Devuelve [{ time, motion }] con motion del primer sample = 0. */
export function scoreTimeline(samples = []) {
  return samples.map((sample, index) => ({
    time: sample.time,
    motion: index ? motionScore(samples[index - 1].hash, sample.hash) : 0,
    hash: sample.hash,
  }));
}

export function findSceneCuts(scored = [], threshold = 0.3) {
  return scored.filter(point => point.motion >= threshold).map(point => point.time);
}

function windowScore(scored, start, end) {
  const inside = scored.filter(point => point.time >= start && point.time < end);
  if (!inside.length) return { score: 0, cuts: 0 };
  // Suma (no promedio): las ventanas con más movimiento acumulado ganan sin sesgar las colas.
  const motionSum = inside.reduce((sum, point) => sum + point.motion, 0);
  const cuts = findSceneCuts(inside).length;
  return { score: motionSum + cuts * 0.08, cuts };
}

/** Selecciona los mejores momentos: ventanas no solapadas, puntuadas, con tope de duración. */
export function selectBestMoments(scored = [], { clipDuration = 45, maxClips = 3, capSeconds = RESOURCE_CAP_SECONDS } = {}) {
  const target = Math.min(clipDuration, capSeconds);
  const samples = scored.filter(point => Number.isFinite(point.time));
  if (!samples.length) return [];
  const videoEnd = samples[samples.length - 1].time;
  const candidates = [];
  for (const point of samples) {
    const start = point.time;
    if (start >= videoEnd) continue; // sin soporte de samples en la ventana
    const inside = samples.filter(sample => sample.time >= start && sample.time < start + target);
    if (inside.length < 2) continue; // densidad mínima: evita ventanas con puntuación inflada
    const { score, cuts } = windowScore(scored, start, start + target);
    candidates.push({ start, duration: Math.min(target, Math.max(videoEnd - start, 1)), score, cuts });
  }
  const chosen = [];
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    if (chosen.length >= maxClips) break;
    if (candidate.duration < 5) continue;
    const overlaps = chosen.some(picked => candidate.start < picked.start + picked.duration && picked.start < candidate.start + candidate.duration);
    if (overlaps) continue;
    chosen.push(candidate);
  }
  return chosen
    .map(clip => ({ ...clip, duration: Math.min(clip.duration, capSeconds) }))
    .sort((a, b) => a.start - b.start)
    .map(clip => ({
      start: Number(clip.start.toFixed(2)),
      duration: Number(clip.duration.toFixed(2)),
      end: Number((clip.start + clip.duration).toFixed(2)),
      score: Number(clip.score.toFixed(3)),
      cuts: clip.cuts,
    }));
}

/** Clasifica el contenido: qué tipo de vídeo es y qué tan activo está. Ayuda al director
 *  heurístico a adaptar los efectos (un talking-head necesita más transformación que una escena de acción). */
export function classifyContent(scored = []) {
  const points = scored.filter(point => Number.isFinite(point.time) && Number.isFinite(point.motion));
  const cuts = findSceneCuts(points);
  const avgMotion = points.length ? points.reduce((sum, point) => sum + point.motion, 0) / points.length : 0;
  const duration = points.length ? points[points.length - 1].time : 0;
  const cutsPerMinute = duration > 0 ? (cuts.length / duration) * 60 : 0;
  // Índice de actividad 0..1: combina movimiento medio y densidad de cortes.
  const activityIndex = Math.min(1, avgMotion * 2 + cutsPerMinute * 0.05);
  const type = avgMotion < 0.04 ? 'estático' : avgMotion < 0.12 ? 'medio' : 'dinámico';
  return {
    type,
    avgMotion: Number(avgMotion.toFixed(3)),
    cutCount: cuts.length,
    cutsPerMinute: Number(cutsPerMinute.toFixed(2)),
    activityIndex: Number(activityIndex.toFixed(3)),
    duration: Number(duration.toFixed(1)),
  };
}

/** Resumen compacto del análisis (para el plan local y el prompt del modelo). */
export function summarizeInsights(insights = {}) {
  const scored = insights.scored || scoreTimeline(insights.samples || []);
  const cuts = findSceneCuts(scored);
  const avgMotion = scored.length ? scored.reduce((sum, point) => sum + point.motion, 0) / scored.length : 0;
  const top = [...scored].sort((a, b) => b.motion - a.motion).slice(0, 5).map(point => Number(point.time.toFixed(1)));
  return `duration=${(insights.duration ?? videoDuration(scored)).toFixed(1)}s samples=${scored.length} avgMotion=${avgMotion.toFixed(3)} sceneCuts=${cuts.length} hottestTimes=[${top.join(', ')}]s`;
}

function videoDuration(scored) {
  return scored.length ? scored[scored.length - 1].time : 0;
}
