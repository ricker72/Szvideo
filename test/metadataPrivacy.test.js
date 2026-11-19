import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCleanArgs, parseMetadataBlocks, formatMetadataSummary, suggestCleanOutput, summarizePrivacyTags, validateCleanRequest } from '../src/metadataPrivacy.js';

test('sugiere una salida -clean junto al original', () => {
  assert.equal(suggestCleanOutput('C:\\Users\\sam\\Videos\\clip.mp4'), 'C:\\Users\\sam\\Videos\\clip-clean.mp4');
  assert.equal(suggestCleanOutput('/home/sam/clip.webm'), '/home/sam/clip-clean.webm');
  assert.equal(suggestCleanOutput('video'), 'video-clean.mp4');
});

test('valida la solicitud de limpieza de metadatos', () => {
  assert.equal(validateCleanRequest({ input: 'a\\clip.mp4', output: 'a\\clip-clean.mp4' }), true);
  assert.throws(() => validateCleanRequest({}), /entrada/);
  assert.throws(() => validateCleanRequest({ input: 'a.txt', output: 'b.mp4' }), /entrada/);
  assert.throws(() => validateCleanRequest({ input: 'clip.mp4', output: 'clip.txt' }), /salida/);
  assert.throws(() => validateCleanRequest({ input: 'clip.mp4', output: 'clip.mp4' }), /distinto/);
});

test('los argumentos de FFmpeg eliminan EXIF, GPS, autoría y capítulos sin recodificar', () => {
  const args = buildCleanArgs({ input: 'clip.mp4', output: 'clip-clean.mp4' });
  const index = (token) => args.indexOf(token);
  assert.ok(index('-map_metadata') >= 0 && args[index('-map_metadata') + 1] === '-1');
  assert.ok(index('-map_metadata:s') >= 0 && args[index('-map_metadata:s') + 1] === '-1');
  assert.ok(index('-map_chapters') >= 0 && args[index('-map_chapters') + 1] === '-1');
  assert.ok(index('-map', ) >= 0 && args.includes('-0:d?') && args.includes('-0:t?'));
  assert.equal(args[index('-c') + 1], 'copy');
  assert.equal(args[args.length - 1], 'clip-clean.mp4');
  const withoutStreams = buildCleanArgs({ input: 'clip.mp4', output: 'clip-clean.mp4', stripStreams: false });
  assert.ok(!withoutStreams.includes('-map_metadata:s'));
});

const dump = [
  "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':",
  '  Metadata:',
  '    major_brand     : isom',
  '    com.apple.quicktime.make: Apple',
  '    creation_time   : 2024-03-01T10:00:00',
  '  Duration: 00:00:05.05, start: 0.000000, bitrate: 5400 kb/s',
  '  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080',
  '    Metadata:',
  '      rotate         : 90',
  '      handler_name   : Core Media Video',
  '      com.apple.quicktime.location.ISO6709: +37.7749-122.4194/10.00',
  '  Side data:',
  '    displaymatrix: rotation of -90.00 degrees',
].join('\n');

test('extrae los bloques de metadatos del volcado de FFmpeg', () => {
  const blocks = parseMetadataBlocks(dump);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].scope.kind, 'archivo');
  assert.ok(blocks[0].entries.some(entry => entry.key === 'major_brand' && entry.value === 'isom'));
  assert.equal(blocks[1].scope.kind, 'pista');
  assert.equal(blocks[1].scope.label, '#0:0');
  assert.ok(blocks[1].entries.some(entry => entry.key === 'com.apple.quicktime.location.ISO6709'));
  assert.deepEqual(parseMetadataBlocks(''), []);
  assert.deepEqual(parseMetadataBlocks(null), []);
});

test('clasifica los metadatos en categorías de privacidad', () => {
  const summary = summarizePrivacyTags(parseMetadataBlocks(dump));
  assert.equal(summary.total, 6);
  assert.equal(summary.riesgo, 'alto');
  assert.equal(summary.categories['ubicación'].length, 1);
  assert.equal(summary.categories['dispositivo'].length, 1);
  assert.equal(summary.categories['software'].length, 1);
  assert.ok(summary.categories['otros'].includes('major_brand: isom'));
  const sinRiesgo = summarizePrivacyTags([{ scope: { kind: 'archivo' }, entries: [{ key: 'major_brand', value: 'isom' }] }]);
  assert.equal(sinRiesgo.riesgo, 'bajo');
  assert.deepEqual(summarizePrivacyTags(null).categories['otros'], []);
});

test('presenta un resumen legible', () => {
  const summary = summarizePrivacyTags(parseMetadataBlocks(dump));
  const text = formatMetadataSummary(summary);
  assert.match(text, /Metadatos detectados: 6 · riesgo alto/);
  assert.match(text, /— ubicación \(1\)/);
  assert.match(text, /· #0:0 · com\.apple\.quicktime\.location\.ISO6709/);
  assert.equal(formatMetadataSummary(null), 'Sin metadatos analizados.');
  assert.match(formatMetadataSummary({ total: 0, categories: { 'ubicación': [], 'dispositivo': [], 'autoría': [], 'software': [], 'otros': [] }, riesgo: 'bajo' }), /0 metadatos/);
});
