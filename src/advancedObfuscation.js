/** SzVideo — ofuscación avanzada de bajo nivel y prueba de robustez forense.
 *  Modos verificados contra las sources de FFmpeg 9.0.2:
 *   · dctdnoiz (dominio de frecuencia, DCT 8×8) — sigma 0..999, default 0 = desactivado.
 *   · noise (dithering espacial temporal) — gaussiano por defecto (Box-Muller), flags a/p/t/u.
 *   · rgbashift / chromashift (aberración cromática) — rh/rv/gh/gv/bh/bv y cbh/cbv/crh/crv.
 *   · minterpolate (interpolación de movimiento, rompe el GOP) — mc_mode aobmc, me_mode bidir.
 *  Además: filtros inversos (normalización) para estabilizar la señal antes del análisis,
 *  y ataques sintéticos para medir si la firma perceptual de la app resiste alteraciones. */

export const ADVANCED_MODES = ['dct', 'espacial', 'croma', 'temporal'];
export const MIN_INTENSITY = 1;
export const MAX_INTENSITY = 10;

export function clampIntensity(intensity) {
  const value = Math.round(Number(intensity));
  if (!Number.isFinite(value) || value < MIN_INTENSITY || value > MAX_INTENSITY) {
    throw new Error(`La intensidad debe estar entre ${MIN_INTENSITY} y ${MAX_INTENSITY}: ${intensity}`);
  }
  return value;
}

/** 1. Dominio de la frecuencia: varía la varianza del ruido en los bloques DCT 8×8.
 *  sigma crece con la intensidad (0.6 → 3.75: sutil pero cambia el espectro de coeficientes). */
export function buildDctChain({ intensity = 5 } = {}) {
  const level = clampIntensity(intensity);
  const sigma = Number((0.25 + level * 0.35).toFixed(2));
  return `dctdnoiz=sigma=${sigma}:n=3`; // n=3 → bloques de 8×8
}

/** 2. Espacial dinámica: ruido temporal gaussiano (patrón distinto en cada frame — Box-Muller
 *  es el default en 9.0.2). La distribución uniforme requiere la flag «u». */
export function buildSpatialChain({ intensity = 5, gaussian = true } = {}) {
  const level = clampIntensity(intensity);
  const strength = Math.min(15, Math.round(1 + level * 1.4)); // 2..15
  const flags = gaussian ? 't' : 't+u'; // t = temporal (cambia cada frame); sin «u» = gaussiano
  return `noise=alls=${strength}:allf=${flags}`;
}

/** 3. Aberración cromática: desplaza los canales R/B en píxeles enteros (1–2 px).
 *  Altera histogramas y covarianzas de color sin perder nitidez aparente. */
export function buildChromaChain({ intensity = 5 } = {}) {
  const level = clampIntensity(intensity);
  const shift = level <= 7 ? 1 : 2;
  const vertical = level >= 8 ? 1 : 0;
  const parts = [`rgbashift=rh=${shift}:rv=${vertical}:bh=${-shift}:bv=${-vertical}:edge=smear`];
  if (level >= 6) {
    // A partir de intensidad 6 también desplaza los planos de croma U/V.
    parts.push('chromashift=cbh=1:cbv=-1:crh=-1:crv=1:edge=smear');
  }
  return parts.join(',');
}

/** 4. Temporal geométrica: re-dibuja cada frame con compensación de movimiento
 *  (rompe los I-frames originales y el GOP del contenedor). MUY lenta: usar en segmentos. */
export function buildTemporalChain({ intensity = 5, fps = 30 } = {}) {
  const level = clampIntensity(intensity);
  const rate = level >= 8 ? 29 : fps; // ligera desincronía del contenedor en intensidades altas
  const vsbmc = level >= 7 ? 1 : 0;   // bloques de tamaño variable si hay margen
  return `minterpolate=fps=${rate}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=${vsbmc}`;
}

export function buildAdvancedChain(modes = [], options = {}) {
  const builders = {
    dct: buildDctChain,
    espacial: buildSpatialChain,
    croma: buildChromaChain,
    temporal: buildTemporalChain,
  };
  const chain = [];
  for (const mode of modes) {
    const builder = builders[mode];
    if (!builder) throw new Error(`Modo de ofuscación no soportado: ${mode}`);
    chain.push(builder(options));
  }
  return chain.join(',');
}

/** Filtros inversos: restauran/estabilizan la señal antes del análisis de huella.
 *  level 1..3 (suave → agresivo). normalizeGeometry reescala a 256px de ancho antes
 *  de comparar hashes: neutraliza ataques de reescalado geométrico. */
export function buildNormalizationChain({ level = 2, normalizeGeometry = true } = {}) {
  const l = Math.min(3, Math.max(1, Math.round(Number(level) || 2)));
  const chain = [];
  if (l >= 1) chain.push('hqdn3d=2:1:6:6');           // denoise espacial+temporal suave
  if (l >= 2) chain.push('atadenoise');               // promediado temporal adaptativo
  if (l >= 2) chain.push('dctdnoiz=sigma=1.5:n=3');   // limpieza DCT (inverso del ataque 1)
  if (l >= 3) chain.push('deband=range=8:blur=1');    // elimina banding de cuantización
  if (normalizeGeometry) chain.push('scale=256:-2:flags=lanczos');
  return chain.join(',');
}

/** Validación del request. Lanza o devuelve true. */
export function validateAdvancedRequest({ input, output, modes, intensity = 5, fps = 30 } = {}) {
  if (!input || !output) throw new Error('Se requieren rutas absolutas de entrada y salida');
  if (!Array.isArray(modes) || !modes.length) throw new Error('Selecciona al menos un modo de ofuscación');
  for (const mode of modes) if (!ADVANCED_MODES.includes(mode)) throw new Error(`Modo no soportado: ${mode}`);
  clampIntensity(intensity);
  if (!Number.isFinite(Number(fps)) || Number(fps) < 1 || Number(fps) > 240) throw new Error(`FPS fuera de rango (1–240): ${fps}`);
  return true;
}

/** Argumentos FFmpeg de la ofuscación avanzada en un pase.
 *  `chainOverride` permite pasar una cadena de filtros directa (variantes de ataque de la
 *  prueba de robustez: reescalado geométrico, setpts…). Borra los metadatos viejos y aplica los nuevos. */
export function buildAdvancedObfuscationArgs({ input, output, modes, intensity = 5, fps = 30, start = null, seconds = null, metadata = null, includeAudio = true, crf = 18, chainOverride = null } = {}) {
  validateAdvancedRequest({ input, output, modes: chainOverride ? [ADVANCED_MODES[0]] : modes, intensity, fps });
  const chain = chainOverride && typeof chainOverride === 'string' ? chainOverride : buildAdvancedChain(modes, { intensity, fps });
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (start !== null && start !== undefined && Number(start) > 0) args.push('-ss', String(Number(start).toFixed(3)));
  args.push('-i', input);
  if (seconds !== null && seconds !== undefined && Number(seconds) > 0) args.push('-t', String(Number(seconds).toFixed(3)));
  args.push('-filter_complex', `[0:v]${chain}[v]`, '-map', '[v]');
  if (includeAudio) args.push('-map', '0:a?', '-c:a', 'copy');
  else args.push('-an');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf));
  args.push('-map_metadata', '-1');
  if (metadata && typeof metadata === 'object') {
    for (const [key, value] of Object.entries(metadata)) {
      if (value === undefined || value === null || value === '') continue;
      args.push('-metadata', `${key}=${String(value)}`);
    }
  }
  args.push('-progress', 'pipe:1', '-nostats', '-y', output);
  return args;
}

/** Argumentos de normalización (filtros inversos antes del análisis). */
export function buildNormalizationArgs({ input, output, level = 2, normalizeGeometry = true, seconds = null } = {}) {
  if (!input || !output) throw new Error('Se requieren rutas absolutas de entrada y salida');
  const chain = buildNormalizationChain({ level, normalizeGeometry });
  const args = ['-hide_banner', '-loglevel', 'error', '-i', input];
  if (seconds !== null && seconds !== undefined && Number(seconds) > 0) args.push('-t', String(Number(seconds).toFixed(3)));
  args.push('-filter_complex', `[0:v]${chain}[v]`, '-map', '[v]', '-an');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '16');
  args.push('-map_metadata', '-1', '-progress', 'pipe:1', '-nostats', '-y', output);
  return args;
}

/** Variantes de ataque sintético para medir la robustez de la huella perceptual.
 *  Cada variante se aplica a un segmento corto y se compara el hash antes/después. */
export function buildAttackVariants({ intensity = 5, segmentSeconds = 6 } = {}) {
  const level = clampIntensity(intensity);
  return [
    { id: 'cromatica', label: 'Aberración cromática (RGB+U/V)', chain: buildChromaChain({ intensity: level }) },
    { id: 'dct', label: 'Ruido DCT (dctdnoiz)', chain: buildDctChain({ intensity: level }) },
    { id: 'ruidoTemporal', label: 'Ruido gaussiano temporal', chain: buildSpatialChain({ intensity: level }) },
    { id: 'geometrico', label: 'Reescalado geométrico (+4 %)', chain: 'scale=trunc(iw*1.04/2)*2:-2,crop=trunc(iw/1.04/2)*2:trunc(ih/1.04/2)*2' },
    { id: 'velocidad', label: 'Velocidad −2 %', chain: 'setpts=PTS*1.02' },
    { id: 'minterpolate', label: 'Re-dibujo minterpolate (GOP nuevo)', chain: buildTemporalChain({ intensity: level }) },
  ].map(variant => ({ ...variant, seconds: segmentSeconds, intensity: level }));
}

/** Descripción legible de la configuración. */
export function describeAdvancedRequest({ modes = [], intensity = 5, fps = 30 } = {}) {
  const names = { dct: 'DCT/frecuencia', espacial: 'ruido espacial temporal', croma: 'aberración cromática', temporal: 'interpolación de movimiento' };
  return modes.map(mode => names[mode] || mode).join(' + ') || 'nada';
}
