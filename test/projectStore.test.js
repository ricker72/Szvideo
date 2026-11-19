import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineProject } from '../src/timeline.js';
import { ProjectStore, serializeProject, deserializeProject } from '../src/projectStore.js';

function makeProject() { const project = new TimelineProject({ name: 'Persisted', fps: 30 }); project.addClip('video-1', { source: 'video.mp4', duration: 10 }); return project; }

test('serializes and deserializes validated projects', () => {
  const restored = deserializeProject(serializeProject(makeProject()));
  assert.equal(restored.name, 'Persisted');
  assert.equal(restored.tracks[0].clips[0].source, 'video.mp4');
});

test('saves only after the project is marked dirty', async () => {
  const writes = [];
  const store = new ProjectStore({ save: async (content, filePath) => { writes.push({ content, filePath }); return filePath || 'saved.szvideo'; }, load: async content => content });
  store.setProject(makeProject());
  assert.equal(store.dirty, false);
  store.markDirty();
  assert.equal(await store.saveNow(), 'saved.szvideo');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].filePath, null);
  assert.equal(store.dirty, false);
});

test('auto-save can be started and stopped cleanly', async () => {
  let saves = 0;
  const store = new ProjectStore({ save: async (content, filePath) => { saves += 1; return filePath || 'autosave.szvideo'; }, load: async content => content, intervalMs: 5 });
  store.setProject(makeProject()); store.markDirty(); await store.saveNow(); store.markDirty(); store.startAutoSave();
  await new Promise(resolve => setTimeout(resolve, 20));
  store.stopAutoSave();
  assert.ok(saves >= 1);
  const count = saves;
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(saves, count);
});
