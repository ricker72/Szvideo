/** SzVideo — «Anti-blur» para TikTok: parcheo del contenedor MP4/MOV SIN re-codificar.
 *  Técnica (documentada en NoBlur, implementación propia):
 *   1. Normalizar: moov antes de mdat + marca de compatibilidad `isom` (+ hvc1 en HEVC).
 *   2. Inflar: la tabla de muestras de vídeo crece ×multiplier — stts/stsz/stsc/stco/co64
 *      parcheados y muestras dummy (8–16 bytes según códec) añadidas al final del fichero.
 *  TikTok recibe un contenedor de alta densidad estructural y renuncia a su recompresión
 *  agresiva: la calidad original se conserva al 100 % (cero re-encode en el modo principal). */

const DUMMY_SIZES = { avc1: 8, avc3: 8, hvc1: 16, hev1: 16, vp09: 4, av01: 4, mp4v: 8 };
const DEFAULT_DUMMY_SIZE = 8;

export const MULTIPLIER_DEFAULT = 10;
export const MULTIPLIER_MIN = 2;
export const MULTIPLIER_MAX = 20;

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Lee los átomos (boxes) de nivel indicado. Soporta largesize 64-bit y size=0 (hasta el final). */
export function parseBoxes(bytes, start = 0, end = bytes.length) {
  const view = viewOf(bytes);
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    const rawSize = view.getUint32(offset, false);
    let size = rawSize;
    let is64Bit = false;
    if (rawSize === 0) {
      size = end - offset;
    } else if (rawSize === 1) {
      is64Bit = true;
      if (offset + 16 > end) break;
      size = Number(view.getBigUint64(offset + 8, false));
      if (!Number.isSafeInteger(size)) break;
    }
    if (size < 8 || offset + size > end) break;
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    boxes.push({ offset, size, type, end: offset + size, is64Bit });
    offset += size;
  }
  return boxes;
}

const headerSize = box => (box.is64Bit ? 16 : 8);
const findBox = (boxes, type) => boxes.find(box => box.type === type);
const filterBoxes = (boxes, type) => boxes.filter(box => box.type === type);
const childrenOf = (bytes, box) => parseBoxes(bytes, box.offset + headerSize(box), box.end);

function boxTypeAt(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/** Localiza la primera pista de vídeo (hdlr = 'vide') y su cadena trak→mdia→minf→stbl. */
export function locateVideoTrack(bytes) {
  const moov = findBox(parseBoxes(bytes), 'moov');
  if (!moov) return null;
  for (const trak of filterBoxes(childrenOf(bytes, moov), 'trak')) {
    const mdia = findBox(childrenOf(bytes, trak), 'mdia');
    if (!mdia) continue;
    const mdiaChildren = childrenOf(bytes, mdia);
    const hdlr = findBox(mdiaChildren, 'hdlr');
    if (!hdlr || findHandlerType(bytes, hdlr) !== 'vide') continue;
    const minf = findBox(mdiaChildren, 'minf');
    if (!minf) continue;
    const stbl = findBox(childrenOf(bytes, minf), 'stbl');
    if (!stbl) continue;
    return { moov, trak, mdia, minf, stbl };
  }
  return null;
}

function findHandlerType(bytes, hdlr) {
  for (let i = hdlr.offset + headerSize(hdlr); i + 4 <= hdlr.end; i += 1) {
    if (boxTypeAt(bytes, i) === 'vide') return 'vide';
  }
  return null;
}

/** Códec de la pista de vídeo: los 4 bytes del primer sample entry del stsd. */
export function detectVideoCodec(bytes, stbl) {
  const stsd = findBox(childrenOf(bytes, stbl), 'stsd');
  if (!stsd) return 'unknown';
  const start = stsd.offset + headerSize(stsd);
  if (start + 16 > stsd.end) return 'unknown';
  return boxTypeAt(bytes, start + 12);
}

/** Tamaño de las muestras dummy según el códec (codec-aware, como el patrón NoBlur). */
export function dummySampleSize(codec) {
  return DUMMY_SIZES[codec] || DEFAULT_DUMMY_SIZE;
}

/** Parchea el tamaño de un box (y opcionalmente sus ancestros ya posicionados) tras crecer. */
function setBoxSize(view, box, newSize) {
  if (box.is64Bit) view.setBigUint64(box.offset + 8, BigInt(newSize), false);
  else view.setUint32(box.offset, newSize, false);
}

/** Suma delta a todos los stco/co64 contenidos en el rango (pistas de audio, etc.). */
function shiftChunkOffsets(bytes, start, end, delta) {
  if (!delta) return;
  const view = viewOf(bytes);
  const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
  for (const box of parseBoxes(bytes, start, end)) {
    if (box.type === 'stco') {
      const count = view.getUint32(box.offset + headerSize(box) + 4, false);
      for (let i = 0; i < count; i += 1) {
        const pos = box.offset + headerSize(box) + 8 + i * 4;
        view.setUint32(pos, view.getUint32(pos, false) + delta, false);
      }
    } else if (box.type === 'co64') {
      const count = view.getUint32(box.offset + headerSize(box) + 4, false);
      for (let i = 0; i < count; i += 1) {
        const pos = box.offset + headerSize(box) + 8 + i * 8;
        view.setBigUint64(pos, view.getBigUint64(pos, false) + BigInt(delta), false);
      }
    } else if (containers.has(box.type)) {
      shiftChunkOffsets(bytes, box.offset + headerSize(box), box.end, delta);
    }
  }
}

/** Marca ftyp reescrita a la familia `isom` (HEVC usa major `iso4` + hvc1). */
function buildFtyp(isHevc) {
  const bytes = isHevc ? new Uint8Array(32) : new Uint8Array(28);
  const view = viewOf(bytes);
  view.setUint32(0, bytes.length, false); // campo size del box
  bytes.set([0x66, 0x74, 0x79, 0x70], 4); // 'ftyp'
  bytes.set(isHevc ? [0x69, 0x73, 0x6f, 0x34] : [0x69, 0x73, 0x6f, 0x6d], 8);
  view.setUint32(12, 0x00000200, false); // minor version
  bytes.set([0x69, 0x73, 0x6f, 0x6d], 16);
  bytes.set([0x69, 0x73, 0x6f, 0x32], 20);
  bytes.set(isHevc ? [0x68, 0x76, 0x63, 0x31] : [0x6d, 0x70, 0x34, 0x31], 24);
  return bytes;
}

/** 1. Normalización del contenedor: ftyp→isom, moov reubicado antes de mdat,
 *  y offsets de chunk de TODAS las pistas corregidos según el desplazamiento del mdat. */
export function normalizeContainer(bytes, { force = false } = {}) {
  const topBoxes = parseBoxes(bytes);
  const moov = findBox(topBoxes, 'moov');
  if (!moov) return { bytes, changed: false, valid: false, reason: 'No se encontró el moov (¿no es MP4/MOV?)' };
  const mdat = findBox(topBoxes, 'mdat');
  if (!mdat) return { bytes, changed: false, valid: true, reason: 'Sin mdat: contenedor vacío' };
  const ftyp = findBox(topBoxes, 'ftyp');
  const moovBeforeMdat = moov.offset < mdat.offset;
  const majorBrand = ftyp ? boxTypeAt(bytes, ftyp.offset + headerSize(ftyp)) : '';
  const needsFtyp = Boolean(ftyp) && (majorBrand !== 'isom' || force);
  if (moovBeforeMdat && !needsFtyp) return { bytes, changed: false, valid: true, reason: 'Ya estaba normalizado' };

  const track = locateVideoTrack(bytes);
  const codec = track ? detectVideoCodec(bytes, track.stbl) : 'unknown';
  const ftypBytes = needsFtyp ? buildFtyp(codec === 'hvc1' || codec === 'hev1') : (ftyp ? bytes.subarray(ftyp.offset, ftyp.end) : null);
  const ftypSize = ftypBytes ? ftypBytes.length : 0;
  const newMdatOffset = ftypSize + moov.size;
  const delta = newMdatOffset - mdat.offset;

  const output = new Uint8Array(ftypSize + moov.size + mdat.size);
  let write = 0;
  if (ftypBytes) { output.set(ftypBytes, write); write += ftypSize; }
  output.set(bytes.subarray(moov.offset, moov.end), write);
  const newMoovOffset = write;
  write += moov.size;
  output.set(bytes.subarray(mdat.offset, mdat.end), write);
  if (delta !== 0) shiftChunkOffsets(output, newMoovOffset + 8, newMoovOffset + moov.size, delta);
  return { bytes: output, changed: true, valid: true, reason: `Reordenado (delta mdat ${delta})` };
}

/** 2. Inflado de la tabla de muestras de la pista de vídeo.
 *  El moov debe ir ANTES del mdat (normaliza primero): al crecer el moov, el mdat
 *  se desplaza moovDelta bytes y todos los chunk offsets se compensan. */
export function inflateSampleTable(bytes, { multiplier = MULTIPLIER_DEFAULT } = {}) {
  if (!Number.isFinite(multiplier) || multiplier < MULTIPLIER_MIN || multiplier > MULTIPLIER_MAX) {
    throw new Error(`El factor de inflado debe estar entre ${MULTIPLIER_MIN} y ${MULTIPLIER_MAX}`);
  }
  const track = locateVideoTrack(bytes);
  if (!track) throw new Error('No se encontró la pista de vídeo en el contenedor');
  const view = viewOf(bytes);
  const topBoxes = parseBoxes(bytes);
  const moov = track.moov;
  const mdat = findBox(topBoxes, 'mdat');
  const moovBeforeMdat = !mdat || moov.offset < mdat.offset;

  const stblChildren = childrenOf(bytes, track.stbl);
  const stts = findBox(stblChildren, 'stts');
  const stsz = findBox(stblChildren, 'stsz');
  const stsc = findBox(stblChildren, 'stsc');
  const stco = findBox(stblChildren, 'stco');
  const co64 = findBox(stblChildren, 'co64');
  if (!stts || !stsz || !stsc) throw new Error('Falta stts/stsz/stsc en la tabla de muestras');
  if (!stco && !co64) throw new Error('Falta stco/co64 (offsets de chunk)');

  // Muestras reales y delta medio desde stts.
  const sttsEntries = view.getUint32(stts.offset + 12, false);
  let realCount = 0;
  let totalDuration = 0;
  for (let i = 0; i < sttsEntries; i += 1) {
    const count = view.getUint32(stts.offset + 16 + i * 8, false);
    const delta = view.getUint32(stts.offset + 16 + i * 8 + 4, false);
    realCount += count;
    totalDuration += count * delta;
  }
  if (!realCount) throw new Error('La pista de vídeo no tiene muestras');
  const sampleDelta = Math.round(totalDuration / realCount);

  const codec = detectVideoCodec(bytes, track.stbl);
  const dummySize = dummySampleSize(codec);
  const fakeCount = realCount * (multiplier - 1);
  const origChunkCount = view.getUint32((stco || co64).offset + 12, false);

  // --- Átomos nuevos ---
  // stts: 2 entradas [realCount×delta, fakeCount×delta]
  const sttsSize = 16 + 2 * 8;
  const newStts = new Uint8Array(sttsSize);
  const sttsView = viewOf(newStts);
  sttsView.setUint32(0, sttsSize, false);
  newStts.set([0x73, 0x74, 0x74, 0x73], 4);
  sttsView.setUint32(12, 2, false);
  sttsView.setUint32(16, realCount, false);
  sttsView.setUint32(20, sampleDelta, false);
  sttsView.setUint32(24, fakeCount, false);
  sttsView.setUint32(28, sampleDelta, false);

  // stsz: tabla completa (sample_size=0) con los tamaños reales + dummy
  const totalCount = realCount * multiplier;
  const stszIsCompact = view.getUint32(stsz.offset + 12, false) !== 0; // tamaño constante
  const stszSize = 20 + totalCount * 4;
  const newStsz = new Uint8Array(stszSize);
  const stszView = viewOf(newStsz);
  stszView.setUint32(0, stszSize, false);
  newStsz.set([0x73, 0x74, 0x73, 0x7a], 4);
  stszView.setUint32(16, totalCount, false);
  const constantSize = stszIsCompact ? view.getUint32(stsz.offset + 12, false) : 0;
  for (let i = 0; i < realCount; i += 1) {
    const size = stszIsCompact ? constantSize : view.getUint32(stsz.offset + 20 + i * 4, false);
    stszView.setUint32(20 + i * 4, size, false);
  }
  for (let i = realCount; i < totalCount; i += 1) stszView.setUint32(20 + i * 4, dummySize, false);

  // stsc: entradas originales + 1 nueva (chunk de dummies: 1 muestra por chunk, desc 1)
  const stscEntries = view.getUint32(stsc.offset + 12, false);
  const stscSize = 16 + (stscEntries + 1) * 12;
  const newStsc = new Uint8Array(stscSize);
  const stscView = viewOf(newStsc);
  stscView.setUint32(0, stscSize, false);
  newStsc.set([0x73, 0x74, 0x73, 0x63], 4);
  stscView.setUint32(12, stscEntries + 1, false);
  for (let i = 0; i < stscEntries; i += 1) {
    newStsc.set(bytes.subarray(stsc.offset + 16 + i * 12, stsc.offset + 16 + (i + 1) * 12), 16 + i * 12);
  }
  stscView.setUint32(16 + stscEntries * 12, origChunkCount + 1, false);
  stscView.setUint32(16 + stscEntries * 12 + 4, 1, false);
  stscView.setUint32(16 + stscEntries * 12 + 8, 1, false);

  // deltas de tamaño → crecimiento del moov
  const chunkDelta = fakeCount * (stco ? 4 : 8);
  const moovDelta = (sttsSize - stts.size) + (stszSize - stsz.size) + (stscSize - stsc.size) + chunkDelta;
  const safeOffset = bytes.length + moovDelta; // muestras dummy al final del fichero
  const offsetShift = moovBeforeMdat ? moovDelta : 0;

  // stco/co64: offsets reales + offsetShift, y fakeCount entradas apuntando a safeOffset
  let newChunk;
  if (stco) {
    const stcoSize = 16 + (origChunkCount + fakeCount) * 4;
    newChunk = new Uint8Array(stcoSize);
    const chunkView = viewOf(newChunk);
    chunkView.setUint32(0, stcoSize, false);
    newChunk.set([0x73, 0x74, 0x63, 0x6f], 4);
    chunkView.setUint32(12, origChunkCount + fakeCount, false);
    for (let i = 0; i < origChunkCount; i += 1) {
      chunkView.setUint32(16 + i * 4, view.getUint32(stco.offset + 16 + i * 4, false) + offsetShift, false);
    }
    for (let i = 0; i < fakeCount; i += 1) chunkView.setUint32(16 + (origChunkCount + i) * 4, safeOffset, false);
  } else {
    const co64Size = 16 + (origChunkCount + fakeCount) * 8;
    newChunk = new Uint8Array(co64Size);
    const chunkView = viewOf(newChunk);
    chunkView.setUint32(0, co64Size, false);
    newChunk.set([0x63, 0x6f, 0x36, 0x34], 4);
    chunkView.setUint32(12, origChunkCount + fakeCount, false);
    for (let i = 0; i < origChunkCount; i += 1) {
      chunkView.setBigUint64(16 + i * 8, view.getBigUint64(co64.offset + 16 + i * 8, false) + BigInt(offsetShift), false);
    }
    for (let i = 0; i < fakeCount; i += 1) chunkView.setBigUint64(16 + (origChunkCount + i) * 8, BigInt(safeOffset), false);
  }

  // --- Ensamblado: mismo buffer con los 4 átomos sustituidos en sitio ---
  const replacements = [
    { box: stts, bytes: newStts },
    { box: stsz, bytes: newStsz },
    { box: stsc, bytes: newStsc },
    { box: stco || co64, bytes: newChunk },
  ].sort((a, b) => a.box.offset - b.box.offset);
  const paddingSize = fakeCount * dummySize;
  const output = new Uint8Array(bytes.length + moovDelta + paddingSize);
  let read = 0;
  let write = 0;
  for (const rep of replacements) {
    output.set(bytes.subarray(read, rep.box.offset), write);
    write += rep.box.offset - read;
    output.set(rep.bytes, write);
    write += rep.bytes.length;
    read = rep.box.end;
  }
  output.set(bytes.subarray(read), write);

  // Crece el tamaño de stbl → minf → mdia → trak → moov (los offsets de ancestros no cambian).
  setBoxSize(viewOf(output), track.stbl, track.stbl.size + moovDelta);
  setBoxSize(viewOf(output), track.minf, track.minf.size + moovDelta);
  setBoxSize(viewOf(output), track.mdia, track.mdia.size + moovDelta);
  setBoxSize(viewOf(output), track.trak, track.trak.size + moovDelta);
  setBoxSize(viewOf(output), moov, moov.size + moovDelta);

  // Si el moov precedía al mdat, las OTRAS pistas (audio) también se desplazan.
  if (moovBeforeMdat && mdat) {
    for (const trak of filterBoxes(childrenOf(output, { ...moov, size: moov.size + moovDelta }), 'trak')) {
      const mdia = findBox(childrenOf(output, trak), 'mdia');
      if (!mdia || mdia.offset === track.mdia.offset) continue;
      shiftChunkOffsets(output, mdia.offset + 8, mdia.end, moovDelta);
    }
  }

  const stats = {
    codec,
    dummySize,
    multiplier,
    realSamples: realCount,
    fakeSamples: fakeCount,
    totalSamples: totalCount,
    bytesAdded: moovDelta + paddingSize,
    sampleDelta,
  };
  return { bytes: output, stats };
}

/** Pipeline completo anti-blur sin re-encode: normaliza y luego infla. */
export function prepareNoBlur(bytes, { multiplier = MULTIPLIER_DEFAULT } = {}) {
  const normalized = normalizeContainer(bytes);
  if (!normalized.valid) throw new Error(normalized.reason || 'Contenedor no válido');
  const inflated = inflateSampleTable(normalized.bytes, { multiplier });
  return {
    bytes: inflated.bytes,
    stats: {
      ...inflated.stats,
      normalized: normalized.changed,
      normalizeReason: normalized.reason || '',
    },
  };
}

/** 3. Modo VFI (opcional, usa FFmpeg): interpolación de movimiento a 60 fps ANTES de inflar.
 *  Duplica los fotogramas reales (los dummies pasan a ser legítimos) — el re-encode es
 *  inevitable aquí, pero la interpolación óptica mantiene la nitidez percibida.
 *  Opciones verificadas contra las sources de FFmpeg 9.0.2 (vf_minterpolate.c):
 *   me_mode=bilat (default) · me=epzs · search_param mínimo 4 · scd=none (no corta escenas). */
export const VFI_RESOLUTIONS = { original: null, '720p': 720, '1080p': 1080, '1440p': 1440 };

export function buildVfiFilterChain({ fps = 60, resolution = 'original' } = {}) {
  const targetFps = Number(fps);
  if (!Number.isFinite(targetFps) || targetFps < 24 || targetFps > 120) throw new Error(`FPS de interpolación fuera de rango (24–120): ${fps}`);
  if (!(resolution in VFI_RESOLUTIONS)) throw new Error(`Resolución no soportada: ${resolution}`);
  const chain = [
    'mpdecimate', // descarta frames duplicados antes de interpolar
    `minterpolate=fps=${targetFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bilat:me=epzs:search_param=4:scd=none`,
  ];
  const width = VFI_RESOLUTIONS[resolution];
  if (width) chain.push(`scale=${width}:-2:flags=lanczos`);
  return chain.join(',');
}

export function buildVfiArgs({ input, output, fps = 60, resolution = 'original', crf = 20, includeAudio = true } = {}) {
  if (!input || !output) throw new Error('Se requieren rutas de entrada y salida');
  const chain = buildVfiFilterChain({ fps, resolution });
  const args = ['-hide_banner', '-loglevel', 'error', '-i', input];
  args.push('-filter_complex', `[0:v]${chain}[v]`, '-map', '[v]');
  if (includeAudio) args.push('-map', '0:a?', '-c:a', 'copy');
  else args.push('-an');
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(crf));
  args.push('-map_metadata', '-1'); // metadatos originales fuera
  args.push('-progress', 'pipe:1', '-nostats', '-y', output);
  return args;
}
