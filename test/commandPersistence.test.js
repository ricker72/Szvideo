import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineProject } from '../src/timeline.js';
import { connectCommandPersistence } from '../src/commandPersistence.js';

test('successful commands mark dirty and write recovery automatically', async () => {
  const project = new TimelineProject(); const writes = []; let dirty = false; let marked = 0;
  const commands = connectCommandPersistence(project, { store: { markDirty: () => { marked += 1; } }, setDirty: value => { dirty = value; }, writeRecovery: async value => writes.push(value) });
  commands.addClip('video-1', { source: 'video.mp4', duration: 5 }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(marked, 1); assert.equal(dirty, true); assert.equal(writes.length, 1); assert.match(writes[0], /video\.mp4/);
});

test('failed commands do not mark dirty or write recovery', async () => {
  const project = new TimelineProject(); let marked = 0; let writes = 0;
  const commands = connectCommandPersistence(project, { store: { markDirty: () => { marked += 1; } }, writeRecovery: async () => { writes += 1; } });
  assert.throws(() => commands.addClip('video-1', { source: 'bad.mp4', duration: 0 })); await new Promise(resolve => setImmediate(resolve));
  assert.equal(marked, 0); assert.equal(writes, 0);
});
