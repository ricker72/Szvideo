import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineProject } from '../src/timeline.js';
import { PlaybackQueue, projectVideoClips } from '../src/playbackQueue.js';

test('playback queue follows video clip order and stops at the end', () => {
  const project = new TimelineProject();
  const first = project.addClip('video-1', { source: 'a.mp4', duration: 2, start: 0 });
  const second = project.addClip('video-1', { source: 'b.mp4', duration: 3, start: 2 });
  assert.deepEqual(projectVideoClips(project).map(clip => clip.id), [first.id, second.id]);
  const queue = new PlaybackQueue(project);
  assert.equal(queue.start(first.id).id, first.id);
  assert.equal(queue.next().id, second.id);
  assert.equal(queue.next(), null);
  assert.equal(queue.enabled, false);
});
