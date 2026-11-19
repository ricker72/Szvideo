import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineProject } from '../src/timeline.js';
import { ProjectCommandManager } from '../src/projectCommands.js';
import { ProjectStore, serializeProject } from '../src/projectStore.js';
import { ApplicationCommandManager } from '../src/applicationCommands.js';
import { findMissingMedia } from '../src/mediaValidation.js';

test('media recovery detects missing sources and relinks them without losing edits', async () => {
  const project = new TimelineProject();
  const commands = new ProjectCommandManager(project);
  const clip = commands.addClip('video-1', { source: 'missing.mp4', duration: 12, in: 2, out: 9 });
  commands.addClip('video-1', { source: 'available.mp4', duration: 4 });

  const existing = new Set(['available.mp4']);
  const missing = await findMissingMedia(project, async source => existing.has(source));
  assert.deepEqual(missing, ['missing.mp4']);

  commands.relinkClip('video-1', clip.id, 'recovered.mp4');
  const relinked = project.findClip('video-1', clip.id);
  assert.equal(relinked.source, 'recovered.mp4');
  assert.equal(relinked.in, 2);
  assert.equal(relinked.out, 9);
  assert.deepEqual(await findMissingMedia(project, async source => source === 'recovered.mp4' || source === 'available.mp4'), []);
});

test('recovery restores a project before checking its missing media', async () => {
  const savedProject = new TimelineProject({ name: 'Recuperable' });
  savedProject.addClip('video-1', { source: 'recovery-missing.mp4', duration: 6 });
  const project = new TimelineProject();
  const commands = new ProjectCommandManager(project);
  const store = new ProjectStore({ save: async () => 'recovered.szvideo', load: async () => null });
  store.setProject(project);
  const app = new ApplicationCommandManager({ projectCommands: commands, projectStore: store, loadFile: async () => null });

  await app.execute('recover', serializeProject(savedProject));
  assert.equal(project.name, 'Recuperable');
  assert.deepEqual(await findMissingMedia(project, async source => source !== 'recovery-missing.mp4'), ['recovery-missing.mp4']);
});
