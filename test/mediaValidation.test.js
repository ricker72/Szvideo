import test from 'node:test';
import assert from 'node:assert/strict';
import { findMissingMedia } from '../src/mediaValidation.js';

test('detects missing unique media sources without rejecting the project', async () => {
  const project = { tracks: [{ clips: [{ source: 'a.mp4' }, { source: 'a.mp4' }, { source: 'b.mp4' }] }] };
  const missing = await findMissingMedia(project, async source => source === 'a.mp4');
  assert.deepEqual(missing, ['b.mp4']);
});
