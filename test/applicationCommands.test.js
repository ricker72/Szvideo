import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineProject } from '../src/timeline.js';
import { ProjectCommandManager } from '../src/projectCommands.js';
import { ProjectStore, serializeProject } from '../src/projectStore.js';
import { ApplicationCommandManager } from '../src/applicationCommands.js';

function setup() {
  const project = new TimelineProject(); const writes = [];
  const store = new ProjectStore({ save: async content => { writes.push(content); return 'project.szvideo'; }, load: async () => null }); store.setProject(project);
  const commands = new ProjectCommandManager(project); return { project, store, commands, writes };
}

test('dispatches save, undo and redo through one interface', async () => {
  const { project, store, commands, writes } = setup();
  const app = new ApplicationCommandManager({ projectCommands: commands, projectStore: store, loadFile: async () => null });
  const clip = commands.addClip('video-1', { source: 'clip.mp4', duration: 2 });
  assert.equal(await app.execute('undo'), true); assert.equal(project.tracks[0].clips.length, 0);
  assert.equal(await app.execute('redo'), true); assert.equal(project.tracks[0].clips.length, 1);
  await app.execute('save'); assert.equal(writes.length, 1); assert.ok(clip.id);
});

test('load and recover validate before replacing state', async () => {
  const { project, store, commands } = setup();
  const loadedProject = new TimelineProject({ name: 'Loaded' });
  const app = new ApplicationCommandManager({ projectCommands: commands, projectStore: store, loadFile: async () => ({ content: serializeProject(loadedProject) }) });
  await app.execute('load'); assert.equal(project.name, 'Loaded');
  const recovered = new TimelineProject({ name: 'Recovered' }); app.execute('recover', serializeProject(recovered)); assert.equal(project.name, 'Recovered');
});

test('unknown application commands fail explicitly', async () => {
  const { store, commands } = setup(); const app = new ApplicationCommandManager({ projectCommands: commands, projectStore: store, loadFile: async () => null });
  await assert.rejects(() => app.execute('not-a-command'), /Unknown application command/);
});

test('cancelled save keeps the project dirty', async () => {
  const project = new TimelineProject();
  const store = new ProjectStore({ save: async () => null, load: async () => null });
  store.setProject(project);
  store.markDirty();
  assert.equal(await store.saveNow(), null);
  assert.equal(store.dirty, true);
});

test('failed save keeps the project dirty and reports the write error', async () => {
  const project = new TimelineProject();
  const store = new ProjectStore({ save: async () => { throw new Error('disk unavailable'); }, load: async () => null });
  store.setProject(project);
  store.markDirty();
  await assert.rejects(() => store.saveNow(), /disk unavailable/);
  assert.equal(store.dirty, true);
});

test('recover restores clips and markers from an exported project document', async () => {
  const project = new TimelineProject(); const commands = new ProjectCommandManager(project); const writes = [];
  const store = new ProjectStore({ save: async content => { writes.push(content); return 'project.szvideo'; }, load: async () => null });
  store.setProject(project); const app = new ApplicationCommandManager({ projectCommands: commands, projectStore: store, loadFile: async () => null });
  const imported = new TimelineProject(); imported.addClip('video-1', { source: 'imported.mp4', duration: 4 }); imported.addMarker(1, 'escena');
  await app.execute('recover', imported.toJSON());
  assert.equal(project.tracks[0].clips[0].source, 'imported.mp4'); assert.equal(project.markers[0].label, 'escena'); assert.equal(writes.length, 0);
});
