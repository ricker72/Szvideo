import test from 'node:test';
import assert from 'node:assert/strict';
// La copia de web/ debe comportarse EXACTAMENTE igual que el módulo canónico de src/.
import * as webPatch from '../web/mp4Patch.js';
import * as srcPatch from '../src/mp4Patch.js';

function u32(value) { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value >>> 0, false); return out; }
function box(type, ...payloads) {
  const payload = payloads.reduce((total, part) => {
    const bytes = part instanceof Uint8Array ? part : u32(part);
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
function buildFixture() {
  const hdlr = box('hdlr', 0, 0, 0x76696465, 0, 0, 0);
  const stts = box('stts', 0, 1, 3, 512);
  const stsd = box('stsd', 0, 1, box('avc1', 0, 0, 0, 0, 0));
  const stsc = box('stsc', 0, 1, 1, 3, 1);
  const stsz = box('stsz', 0, 0, 3, 100, 200, 50);
  const stco = box('stco', 0, 1, 0);
  const stbl = box('stbl', stts, stsd, stsc, stsz, stco);
  const minf = box('minf', stbl);
  const mdia = box('mdia', hdlr, minf);
  const trak = box('trak', mdia);
  const moov = box('moov', trak);
  const ftyp = box('ftyp', Uint8Array.from([0x69, 0x73, 0x6f, 0x6d]), 0x200);
  const mdat = box('mdat', 1, 2, 3, 4, 5, 6);
  const bytes = concat(ftyp, moov, mdat);
  const stcoEntryPos = ftyp.length + 8 + 8 + 8 + hdlr.length + 8 + 8 + stts.length + stsd.length + stsc.length + stsz.length + 8 + 8;
  new DataView(bytes.buffer).setUint32(stcoEntryPos, ftyp.length + moov.length + 8, false);
  return bytes;
}

test('la copia web exporta la misma API que el módulo canónico', () => {
  assert.deepEqual(Object.keys(webPatch).sort(), Object.keys(srcPatch).sort());
});

test('la copia web aplica el mismo parche NoBlur que la app de escritorio', () => {
  const bytes = buildFixture();
  const web = webPatch.prepareNoBlur(bytes, { multiplier: 10 });
  const desktop = srcPatch.prepareNoBlur(bytes, { multiplier: 10 });
  assert.equal(web.stats.totalSamples, 30);
  assert.deepEqual(web.bytes, desktop.bytes);
  assert.deepEqual(web.stats, desktop.stats);
});
