import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MULTIPLIER_MAX, MULTIPLIER_MIN,
  buildVfiArgs, buildVfiFilterChain,
  detectVideoCodec, dummySampleSize, inflateSampleTable,
  locateVideoTrack, normalizeContainer, parseBoxes, prepareNoBlur,
} from '../src/mp4Patch.js';

/** Helper: construye un box MP4 real (size + type + payload). */
function box(type, ...payloads) {
  const payload = payloads.reduce((total, part) => {
    const bytes = part instanceof Uint8Array ? part
      : Array.isArray(part) ? Uint8Array.from(part) : u32(part);
    const next = new Uint8Array(total.length + bytes.length);
    next.set(total); next.set(bytes, total.length);
    return next;
  }, new Uint8Array(0));
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length, false);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let write = 0;
  for (const part of parts) { out.set(part, write); write += part.length; }
  return out;
}
function u32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, false);
  return out;
}

/** Fixture MP4 sintético: ftyp + moov(trak→mdia→{hdlr'vide',minf→stbl{stts,stsd,stsc,stsz,stco}}) + mdat.
 *  3 muestras de vídeo (100/200/50 bytes) en 1 chunk que apunta al inicio del mdat. */
function buildFixture({ brand = 'isom', moovFirst = false, codec = 'avc1' } = {}) {
  const hdlr = box('hdlr', 0, 0, 0x76696465, 0, 0, 0); // 'vide' como handler_type
  const stts = box('stts', 0, 1, 3, 512);              // 1 entrada: 3 muestras × delta 512
  const stsdEntry = box(codec, 0, 0, 0, 0, 0);         // sample entry del códec
  const stsd = box('stsd', 0, 1, stsdEntry);
  const stsc = box('stsc', 0, 1, 1, 3, 1);             // 1 entrada: chunk 1, 3 muestras, desc 1
  const stsz = box('stsz', 0, 0, 3, 100, 200, 50);     // sample_size=0, 3 tamaños
  const stco = box('stco', 0, 1, 0);                   // 1 chunk (offset se rellena abajo)
  const stbl = box('stbl', stts, stsd, stsc, stsz, stco);
  const minf = box('minf', stbl);
  const mdia = box('mdia', hdlr, minf);
  const trak = box('trak', mdia);
  const moov = box('moov', trak);
  const ftyp = box('ftyp', brand.split('').map(c => c.charCodeAt(0)), 0x200,
    'isom'.split('').map(c => c.charCodeAt(0)), 'iso2'.split('').map(c => c.charCodeAt(0)),
    'mp41'.split('').map(c => c.charCodeAt(0)));
  const mdat = box('mdat', 1, 2, 3, 4, 5, 6); // 24 bytes de datos

  const bytes = moovFirst ? concat(ftyp, moov, mdat) : concat(ftyp, mdat, moov);
  // Parchea la entrada del chunk DENTRO del buffer final (apunta al primer byte de datos del mdat).
  // Ruta secuencial hasta la tabla de entradas del stco (último hijo de stbl):
  //   moov hdr(8) + trak hdr(8) + mdia hdr(8) + hdlr + minf hdr(8) + stbl hdr(8)
  //   + stts + stsd + stsc + stsz + stco hdr(8) + ver/flags(4) + entry_count(4).
  const moovOffsetInFile = moovFirst ? ftyp.length : ftyp.length + mdat.length;
  const stcoEntryPos = moovOffsetInFile + 8 + 8 + 8 + hdlr.length + 8 + 8
    + stts.length + stsd.length + stsc.length + stsz.length + 8 + 8;
  const mdatDataStart = moovFirst ? ftyp.length + moov.length + 8 : ftyp.length + 8;
  new DataView(bytes.buffer).setUint32(stcoEntryPos, mdatDataStart, false);
  return bytes;
}

test('parseBoxes lee los boxes de nivel superior con tamaños correctos', () => {
  const bytes = buildFixture();
  const boxes = parseBoxes(bytes);
  assert.deepEqual(boxes.map(b => b.type), ['ftyp', 'mdat', 'moov']);
  assert.equal(boxes[1].type, 'mdat');
  assert.equal(boxes[2].end, bytes.length);
});

test('locateVideoTrack encuentra trak→mdia→minf→stbl por handler «vide»', () => {
  const bytes = buildFixture();
  const track = locateVideoTrack(bytes);
  assert.ok(track);
  assert.equal(track.stbl.type, 'stbl');
  assert.equal(detectVideoCodec(bytes, track.stbl), 'avc1');
});

test('detectVideoCodec devuelve unknown sin stsd y dummySampleSize por códec', () => {
  assert.equal(dummySampleSize('avc1'), 8);
  assert.equal(dummySampleSize('avc3'), 8);
  assert.equal(dummySampleSize('hvc1'), 16);
  assert.equal(dummySampleSize('hev1'), 16);
  assert.equal(dummySampleSize('vp09'), 4);
  assert.equal(dummySampleSize('av01'), 4);
  assert.equal(dummySampleSize('mp4v'), 8);
  assert.equal(dummySampleSize('desconocido'), 8);
});

test('normalizeContainer mueve moov antes de mdat y compensa los chunk offsets', () => {
  const bytes = buildFixture({ moovFirst: false });
  const result = normalizeContainer(bytes);
  assert.equal(result.valid, true);
  assert.equal(result.changed, true);
  const top = parseBoxes(result.bytes);
  assert.deepEqual(top.slice(0, 3).map(b => b.type), ['ftyp', 'moov', 'mdat']);
  // El chunk offset del vídeo debe seguir apuntando a los mismos datos del mdat.
  const track = locateVideoTrack(result.bytes);
  const stco = parseBoxes(result.bytes, track.stbl.offset + 8, track.stbl.end).find(b => b.type === 'stco');
  const chunkOffset = new DataView(result.bytes.buffer, result.bytes.byteOffset).getUint32(stco.offset + 16, false);
  const mdat = top.find(b => b.type === 'mdat');
  assert.ok(chunkOffset >= mdat.offset + 8 && chunkOffset < mdat.end);
  // Idempotente: ya normalizado no cambia nada.
  const again = normalizeContainer(result.bytes);
  assert.equal(again.changed, false);
  assert.match(again.reason, /normalizado/i);
});

test('normalizeContainer falla de forma clara sin moov', () => {
  const onlyFtyp = box('ftyp', 0x69736f6d, 0x200);
  const result = normalizeContainer(concat(onlyFtyp, box('mdat', 1)));
  assert.equal(result.valid, false);
  assert.match(result.reason, /moov/);
});

test('inflateSampleTable ×10: stts 2 entradas, stsz con dummies, stco con chunk falso al final', () => {
  const bytes = buildFixture({ moovFirst: true });
  const result = inflateSampleTable(bytes, { multiplier: 10 });
  const out = result.bytes;
  assert.equal(result.stats.realSamples, 3);
  assert.equal(result.stats.fakeSamples, 27);
  assert.equal(result.stats.totalSamples, 30);
  assert.equal(result.stats.codec, 'avc1');
  assert.equal(result.stats.dummySize, 8);

  const top = parseBoxes(out);
  const track = locateVideoTrack(out);
  const stblBoxes = parseBoxes(out, track.stbl.offset + 8, track.stbl.end);
  const stts = stblBoxes.find(b => b.type === 'stts');
  const stsz = stblBoxes.find(b => b.type === 'stsz');
  const stsc = stblBoxes.find(b => b.type === 'stsc');
  const stco = stblBoxes.find(b => b.type === 'stco');
  const view = new DataView(out.buffer, out.byteOffset);
  // stts: 2 entradas (3 reales + 27 falsas, mismo delta)
  assert.equal(view.getUint32(stts.offset + 12, false), 2);
  assert.equal(view.getUint32(stts.offset + 16, false), 3);
  assert.equal(view.getUint32(stts.offset + 24, false), 27);
  // stsz: 30 entradas — reales + 27 dummy de 8 bytes
  assert.equal(view.getUint32(stsz.offset + 16, false), 30);
  assert.equal(view.getUint32(stsz.offset + 20 + 2 * 4, false), 50); // última real intacta
  assert.equal(view.getUint32(stsz.offset + 20 + 29 * 4, false), 8);
  // stsc: entradas originales + 1 del chunk de dummies
  assert.equal(view.getUint32(stsc.offset + 12, false), 2);
  assert.equal(view.getUint32(stsc.offset + 16 + 12, false), 2); // first_chunk del chunk falso
  // stco: 1 real + 27 falsas apuntando a la zona de padding (final del fichero)
  assert.equal(view.getUint32(stco.offset + 12, false), 28);
  const fakeOffset = view.getUint32(stco.offset + 16 + 4, false);
  assert.ok(fakeOffset >= top.find(b => b.type === 'mdat').end);
  assert.ok(fakeOffset < out.length);
  // El padding de dummies existe (27 × 8 bytes de ceros) tras el último box real.
  const lastReal = top[top.length - 1];
  assert.ok(fakeOffset + 27 * 8 <= out.length);
  assert.ok(out.length > bytes.length);
});

test('inflateSampleTable con hvc1 usa muestras dummy de 16 bytes', () => {
  const bytes = buildFixture({ moovFirst: true, codec: 'hvc1' });
  const result = inflateSampleTable(bytes, { multiplier: 3 });
  assert.equal(result.stats.codec, 'hvc1');
  assert.equal(result.stats.dummySize, 16);
});

test('inflateSampleTable valida el multiplicador', () => {
  const bytes = buildFixture({ moovFirst: true });
  assert.throws(() => inflateSampleTable(bytes, { multiplier: 1 }), /factor de inflado/);
  assert.throws(() => inflateSampleTable(bytes, { multiplier: MULTIPLIER_MAX + 1 }), /factor de inflado/);
  assert.equal(MULTIPLIER_MIN, 2);
});

test('prepareNoBlur: normaliza + infla en un solo paso (moov al final, sin FFmpeg)', () => {
  const bytes = buildFixture({ moovFirst: false, brand: 'qt  ' });
  const result = prepareNoBlur(bytes, { multiplier: 10 });
  assert.equal(result.stats.normalized, true);
  assert.equal(result.stats.realSamples, 3);
  assert.equal(result.stats.totalSamples, 30);
  const top = parseBoxes(result.bytes);
  // Los 3 boxes reales + el padding EOF de ceros (lo interpreta el parser como box de tamaño 0).
  assert.deepEqual(top.slice(0, 3).map(b => b.type), ['ftyp', 'moov', 'mdat']);
  // La marca ahora es isom (compatible TikTok) y el archivo creció con el padding.
  const ftyp = top[0];
  const brand = String.fromCharCode(result.bytes[ftyp.offset + 8], result.bytes[ftyp.offset + 9], result.bytes[ftyp.offset + 10], result.bytes[ftyp.offset + 11]);
  assert.equal(brand, 'isom');
  assert.ok(result.bytes.length > bytes.length);
  // El chunk real sigue apuntando a datos dentro del mdat (vídeo decodificable).
  const track = locateVideoTrack(result.bytes);
  const stblBoxes = parseBoxes(result.bytes, track.stbl.offset + 8, track.stbl.end);
  const stco = stblBoxes.find(b => b.type === 'stco');
  const chunkOffset = new DataView(result.bytes.buffer, result.bytes.byteOffset).getUint32(stco.offset + 16, false);
  const mdat = top.find(b => b.type === 'mdat');
  assert.ok(chunkOffset >= mdat.offset + 8 && chunkOffset < mdat.end);
});

test('prepareNoBlur es idempotente en tamaño de muestra real (no corrompe al segundo paso)', () => {
  const bytes = buildFixture({ moovFirst: true });
  const once = prepareNoBlur(bytes, { multiplier: 5 });
  const statsOnce = once.stats;
  const twice = prepareNoBlur(once.bytes, { multiplier: 2 });
  assert.equal(statsOnce.multiplier, 5);
  assert.equal(twice.stats.realSamples, 15); // las dummies ya cuentan como muestras
});

test('VFI: cadena de interpolación con opciones verificadas en FFmpeg 9.0.2', () => {
  const chain = buildVfiFilterChain({ fps: 60, resolution: 'original' });
  assert.equal(chain, 'mpdecimate,minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bilat:me=epzs:search_param=4:scd=none');
  assert.match(buildVfiFilterChain({ fps: 60, resolution: '1080p' }), /scale=1080:-2:flags=lanczos$/);
  assert.throws(() => buildVfiFilterChain({ fps: 10 }), /FPS/);
  assert.throws(() => buildVfiFilterChain({ resolution: '4k' }), /Resolución/);
});

test('VFI: argumentos FFmpeg completos (audio copiado, metadatos fuera, progreso)', () => {
  const args = buildVfiArgs({ input: 'in.mp4', output: 'out.mp4', resolution: '720p' });
  assert.equal(args[args.indexOf('-i') + 1], 'in.mp4');
  const chain = args[args.indexOf('-filter_complex') + 1];
  assert.equal(chain, '[0:v]mpdecimate,minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bilat:me=epzs:search_param=4:scd=none,scale=720:-2:flags=lanczos[v]');
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
  assert.equal(args[args.indexOf('-preset') + 1], 'ultrafast');
  assert.equal(args[args.indexOf('-crf') + 1], '20');
  assert.equal(args[args.indexOf('-map_metadata') + 1], '-1');
  assert.equal(args[args.indexOf('-c:a') + 1], 'copy');
  assert.equal(args[args.length - 1], 'out.mp4');
  const sinAudio = buildVfiArgs({ input: 'in.mp4', output: 'out.mp4', includeAudio: false });
  assert.ok(sinAudio.includes('-an'));
});
