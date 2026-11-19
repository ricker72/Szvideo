import test from 'node:test';
import assert from 'node:assert/strict';
import { clipPlaybackProgress, timeAtClipProgress } from '../src/playbackProgress.js';

test('clip progress is measured inside the in/out range', () => {
  const clip = { in: 10, out: 20 };
  assert.deepEqual(clipPlaybackProgress(clip, 5), { current: 0, duration: 10, percent: 0, finished: false });
  assert.equal(clipPlaybackProgress(clip, 15).percent, 50);
  assert.equal(clipPlaybackProgress(clip, 20).finished, true);
  assert.equal(clipPlaybackProgress(clip, 30).current, 10);
});

test('manual clip seeking is clamped to the in/out range', () => {
  const clip = { in: 10, out: 20 };
  assert.equal(timeAtClipProgress(clip, 50), 15);
  assert.equal(timeAtClipProgress(clip, -10), 10);
  assert.equal(timeAtClipProgress(clip, 140), 20);
});
