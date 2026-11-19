import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineProject } from '../src/timeline.js';

function projectWithClip() {
  const project = new TimelineProject({ name: 'Test', fps: 25 });
  const clip = project.addClip('video-1', { source: 'original.mp4', duration: 20 });
  return { project, clip };
}

test('adds a clip to the requested track', () => {
  const { project, clip } = projectWithClip();
  assert.equal(project.tracks[0].clips.length, 1);
  assert.equal(clip.source, 'original.mp4');
  assert.equal(clip.out, 20);
});

test('stores clip incorporation metadata and preserves supplied timestamps', () => {
  const project = new TimelineProject(); const clip = project.addClip('video-1', { source: 'video.mp4', duration: 2, addedAt: '2024-01-02T00:00:00.000Z' });
  assert.equal(clip.addedAt, '2024-01-02T00:00:00.000Z'); assert.match(project.addClip('video-1', { source: 'other.mp4', duration: 2 }).addedAt, /^20/);
});

test('stores optional media name and size without requiring them', () => {
  const project = new TimelineProject(); const clip = project.addClip('video-1', { source: 'video.mp4', name: 'Video', size: 1024, duration: 2 });
  assert.equal(clip.name, 'Video'); assert.equal(clip.size, 1024); const legacy = project.addClip('video-1', { source: 'legacy.mp4', duration: 2 }); assert.equal(legacy.size, null);
});

test('trims a clip without changing its source', () => {
  const { project, clip } = projectWithClip();
  assert.equal(project.trimClip('video-1', clip.id, 3, 12), true);
  assert.deepEqual(project.findClip('video-1', clip.id), { ...clip, in: 3, out: 12 });
});

test('splits a clip into two contiguous clips', () => {
  const { project, clip } = projectWithClip();
  assert.equal(project.splitClip('video-1', clip.id, 8), true);
  const clips = project.tracks[0].clips;
  assert.equal(clips.length, 2);
  assert.equal(clips[0].out, 8);
  assert.equal(clips[1].in, 8);
  assert.equal(clips[1].start, 8);
  assert.notEqual(clips[0].id, clips[1].id);
});

test('supports markers and undo/redo', () => {
  const { project } = projectWithClip();
  project.addMarker(4, 'Intro');
  assert.equal(project.markers.length, 1);
  assert.equal(project.undo(), true);
  assert.equal(project.markers.length, 0);
  assert.equal(project.redo(), true);
  assert.equal(project.markers[0].label, 'Intro');
});

test('serializes a complete project document', () => {
  const { project } = projectWithClip();
  const document = JSON.parse(project.toJSON());
  assert.equal(document.schema, 'szvideo-project/v1');
  assert.equal(document.fps, 25);
  assert.equal(document.tracks[0].clips[0].source, 'original.mp4');
});

test('rejects clips without a positive duration', () => {
  const project = new TimelineProject();
  assert.throws(() => project.addClip('video-1', { source: 'bad.mp4', duration: 0 }), /positive duration/);
});

test('rejects invalid trim ranges without changing the clip', () => {
  const { project, clip } = projectWithClip();
  assert.equal(project.trimClip('video-1', clip.id, 2, 30), false);
  assert.equal(clip.in, 0);
  assert.equal(clip.out, 20);
});

test('loads only valid project documents', () => {
  const { project } = projectWithClip();
  const restored = TimelineProject.fromJSON(project.toJSON());
  assert.equal(restored.tracks[0].clips[0].source, 'original.mp4');
  assert.throws(() => TimelineProject.fromJSON('{"schema":"unknown"}'), /Unsupported project schema/);
});
