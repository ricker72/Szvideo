/** SzVideo — transformación visual: velocidad/FPS, zoom+recorte, marcos, filtros de color,
 *  ruido visual y sticker translúcido. Cambian la huella digital del vídeo de forma imperceptible. */

export const TINT_COLORS = ['ninguno', 'azul', 'magenta', 'rojo'];
export const LIMITS = {
  speed: 3,        // % de velocidad (0 = sin cambio)
  zoom: 5,         // % de zoom
  offset: 5,       // % del encuadre (X e Y)
  bars: 10,        // % de la altura de cada barra
  noise: 10,       // fuerza del ruido visual
  color: 5,        // % de saturación/contraste
  brightness: 3,   // % de brillo
  tintOpacity: 5,  // % de opacidad de la capa de color
  stickerOpacity: 15, // % de opacidad del sticker
};

export function hasActiveEffects(request = {}) {
  return Boolean(
    request.speedPercent
    || request.zoomPercent
    || request.offsetXPercent
    || request.offsetYPercent
    || request.barsPercent
    || request.noiseStrength
    || request.saturationPercent
    || request.contrastPercent
    || request.brightnessPercent
    || (request.tint && request.tint !== 'ninguno')
    || request.sticker
  );
}

export function validateVisualLayersRequest(request = {}) {
  const r = request;
  if (r.speedPercent !== undefined && Math.abs(r.speedPercent) > LIMITS.speed) throw new Error(`La velocidad debe estar entre -${LIMITS.speed}% y +${LIMITS.speed}%`);
  if (r.zoomPercent !== undefined && (r.zoomPercent < 0 || r.zoomPercent > LIMITS.zoom)) throw new Error(`El zoom debe estar entre 0 y ${LIMITS.zoom}%`);
  for (const axis of ['offsetXPercent', 'offsetYPercent']) if (r[axis] !== undefined && Math.abs(r[axis]) > LIMITS.offset) throw new Error(`El desplazamiento debe estar entre -${LIMITS.offset}% y +${LIMITS.offset}%`);
  if (r.barsPercent !== undefined && (r.barsPercent < 0 || r.barsPercent > LIMITS.bars)) throw new Error(`Las barras deben medir entre 0 y ${LIMITS.bars}% de la altura`);
  if (r.noiseStrength !== undefined && (r.noiseStrength < 0 || r.noiseStrength > LIMITS.noise)) throw new Error(`La fuerza del ruido visual debe estar entre 0 y ${LIMITS.noise}`);
  if (r.saturationPercent !== undefined && Math.abs(r.saturationPercent) > LIMITS.color) throw new Error(`La saturación debe variar entre -${LIMITS.color}% y +${LIMITS.color}%`);
  if (r.contrastPercent !== undefined && Math.abs(r.contrastPercent) > LIMITS.color) throw new Error(`El contraste debe variar entre -${LIMITS.color}% y +${LIMITS.color}%`);
  if (r.brightnessPercent !== undefined && (r.brightnessPercent < 0 || r.brightnessPercent > LIMITS.brightness)) throw new Error(`El brillo debe estar entre 0 y ${LIMITS.brightness}%`);
  if (!TINT_COLORS.includes(r.tint || 'ninguno')) throw new Error(`Color de capa no soportado: ${r.tint}`);
  if (r.tint && r.tint !== 'ninguno' && (r.tintOpacity === undefined || r.tintOpacity < 1 || r.tintOpacity > LIMITS.tintOpacity)) throw new Error(`La opacidad de la capa de color debe estar entre 1 y ${LIMITS.tintOpacity}%`);
  if (r.sticker && (r.stickerOpacity === undefined || r.stickerOpacity < 1 || r.stickerOpacity > LIMITS.stickerOpacity)) throw new Error(`La opacidad del sticker debe estar entre 1 y ${LIMITS.stickerOpacity}%`);
  if (!hasActiveEffects(r)) throw new Error('Selecciona al menos un efecto visual');
  return true;
}

/** Cadena de filtros de vídeo (sin audio). */
export function buildVideoChain(request = {}) {
  validateVisualLayersRequest(request);
  const chain = [];
  if (request.speedPercent) chain.push(`setpts=PTS/${(1 + request.speedPercent / 100).toFixed(6)}`);
  const eq = [];
  if (request.saturationPercent) eq.push(`saturation=${(1 + request.saturationPercent / 100).toFixed(4)}`);
  if (request.contrastPercent) eq.push(`contrast=${(1 + request.contrastPercent / 100).toFixed(4)}`);
  if (request.brightnessPercent) eq.push(`brightness=${(request.brightnessPercent / 100).toFixed(4)}`);
  if (eq.length) chain.push(`eq=${eq.join(':')}`);
  if (request.noiseStrength) chain.push(`noise=alls=${Math.round(request.noiseStrength)}:allf=t`);
  if (request.zoomPercent) {
    const z = (1 + request.zoomPercent / 100).toFixed(4);
    chain.push(`scale=trunc(iw*${z}/2)*2:trunc(ih*${z}/2)*2`);
    chain.push(`crop=trunc(iw/${z}/2)*2:trunc(ih/${z}/2)*2:(iw-ow)/2+trunc(iw*${((request.offsetXPercent || 0) / 100).toFixed(4)}):(ih-oh)/2+trunc(ih*${((request.offsetYPercent || 0) / 100).toFixed(4)})`);
  }
  if (request.barsPercent) {
    const h = (request.barsPercent / 100).toFixed(4);
    chain.push(`drawbox=x=0:y=0:w=iw:h=trunc(ih*${h}):color=black@1:t=fill`);
    chain.push(`drawbox=x=0:y=ih-trunc(ih*${h}):w=iw:h=trunc(ih*${h}):color=black@1:t=fill`);
  }
  if (request.tint && request.tint !== 'ninguno') chain.push(`drawbox=x=0:y=0:w=iw:h=ih:color=${request.tint}@${(request.tintOpacity / 100).toFixed(3)}:t=fill`);
  if (request.sticker) chain.push(`drawbox=x=iw-trunc(iw*0.15)-trunc(iw*0.03):y=ih-trunc(ih*0.15)-trunc(ih*0.03):w=trunc(iw*0.12):h=trunc(ih*0.12):color=white@${(request.stickerOpacity / 100).toFixed(3)}:t=fill`);
  return chain.join(',');
}

/** Cadena de filtros de audio: acompaña la velocidad para mantener sincronía. */
export function buildAudioChain(speedPercent = 0) {
  return speedPercent ? `atempo=${(1 + speedPercent / 100).toFixed(4)}` : 'anull';
}

/** Argumentos FFmpeg: re-encode del vídeo (obligatorio con filtros), audio sincronizado, metadatos eliminados. */
export function buildVisualLayerArgs({ input, output, includeAudio = true, stripStreams = true, ...layers } = {}) {
  if (!input || !output) throw new Error('Input and output are required');
  const videoChain = buildVideoChain(layers);
  if (!videoChain) throw new Error('Selecciona al menos un efecto visual');
  const usesSpeed = Boolean(layers.speedPercent);
  let graph = `[0:v]${videoChain}[v]`;
  if (includeAudio && usesSpeed) graph += `;[0:a]${buildAudioChain(layers.speedPercent)}[a]`;
  const args = '-hide_banner -loglevel error -i'.split(' ');
  args.push(input, '-filter_complex', graph, '-map', '[v]');
  if (includeAudio) {
    if (usesSpeed) { args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k'); }
    else { args.push('-map', '0:a?', '-c:a', 'copy'); }
  } else {
    args.push('-an');
  }
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18');
  args.push('-map_metadata', '-1');
  if (stripStreams) args.push('-map_metadata:s', '-1');
  args.push('-progress', 'pipe:1', '-nostats', '-y', output);
  return args;
}

/** Descripción legible de los efectos activos (para UI y evidencia). */
export function describeVisualLayers(request = {}) {
  const efectos = [];
  if (request.speedPercent) efectos.push(`velocidad ${request.speedPercent > 0 ? '+' : ''}${request.speedPercent}%`);
  if (request.zoomPercent) efectos.push(`zoom ${request.zoomPercent}%`);
  if (request.offsetXPercent) efectos.push(`desplazamiento X ${request.offsetXPercent > 0 ? '+' : ''}${request.offsetXPercent}%`);
  if (request.offsetYPercent) efectos.push(`desplazamiento Y ${request.offsetYPercent > 0 ? '+' : ''}${request.offsetYPercent}%`);
  if (request.barsPercent) efectos.push(`barras ${request.barsPercent}%`);
  if (request.noiseStrength) efectos.push(`ruido visual ${request.noiseStrength}`);
  if (request.saturationPercent) efectos.push(`saturación ${request.saturationPercent > 0 ? '+' : ''}${request.saturationPercent}%`);
  if (request.contrastPercent) efectos.push(`contraste ${request.contrastPercent > 0 ? '+' : ''}${request.contrastPercent}%`);
  if (request.brightnessPercent) efectos.push(`brillo +${request.brightnessPercent}%`);
  if (request.tint && request.tint !== 'ninguno') efectos.push(`capa ${request.tint} @${request.tintOpacity}%`);
  if (request.sticker) efectos.push(`sticker @${request.stickerOpacity}%`);
  return efectos.join(' · ');
}
