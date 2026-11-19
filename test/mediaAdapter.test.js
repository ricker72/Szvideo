import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMediaMetadata } from '../src/mediaAdapter.js';

test('accepts complete media metadata with unknown FPS', () => {
  assert.equal(validateMediaMetadata({ source: 'video.mp4', duration: 4, width: 1920, height: 1080, fps: null }), true);
});
test('rejects incomplete media metadata', () => {
  assert.throws(() => validateMediaMetadata({ source: 'video.mp4', duration: 0, width: 1920, height: 1080, fps: null }), /duration/);
  assert.throws(() => validateMediaMetadata({ source: 'video.mp4', duration: 4, width: 0, height: 1080, fps: null }), /dimensions/);
});
