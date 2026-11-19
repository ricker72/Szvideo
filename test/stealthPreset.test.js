import test from 'node:test';
import assert from 'node:assert/strict';
import { TIKTOK_STUDIO, buildStealthPresetArgs, describeStealthPreset, STEALTH_PRESET, validateTikTokUpload } from '../src/stealthPreset.js';
import { buildAudioGraph } from '../src/audioLayer.js';

test('el preset por defecto es válido y está descrito', () => {
  assert.equal(STEALTH_PRESET.speedPercent, 2);
  assert.equal(STEALTH_PRESET.audioNoiseType, 'rosa');
  const descripcion = describeStealthPreset();
  assert.match(descripcion, /velocidad \+2% · zoom 3% · desplazamiento X \+1% · ruido visual 3 · saturación \+2% · sticker @6%/);
  assert.match(descripcion, /audio: rosa a 2% · tono \+1%/);
  assert.match(descripcion, /metadatos eliminados/);
  assert.match(descripcion, /compatible TikTok Studio/);
});

test('los argumentos combinan vídeo y audio en un solo filter_complex', () => {
  const args = buildStealthPresetArgs({ input: 'in.mp4', output: 'out.mp4' });
  const graphIndex = args.indexOf('-filter_complex');
  const graph = args[graphIndex + 1];
  const [video, ...audioParts] = graph.split(';');
  const audio = audioParts.join(';');
  assert.match(video, /^\[0:v\]setpts=PTS\/1\.020000,eq=saturation=1\.0200/);
  assert.match(video, /noise=alls=3:allf=t/);
  assert.match(video, /scale=trunc\(iw\*1\.0300\/2\)\*2/);
  assert.match(video, /crop=trunc\(iw\/1\.0300\/2\)\*2/);
  // Compatibilidad TikTok Studio: píxeles yuv420p garantizados al final de la cadena.
  assert.match(video, /color=white@0\.060:t=fill,format=yuv420p\[v\]$/);
  // Audio: pitch (+1%) con su atempo de compensación, luego atempo de velocidad (2%), luego ruido rosa.
  assert.match(audio, /\[0:a\]asetrate=44100\*1\.010000,aresample=44100,atempo=0\.990099,atempo=1\.0200\[voz\]/);
  assert.match(audio, /anoisesrc=color=pink:amplitude=0\.0200:seed=111\[n\]/);
  assert.match(audio, /amix=inputs=2:duration=first:normalize=0\[out\]$/);
  assert.equal(args[args.indexOf('-map', graphIndex) + 1], '[v]');
  assert.equal(args[args.lastIndexOf('-map') + 1], '[out]');
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
  assert.equal(args[args.indexOf('-crf') + 1], '18');
  // Perfil High y faststart: la subida web de TikTok Studio procesa sin fallos.
  assert.equal(args[args.indexOf('-profile:v') + 1], 'high');
  assert.equal(args[args.indexOf('-movflags') + 1], '+faststart');
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
  assert.ok(args.includes('-map_metadata:s'));
  assert.equal(args[args.length - 1], 'out.mp4');
});

test('sin pista de audio: -an y graph solo de vídeo', () => {
  const args = buildStealthPresetArgs({ input: 'in.mp4', output: 'out.mp4', includeAudio: false });
  assert.ok(args.includes('-an'));
  assert.ok(!args.includes('[out]'));
  const graph = args[args.indexOf('-filter_complex') + 1];
  assert.ok(!graph.includes(';'));
});

test('sobrescrituras: sin velocidad el atempo desaparece y el tono sostiene el audio', () => {
  const args = buildStealthPresetArgs({ input: 'in.mp4', output: 'out.mp4', speedPercent: 0 });
  const audio = args[args.indexOf('-filter_complex') + 1].split(';').slice(1).join(';');
  assert.match(audio, /atempo=0\.990099\[voz\]/);
  const sinAudio = buildStealthPresetArgs({ input: 'in.mp4', output: 'out.mp4', speedPercent: 0, pitchPercent: 0, audioNoiseType: 'blanco' });
  const blanco = sinAudio[sinAudio.indexOf('-filter_complex') + 1].split(';').slice(1).join(';');
  assert.match(blanco, /anoisesrc=color=white/);
  assert.ok(!blanco.includes('asetrate'));
});

test('buildAudioGraph acepta filtros extra de voz', () => {
  const graph = buildAudioGraph({ noiseType: 'rosa', noiseVolume: 2, vozFilters: ['atempo=1.0200', 'volume=1.5'] });
  assert.match(graph.filter, /\[0:a\]atempo=1\.0200,volume=1\.5\[voz\]/);
});

test('requiere entrada y salida', () => {
  assert.throws(() => buildStealthPresetArgs({ output: 'out.mp4' }), /Input/);
  assert.throws(() => buildStealthPresetArgs({ input: 'in.mp4' }), /Input/);
});

test('validateTikTokUpload: archivo vertical estándar pasa sin avisos', () => {
  const result = validateTikTokUpload({ duration: 42, size: 90 * 1048576, width: 1080, height: 1920 });
  assert.equal(result.compatible, true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.warnings, []);
});

test('validateTikTokUpload detecta los rechazos típicos del validador de subida', () => {
  const result = validateTikTokUpload({ duration: 700, size: 3 * 1048576 * 1024, width: 359, height: 641 });
  assert.equal(result.compatible, false);
  assert.ok(result.issues.some(i => /10 min/.test(i)));
  assert.ok(result.issues.some(i => /2 GB/.test(i)));
  assert.ok(result.issues.some(i => /mínimo de 360/.test(i)));
  assert.ok(result.issues.some(i => /impares/.test(i)));
});

test('validateTikTokUpload avisa (sin bloquear) por proporción no vertical y dura ≤ 10 min', () => {
  const horizontal = validateTikTokUpload({ duration: 240, size: 500 * 1048576, width: 1920, height: 1080 });
  assert.equal(horizontal.compatible, true);
  assert.ok(horizontal.warnings.some(w => /3 min/.test(w)));
  assert.ok(horizontal.warnings.some(w => /9:16/.test(w)));
});

test('límites documentados de TikTok Studio', () => {
  assert.equal(TIKTOK_STUDIO.maxDurationSeconds, 600);
  assert.equal(TIKTOK_STUDIO.maxSizeBytes, 2 * 1024 * 1024 * 1024);
  assert.match(TIKTOK_STUDIO.videoCodec, /H\.264.*yuv420p/);
});

test('extrae un clip con -ss/-t y aplica metadatos nuevos', () => {
  const args = buildStealthPresetArgs({ input: 'in.mp4', output: 'clip.mp4', start: 12.5, seconds: 45, metadata: { title: 'Mi clip', author: '', copyright: 'All rights reserved' } });
  assert.equal(args[3], '-ss');
  assert.equal(args[4], '12.500');
  assert.equal(args[5], '-i');
  assert.equal(args[7], '-t');
  assert.equal(args[8], '45.000');
  const metadataIndex = args.indexOf('-metadata');
  assert.equal(args[metadataIndex + 1], 'title=Mi clip');
  assert.ok(!args.some(arg => typeof arg === 'string' && arg.startsWith('author=')));
  assert.equal(args[args.indexOf('-map_metadata') + 1], '-1');
  assert.equal(args[args.length - 1], 'clip.mp4');
  const sinClip = buildStealthPresetArgs({ input: 'in.mp4', output: 'out.mp4' });
  assert.ok(!sinClip.includes('-ss') && !sinClip.includes('-t'));
});
