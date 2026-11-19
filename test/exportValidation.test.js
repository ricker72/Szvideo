import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExportRequest } from '../src/exportValidation.js';
const valid = { input: 'video.mp4', output: 'out.mp4', format: 'mp4', duration: 4, backend: 'ffmpeg' };
test('accepts a complete export request', () => assert.equal(validateExportRequest(valid), true));
test('rejects invalid format, duration and backend', () => {
  assert.throws(() => validateExportRequest({ ...valid, format: 'avi' }), /Formato/);
  assert.throws(() => validateExportRequest({ ...valid, duration: 0 }), /duración/);
  assert.throws(() => validateExportRequest({ ...valid, backend: 'unavailable' }), /backend/);
});
test('requires a matching output extension', () => assert.throws(() => validateExportRequest({ ...valid, output: 'out.webm' }), /extensión/));
