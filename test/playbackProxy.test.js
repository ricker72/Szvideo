import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineProject } from '../src/timeline.js';
import { ProjectCommandManager } from '../src/projectCommands.js';
import { selectPlaybackSource } from '../src/playbackSource.js';

test('assigns and toggles a proxy on the same clip', () => {
  const project = new TimelineProject(); const commands = new ProjectCommandManager(project);
  const clip = commands.addClip('video-1', { source: 'original.mkv', duration: 8 });
  commands.setClipProxy('video-1', clip.id, 'proxy.mp4');
  assert.equal(project.tracks[0].clips.length, 1);
  assert.equal(selectPlaybackSource(project.findClip('video-1', clip.id)), 'proxy.mp4');
  commands.setProxyEnabled('video-1', clip.id, false);
  assert.equal(selectPlaybackSource(project.findClip('video-1', clip.id)), 'original.mkv');
});

test('does not select a proxy when one is not assigned', () => {
  assert.equal(selectPlaybackSource({ source: 'original.mp4', proxy: null, useProxy: true }), 'original.mp4');
});
