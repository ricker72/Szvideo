import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineProject } from '../src/timeline.js';
import { ProjectCommandManager } from '../src/projectCommands.js';

test('routes clip and marker changes through commands', () => {
  const project = new TimelineProject(); const changes = [];
  const commands = new ProjectCommandManager(project, { onChange: change => changes.push(change) });
  const clip = commands.addClip('video-1', { source: 'video.mp4', duration: 12 });
  commands.trimClip('video-1', clip.id, 2, 8);
  commands.addMarker(3, 'Scene');
  assert.equal(project.findClip('video-1', clip.id).in, 2);
  assert.equal(project.markers[0].label, 'Scene');
  assert.equal(changes.length, 3);
});

test('undo and redo restore complete validated snapshots', () => {
  const project = new TimelineProject(); const commands = new ProjectCommandManager(project);
  const clip = commands.addClip('video-1', { source: 'video.mp4', duration: 12 });
  commands.splitClip('video-1', clip.id, 5);
  assert.equal(project.tracks[0].clips.length, 2);
  assert.equal(commands.undo(), true);
  assert.equal(project.tracks[0].clips.length, 1);
  assert.equal(commands.redo(), true);
  assert.equal(project.tracks[0].clips.length, 2);
});

test('failed commands do not enter history or mutate the project', () => {
  const project = new TimelineProject(); const commands = new ProjectCommandManager(project);
  assert.throws(() => commands.addClip('video-1', { source: 'broken.mp4', duration: 0 }));
  assert.equal(commands.undo(), false);
  assert.equal(project.tracks[0].clips.length, 0);
});

test('replacing a project clears command history and keeps one command-owned state', () => {
  const project = new TimelineProject(); const commands = new ProjectCommandManager(project);
  commands.addClip('video-1', { source: 'old.mp4', duration: 2 });
  const replacement = new TimelineProject({ name: 'Loaded' });
  commands.replaceProject(replacement);
  assert.equal(project.name, 'Loaded');
  assert.equal(project.tracks[0].clips.length, 0);
  assert.equal(commands.undo(), false);
});

test('updates and removes markers through commands', () => {
  const project = new TimelineProject(); const commands = new ProjectCommandManager(project); commands.addMarker(2, 'inicio'); const marker = project.markers[0];
  commands.updateMarker(marker.id, 4, 'nuevo'); assert.equal(project.markers[0].label, 'nuevo'); assert.equal(project.markers[0].time, 4);
  commands.removeMarker(marker.id); assert.equal(project.markers.length, 0); commands.undo(); assert.equal(project.markers.length, 1); commands.undo(); assert.equal(project.markers[0].label, 'inicio');
});

test('relinks a clip without changing its edit range', () => {
  const project = new TimelineProject(); const commands = new ProjectCommandManager(project); const clip = commands.addClip('video-1', { source: 'missing.mp4', duration: 9, in: 2, out: 7 });
  commands.relinkClip('video-1', clip.id, 'recovered.mp4'); const relinked = project.findClip('video-1', clip.id);
  assert.equal(relinked.source, 'recovered.mp4'); assert.equal(relinked.in, 2); assert.equal(relinked.out, 7); commands.undo(); assert.equal(project.findClip('video-1', clip.id).source, 'missing.mp4');
});

test('adds and removes clip tags through commands', () => {
  const project = new TimelineProject(); const commands = new ProjectCommandManager(project); const clip = commands.addClip('video-1', { source: 'video.mp4', duration: 2 });
  commands.setClipTag('video-1', clip.id, 'drama'); assert.deepEqual(project.findClip('video-1', clip.id).tags, ['drama']); commands.setClipTag('video-1', clip.id, 'drama', false); assert.deepEqual(project.findClip('video-1', clip.id).tags, []);
});
