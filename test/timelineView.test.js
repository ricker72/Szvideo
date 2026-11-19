import test from 'node:test'; import assert from 'node:assert/strict'; import { TimelineProject } from '../src/timeline.js';
test('timeline model exposes clips for visual rendering', () => { const project = new TimelineProject(); project.addClip('video-1', { source: 'clip.mp4', duration: 5 }); assert.equal(project.tracks[0].clips.length, 1); assert.equal(project.tracks[0].clips[0].out, 5); });
