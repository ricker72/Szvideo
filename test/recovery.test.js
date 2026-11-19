import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineProject } from '../src/timeline.js';
import { serializeProject, deserializeProject } from '../src/projectStore.js';

test('recovery data restores a valid project', () => {
  const project = new TimelineProject({ name: 'Recovery test' });
  project.addClip('video-1', { source: 'source.mp4', duration: 4 });
  const recovered = deserializeProject(serializeProject(project));
  assert.equal(recovered.name, 'Recovery test');
  assert.equal(recovered.tracks[0].clips.length, 1);
});

test('corrupt recovery data is rejected instead of partially applied', () => {
  assert.throws(() => deserializeProject('{"schema":"szvideo-project/v1","tracks":null}'), /Invalid track|Project must contain/);
});
