import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMediaBackend, mediaFoundationCapabilities } from '../src/mediaBackend.js';

test('Windows uses Media Foundation-backed native media for basics', () => {
  const backend = detectMediaBackend({ platform: 'Windows NT 10.0', ffmpegAvailable: false });
  assert.equal(backend.primary, 'media-foundation'); assert.equal(backend.playback, 'html-media'); assert.equal(backend.proxy, 'unavailable');
});
test('FFmpeg is optional and only enables advanced operations', () => {
  const backend = detectMediaBackend({ platform: 'Windows NT 10.0', ffmpegAvailable: true });
  assert.equal(backend.playback, 'html-media'); assert.equal(backend.proxy, 'ffmpeg');
});
test('Media Foundation capability declaration is explicit', () => {
  assert.equal(mediaFoundationCapabilities().proxy, false);
});
