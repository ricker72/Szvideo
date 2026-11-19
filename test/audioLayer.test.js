import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudioGraph, buildAudioLayerArgs, validateAudioLayersRequest, NOISE_TYPES, MAX_NOISE_VOLUME, MAX_PITCH } from '../src/audioLayer.js';

test('valida la solicitud de capas de audio', () => {
  assert.equal(validateAudioLayersRequest({ output: 'c\\salida.mp4', noiseType: 'rosa', noiseVolume: 2, pitchPercent: 0 }), true);
  assert.equal(validateAudioLayersRequest({ output: 'x.mp4', noiseType: 'ninguno', pitchPercent: 1.5 }), true);
  assert.throws(() => validateAudioLayersRequest({}), /salida/);
  assert.throws(() => validateAudioLayersRequest({ output: 'o.mp4' }), /al menos una capa/);
  assert.throws(() => validateAudioLayersRequest({ output: 'o.mp4', noiseType: 'azul' }), /no soportado/);
  assert.throws(() => validateAudioLayersRequest({ output: 'o.mp4', noiseType: 'rosa', noiseVolume: 0 }), /volumen/);
  assert.throws(() => validateAudioLayersRequest({ output: 'o.mp4', noiseType: 'rosa', noiseVolume: MAX_NOISE_VOLUME + 1 }), /volumen/);
  assert.throws(() => validateAudioLayersRequest({ output: 'o.mp4', pitchPercent: MAX_PITCH + 1 }), /tono/);
  assert.throws(() => validateAudioLayersRequest({ output: 'o.mp4', pitchPercent: -(MAX_PITCH + 0.1) }), /tono/);
});

test('construye el grafo con ruido de fondo a volumen mínimo', () => {
  const rosa = buildAudioGraph({ noiseType: 'rosa', noiseVolume: 2 });
  assert.equal(rosa.mapLabel, '[out]');
  assert.ok(rosa.filter.startsWith('[0:a]anull[voz];'));
  assert.ok(rosa.filter.includes('anoisesrc=color=pink:amplitude=0.0200:seed=111'));
  assert.ok(rosa.filter.includes('[voz][n]amix=inputs=2:duration=first:normalize=0[out]'));
  const blanco = buildAudioGraph({ noiseType: 'blanco', noiseVolume: 1 });
  assert.ok(blanco.filter.includes('anoisesrc=color=white:amplitude=0.0100'));
  const ambiental = buildAudioGraph({ noiseType: 'ambiental', noiseVolume: 2 });
  assert.ok(ambiental.filter.includes('anoisesrc=color=brown'));
});

test('construye el grafo con modulación de tono sin distorsión', () => {
  const subida = buildAudioGraph({ noiseType: 'ninguno', pitchPercent: 2 });
  assert.match(subida.filter, /asetrate=44100\*1\.02/);
  assert.match(subida.filter, /aresample=44100/);
  assert.match(subida.filter, /atempo=0\.980392/);
  assert.ok(subida.filter.startsWith('[0:a]asetrate=44100*1.020000,aresample=44100,atempo=0.980392[out]'));
  const bajada = buildAudioGraph({ noiseType: 'ninguno', pitchPercent: -1 });
  assert.match(bajada.filter, /asetrate=44100\*0\.99/);
  assert.match(bajada.filter, /atempo=1\.010101/);
  const combi = buildAudioGraph({ noiseType: 'rosa', noiseVolume: 2, pitchPercent: 1 });
  assert.match(combi.filter, /asetrate=44100\*1\.010000,aresample=44100,atempo=0\.990099\[voz\]/);
  assert.ok(combi.filter.includes('[voz][n]amix=inputs=2:duration=first:normalize=0[out]'));
});

test('modo de compatibilidad amix: duplica la voz para compensar el divisor', () => {
  const compat = buildAudioGraph({ noiseType: 'rosa', noiseVolume: 2, compatMix: true });
  assert.ok(compat.filter.startsWith('[0:a]anull,volume=2[voz];'));
  assert.ok(compat.filter.includes('[voz][n]amix=inputs=2:duration=first[out]'));
  assert.ok(!compat.filter.includes('normalize'));
});

test('los argumentos de FFmpeg copian el vídeo y eliminan metadatos', () => {
  const args = buildAudioLayerArgs({ input: 'in.mp4', output: 'out.mp4', noiseType: 'rosa', noiseVolume: 2, pitchPercent: 1 });
  const filterIndex = args.indexOf('-filter_complex');
  assert.ok(filterIndex >= 0);
  const firstMap = args.indexOf('-map', filterIndex);
  const mapLabel = args[args.indexOf('-map', firstMap + 1) + 1];
  assert.equal(mapLabel, '[out]');
  assert.equal(args[firstMap + 1], '0:v?');
  assert.equal(args[args.indexOf('-c:v') + 1], 'copy');
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
  assert.ok(args.includes('-map_metadata'));
  assert.ok(args.includes('-map_metadata:s'));
  assert.equal(args[args.length - 1], 'out.mp4');
  const sinStreams = buildAudioLayerArgs({ input: 'in.mp4', output: 'out.mp4', noiseType: 'rosa', stripStreams: false });
  assert.ok(!sinStreams.includes('-map_metadata:s'));
  assert.throws(() => buildAudioLayerArgs({ output: 'out.mp4' }), /Input/);
});
