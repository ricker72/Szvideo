import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineProject } from '../src/timeline.js';
import { ProjectCommandManager } from '../src/projectCommands.js';
import { PlaybackController } from '../src/playbackController.js';

function videoMock() {
  const listeners = {}; return { src: '', currentTime: 3, duration: 10, paused: true, load() { queueMicrotask(() => listeners.loadedmetadata?.()); }, addEventListener(type, callback) { listeners[type] = callback; }, removeEventListener() {}, async play() { this.paused = false; }, pause() { this.paused = true; } };
}
test('loads and switches the real playback source without duplicating the clip', async () => {
  const project = new TimelineProject(); const commands = new ProjectCommandManager(project); const clip = commands.addClip('video-1', { source: 'original.mp4', duration: 10 }); commands.setClipProxy('video-1', clip.id, 'proxy.mp4');
  commands.setProxyEnabled('video-1', clip.id, false);
  const video = videoMock(); const controller = new PlaybackController({ video, commands }); controller.loadClip(clip); assert.match(video.src, /original\.mp4/);
  await controller.toggleProxy(true); assert.match(video.src, /proxy\.mp4/); assert.equal(project.tracks[0].clips.length, 1);
  await controller.toggleProxy(false); assert.match(video.src, /original\.mp4/);
});

test('playback controls play, pause and stop within the selected clip', async () => {
  const project = new TimelineProject(); const commands = new ProjectCommandManager(project);
  const clip = commands.addClip('video-1', { source: 'original.mp4', duration: 10, in: 2, out: 8 });
  const video = videoMock(); const controller = new PlaybackController({ video, commands }); controller.adoptClip(clip); video.currentTime = 6;
  await controller.play(); assert.equal(video.paused, false);
  controller.pause(); assert.equal(video.paused, true);
  assert.equal(controller.stop(), 2); assert.equal(video.currentTime, 2);
});

test('audio and frame controls stay within valid bounds', () => {
  const project = new TimelineProject(); const commands = new ProjectCommandManager(project); const clip = commands.addClip('video-1', { source: 'original.mp4', duration: 10, in: 2, out: 8 });
  const video = videoMock(); video.volume = 1; video.muted = false; const controller = new PlaybackController({ video, commands }); controller.adoptClip(clip); video.currentTime = 2;
  assert.equal(controller.setVolume(2), 1); assert.equal(video.volume, 1); assert.equal(controller.setMuted(true), true); assert.equal(controller.stepFrame(1, 25), 2.04); video.currentTime = 8; assert.equal(controller.stepFrame(1, 25), 8);
});
