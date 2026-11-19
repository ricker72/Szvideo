/** SzVideo — capas de audio: ruido de fondo a volumen mínimo + modulación de tono (pitch).
 *  Transforman la huella digital del audio original sin que resulten perceptibles. */

export const NOISE_TYPES = ['ninguno', 'rosa', 'blanco', 'ambiental'];
export const NOISE_COLORS = { rosa: 'pink', blanco: 'white', ambiental: 'brown' };
export const MAX_NOISE_VOLUME = 5; // % del pico
export const MAX_PITCH = 3;        // % de desplazamiento de tono

export function validateAudioLayersRequest({ output, noiseType = 'ninguno', noiseVolume = 2, pitchPercent = 0 } = {}) {
  if (!output) throw new Error('Se requiere una ruta de salida para el vídeo con capas de audio');
  if (!NOISE_TYPES.includes(noiseType)) throw new Error(`Tipo de capa de fondo no soportado: ${noiseType}`);
  if (noiseType === 'ninguno' && pitchPercent === 0) throw new Error('Selecciona al menos una capa: ruido de fondo o modulación de tono');
  if (noiseType !== 'ninguno' && (noiseVolume <= 0 || noiseVolume > MAX_NOISE_VOLUME)) throw new Error(`El volumen del ruido debe estar entre 0 (excluido) y ${MAX_NOISE_VOLUME}%`);
  if (pitchPercent !== 0 && (pitchPercent < -MAX_PITCH || pitchPercent > MAX_PITCH)) throw new Error(`La modulación de tono debe estar entre -${MAX_PITCH}% y +${MAX_PITCH}%`);
  return true;
}

/** Cadena filter_complex: pitch del audio original + filtros extra (p. ej. atempo de velocidad) + mix del ruido de fondo. */
export function buildAudioGraph({ noiseType = 'ninguno', noiseVolume = 2, pitchPercent = 0, sampleRate = 44100, compatMix = false, vozFilters = [] } = {}) {
  validateAudioLayersRequest({ output: 'out.mp4', noiseType, noiseVolume, pitchPercent });
  const pitchFilters = [];
  if (pitchPercent !== 0) {
    const rate = (1 + pitchPercent / 100).toFixed(6);
    pitchFilters.push(`asetrate=${sampleRate}*${rate}`, `aresample=${sampleRate}`, `atempo=${(1 / Number(rate)).toFixed(6)}`);
  }
  const vozBody = [...pitchFilters, ...vozFilters].join(',') || 'anull';
  if (noiseType === 'ninguno') return { filter: `[0:a]${vozBody}[out]`, mapLabel: '[out]' };
  const color = NOISE_COLORS[noiseType];
  const amplitude = (noiseVolume / 100).toFixed(4);
  // Con compatMix (amix sin normalize), subimos la voz x2 para compensar el divisor.
  const voz = compatMix ? `[0:a]${vozBody},volume=2[voz]` : `[0:a]${vozBody}[voz]`;
  const mix = compatMix ? 'amix=inputs=2:duration=first' : 'amix=inputs=2:duration=first:normalize=0';
  return { filter: `${voz};anoisesrc=color=${color}:amplitude=${amplitude}:seed=111[n];[voz][n]${mix}[out]`, mapLabel: '[out]' };
}

/** Argumentos FFmpeg: video sin recodificar, audio re-mezclado, metadatos eliminados. */
export function buildAudioLayerArgs({ input, output, noiseType = 'ninguno', noiseVolume = 2, pitchPercent = 0, stripStreams = true, compatMix = false } = {}) {
  if (!input || !output) throw new Error('Input and output are required');
  const graph = buildAudioGraph({ noiseType, noiseVolume, pitchPercent, compatMix });
  const args = '-hide_banner -loglevel error -i'.split(' ');
  args.push(input, '-filter_complex', graph.filter, '-map', '0:v?', '-map', graph.mapLabel, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k');
  args.push('-map_metadata', '-1');
  if (stripStreams) args.push('-map_metadata:s', '-1');
  args.push('-progress', 'pipe:1', '-nostats', '-y', output);
  return args;
}
