import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudioChain, buildVideoChain, buildVisualLayerArgs, describeVisualLayers, hasActiveEffects, validateVisualLayersRequest } from '../src/visualLayer.js';

const activos = { speedPercent: 2, zoomPercent: 3, offsetXPercent: 1, offsetYPercent: 0.5, barsPercent: 5, noiseStrength: 4, saturationPercent: 2, contrastPercent: 1, brightnessPercent: 1, tint: 'azul', tintOpacity: 2, sticker: true, stickerOpacity: 6 };

test('valida la solicitud de transformación visual', () => {
  assert.equal(validateVisualLayersRequest({ speedPercent: 2 }), true);
  assert.equal(validateVisualLayersRequest(activos), true);
  assert.throws(() => validateVisualLayersRequest({}), /al menos un efecto/);
  assert.throws(() => validateVisualLayersRequest({ speedPercent: 5 }), /velocidad/);
  assert.throws(() => validateVisualLayersRequest({ zoomPercent: -1 }), /zoom/);
  assert.throws(() => validateVisualLayersRequest({ offsetXPercent: 9 }), /desplazamiento/);
  assert.throws(() => validateVisualLayersRequest({ barsPercent: 20 }), /barras/);
  assert.throws(() => validateVisualLayersRequest({ noiseStrength: 99 }), /ruido/);
  assert.throws(() => validateVisualLayersRequest({ saturationPercent: -9 }), /saturación/);
  assert.throws(() => validateVisualLayersRequest({ brightnessPercent: -1 }), /brillo/);
  assert.throws(() => validateVisualLayersRequest({ tint: 'verde' }), /Color de capa/);
  assert.throws(() => validateVisualLayersRequest({ tint: 'azul' }), /capa de color/);
  assert.throws(() => validateVisualLayersRequest({ sticker: true }), /sticker/);
});

test('detecta si hay efectos activos', () => {
  assert.equal(hasActiveEffects({}), false);
  assert.equal(hasActiveEffects({ speedPercent: 0 }), false);
  assert.equal(hasActiveEffects({ noiseStrength: 1 }), true);
  assert.equal(hasActiveEffects({ tint: 'ninguno' }), false);
  assert.equal(hasActiveEffects({ tint: 'magenta', tintOpacity: 2 }), true);
});

test('cadena de vídeo: velocidad, color, ruido, zoom, barras, capa y sticker', () => {
  const soloVelocidad = buildVideoChain({ speedPercent: 2 });
  assert.equal(soloVelocidad, 'setpts=PTS/1.020000');
  const color = buildVideoChain({ saturationPercent: 2, contrastPercent: 1, brightnessPercent: 1 });
  assert.equal(color, 'eq=saturation=1.0200:contrast=1.0100:brightness=0.0100');
  assert.match(buildVideoChain({ noiseStrength: 4 }), /noise=alls=4:allf=t/);
  const zoom = buildVideoChain({ zoomPercent: 3, offsetXPercent: 1, offsetYPercent: 0.5 });
  assert.match(zoom, /scale=trunc\(iw\*1\.0300\/2\)\*2:trunc\(ih\*1\.0300\/2\)\*2/);
  assert.match(zoom, /crop=trunc\(iw\/1\.0300\/2\)\*2:trunc\(ih\/1\.0300\/2\)\*2:\(iw-ow\)\/2\+trunc\(iw\*0\.0100\):\(ih-oh\)\/2\+trunc\(ih\*0\.0050\)/);
  const barras = buildVideoChain({ barsPercent: 5 });
  assert.match(barras, /drawbox=x=0:y=0:w=iw:h=trunc\(ih\*0\.0500\):color=black@1:t=fill/);
  assert.match(barras, /y=ih-trunc\(ih\*0\.0500\)/);
  assert.match(buildVideoChain({ tint: 'azul', tintOpacity: 2 }), /drawbox=x=0:y=0:w=iw:h=ih:color=azul@0\.020:t=fill/);
  assert.match(buildVideoChain({ sticker: true, stickerOpacity: 6 }), /w=trunc\(iw\*0\.12\):h=trunc\(ih\*0\.12\):color=white@0\.060:t=fill/);
  const completo = buildVideoChain(activos);
  assert.match(completo, /^setpts=PTS\/1\.020000,eq=/);
  assert.ok(completo.includes('noise=alls=4') && completo.includes('drawbox'));
});

test('cadena de audio: atempo sincroniza la velocidad sin cambiar el tono', () => {
  assert.equal(buildAudioChain(2), 'atempo=1.0200');
  assert.equal(buildAudioChain(-1), 'atempo=0.9900');
  assert.equal(buildAudioChain(0), 'anull');
});

test('argumentos FFmpeg: re-encode x264, audio sincronizado y sin metadatos', () => {
  const args = buildVisualLayerArgs({ input: 'in.mp4', output: 'out.mp4', speedPercent: 2, zoomPercent: 3 });
  const filterIndex = args.indexOf('-filter_complex');
  const graph = args[filterIndex + 1];
  assert.equal(graph, '[0:v]setpts=PTS/1.020000,scale=trunc(iw*1.0300/2)*2:trunc(ih*1.0300/2)*2,crop=trunc(iw/1.0300/2)*2:trunc(ih/1.0300/2)*2:(iw-ow)/2+trunc(iw*0.0000):(ih-oh)/2+trunc(ih*0.0000)[v];[0:a]atempo=1.0200[a]');
  assert.equal(args[args.indexOf('-map', filterIndex) + 1], '[v]');
  assert.ok(args.includes('[a]'));
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
  assert.equal(args[args.indexOf('-crf') + 1], '18');
  assert.ok(args.includes('-map_metadata:s'));
  assert.equal(args[args.length - 1], 'out.mp4');
  assert.throws(() => buildVisualLayerArgs({ output: 'out.mp4' }), /Input/);
});

test('variantes de audio y de metadatos', () => {
  const sinAudio = buildVisualLayerArgs({ input: 'in.mp4', output: 'out.mp4', speedPercent: 2, includeAudio: false });
  assert.ok(sinAudio.includes('-an'));
  assert.ok(!sinAudio.includes('[a]'));
  const copia = buildVisualLayerArgs({ input: 'in.mp4', output: 'out.mp4', zoomPercent: 2, speedPercent: 0 });
  assert.equal(copia[copia.lastIndexOf('-map') + 1], '0:a?');
  assert.equal(copia[copia.indexOf('-c:a') + 1], 'copy');
  const sinStreams = buildVisualLayerArgs({ input: 'in.mp4', output: 'out.mp4', barsPercent: 5, stripStreams: false });
  assert.ok(!sinStreams.includes('-map_metadata:s'));
});

test('describe los efectos activos', () => {
  assert.equal(describeVisualLayers({}), '');
  assert.equal(describeVisualLayers({ speedPercent: 2 }), 'velocidad +2%');
  const texto = describeVisualLayers(activos);
  assert.match(texto, /velocidad \+2% · zoom 3% · desplazamiento X \+1% · desplazamiento Y \+0\.5% · barras 5% · ruido visual 4 · saturación \+2% · contraste \+1% · brillo \+1% · capa azul @2% · sticker @6%/);
});
