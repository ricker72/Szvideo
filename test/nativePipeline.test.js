import test from 'node:test';
import assert from 'node:assert/strict';
import { describeNativeSupport, drawProcessedFrame, NATIVE_MIME_CANDIDATES, pickNativeMime, whiteNoiseBuffer } from '../src/nativePipeline.js';

function mockCtx() {
  const calls = [];
  const ctx = {
    canvas: { width: 640, height: 360 },
    globalAlpha: 1, fillStyle: '', font: '', textBaseline: '',
    save() { calls.push('save'); }, restore() { calls.push('restore'); },
    clearRect(...a) { calls.push(['clearRect', ...a]); },
    fillRect(...a) { calls.push(['fillRect', ...a]); },
    drawImage(...a) { calls.push(['drawImage', ...a]); },
    fillText(...a) { calls.push(['fillText', ...a]); },
    measureText: text => ({ width: text.length * 10 }),
  };
  return { ctx, calls };
}

test('detecta las capacidades nativas', () => {
  const sinDom = describeNativeSupport({});
  assert.equal(sinDom.mediaRecorder, false);
  assert.equal(sinDom.canvas, false);
  const conDom = describeNativeSupport({ document: { createElement: () => ({ captureStream: () => ({}), getContext: () => null }) }, MediaRecorder: function () {}, AudioContext: function () {} });
  assert.equal(conDom.mediaRecorder, true);
  assert.equal(conDom.captureStream, true);
  assert.equal(conDom.webAudio, true);
});

test('elige el primer MIME soportado por MediaRecorder', () => {
  assert.equal(pickNativeMime({ isTypeSupported: mime => mime === 'video/webm' }), 'video/webm');
  assert.equal(pickNativeMime({ isTypeSupported: () => false }), null);
  assert.equal(pickNativeMime(undefined), null);
  assert.ok(NATIVE_MIME_CANDIDATES[0].startsWith('video/webm'));
});

test('el buffer de ruido es bipolar y del tamaño pedido', () => {
  const buffer = whiteNoiseBuffer(100, () => 0.75);
  assert.equal(buffer.length, 100);
  assert.equal(buffer[0], 0.5);
  assert.ok(buffer.every(value => value >= -1 && value <= 1));
});

test('dibuja zoom + desplazamiento sobre el frame', () => {
  const { ctx, calls } = mockCtx();
  drawProcessedFrame(ctx, {}, { zoomPercent: 3, offsetXPercent: 1, offsetYPercent: 0.5, barsPercent: 0, tint: 'ninguno', sticker: false, watermark: null });
  const draw = calls.find(call => call[0] === 'drawImage');
  assert.ok(draw);
  const sw = 640 / 1.03, sh = 360 / 1.03;
  assert.equal(draw[2], (640 - sw) / 2 + 0.01 * 640);
  assert.equal(draw[3], (360 - sh) / 2 + 0.005 * 360);
  assert.equal(draw[4], sw);
  assert.equal(draw[5], sh);
  assert.ok(!calls.some(call => call[0] === 'fillRect'));
});

test('sin zoom dibuja el frame completo', () => {
  const { ctx, calls } = mockCtx();
  drawProcessedFrame(ctx, {}, { watermark: null });
  const draw = calls.find(call => call[0] === 'drawImage');
  assert.deepEqual(draw, ['drawImage', {}, 0, 0, 640, 360]);
});

test('aplica barras, capa de color, sticker y marca de agua', () => {
  const { ctx, calls } = mockCtx();
  drawProcessedFrame(ctx, {}, { barsPercent: 5, tint: 'azul', tintOpacity: 2, sticker: true, stickerOpacity: 6 });
  const rects = calls.filter(call => call[0] === 'fillRect');
  // 2 barras + capa de color + sticker + fondo de la marca de agua
  assert.equal(rects.length, 5);
  assert.deepEqual(rects[0], ['fillRect', 0, 0, 640, 18]);          // barra superior (5% de 360)
  assert.deepEqual(rects[1], ['fillRect', 0, 342, 640, 18]);        // barra inferior
  assert.deepEqual(rects[2], ['fillRect', 0, 0, 640, 360]);         // capa azul
  assert.equal(calls.filter(call => call[0] === 'fillText').length, 1);
  const stickerRect = rects[3];
  assert.equal(stickerRect[1], 640 - 640 * 0.12 - 640 * 0.03); // x (tamaño cuadrado basado en el ancho)
  assert.equal(stickerRect[2], 360 - 640 * 0.12 - 640 * 0.03); // y
});
