import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineProject } from '../src/timeline.js';
import { listProjectMedia, adjacentProjectMedia, filterProjectMedia, sortProjectMedia, toggleMediaSelection, renderMediaBin } from '../src/mediaBin.js';

test('media bin groups clips that reference the same source', () => {
  const project = new TimelineProject();
  project.addClip('video-1', { source: 'movie.mp4', duration: 10 });
  project.addClip('video-1', { source: 'movie.mp4', duration: 10, start: 10 });
  project.addClip('video-1', { source: 'other.mp4', duration: 4 });
  const media = listProjectMedia(project);
  assert.equal(media.length, 2);
  assert.equal(media[0].clipCount, 2);
  assert.equal(media[1].clipCount, 1);
});

test('media bin navigates to adjacent unique sources and wraps', () => {
  const project = new TimelineProject();
  project.addClip('video-1', { source: 'a.mp4', duration: 2 });
  project.addClip('video-1', { source: 'b.mp4', duration: 2, start: 2 });
  assert.equal(adjacentProjectMedia(project, 'a.mp4', 1).source, 'b.mp4');
  assert.equal(adjacentProjectMedia(project, 'a.mp4', -1).source, 'b.mp4');
  assert.equal(adjacentProjectMedia(project, null, 1).source, 'a.mp4');
});

test('media bin filters sources case-insensitively without changing the project', () => {
  const items = [{ source: 'C:/Video/Drama.MP4' }, { source: 'C:/Audio/intro.wav' }];
  assert.deepEqual(filterProjectMedia(items, 'drama').map(item => item.source), ['C:/Video/Drama.MP4']);
  assert.equal(filterProjectMedia(items, '').length, 2);
});

test('media bin filters by name and tags', () => {
  const items = [
    { source: 'drama.mp4', name: 'Capítulo 1', tags: ['novela'] },
    { source: 'other.mp4', name: 'Intro', tags: ['presentación'] }
  ];
  assert.deepEqual(filterProjectMedia(items, 'NOVELA').map(item => item.source), ['drama.mp4']);
  assert.deepEqual(filterProjectMedia(items, 'capítulo').map(item => item.source), ['drama.mp4']);
});

test('media bin sorts by name, duration and clip count', () => {
  const items = [{ source: 'z.mp4', duration: 2, clipCount: 1 }, { source: 'a.mp4', duration: 5, clipCount: 3 }];
  assert.equal(sortProjectMedia(items, 'name')[0].source, 'a.mp4');
  assert.equal(sortProjectMedia(items, 'duration')[0].source, 'z.mp4');
  assert.equal(sortProjectMedia(items, 'clips')[0].source, 'a.mp4');
});

test('media bin sorts by incorporation timestamp', () => {
  const items = [{ source: 'new.mp4', duration: 1, clipCount: 1, addedAt: '2025-01-01' }, { source: 'old.mp4', duration: 1, clipCount: 1, addedAt: '2024-01-01' }];
  assert.equal(sortProjectMedia(items, 'added')[0].source, 'old.mp4');
});

test('media selection toggles sources without mutating the original set', () => {
  const selected = new Set(['a.mp4']); const next = toggleMediaSelection(selected, 'b.mp4');
  assert.deepEqual([...selected], ['a.mp4']); assert.deepEqual([...next], ['a.mp4', 'b.mp4']); assert.deepEqual([...toggleMediaSelection(next, 'a.mp4')], ['b.mp4']);
});

test('media bin aggregates tags for repeated sources', () => {
  const project = new TimelineProject(); project.addClip('video-1', { source: 'same.mp4', duration: 2, tags: ['drama'] }); project.addClip('video-1', { source: 'same.mp4', duration: 2, start: 2, tags: ['principal'] });
  assert.deepEqual(listProjectMedia(project)[0].tags, ['drama', 'principal']);
});

test('media bin renders names and tags as literal text', () => {
  class FakeElement {
    constructor() { this.children = []; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    setAttribute() {}
    get allText() { return this.textContent + this.children.map(child => child.allText || child.textContent || '').join(''); }
  }
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => new FakeElement() };
  try {
    const container = new FakeElement();
    renderMediaBin(container, { tracks: [{ clips: [{ id: 'clip-1', source: 'video.mp4', name: '<b>original</b>', duration: 1, tags: ['<img src=x>'] }] }] });
    assert.match(container.children[0].allText, /<b>original<\/b>/);
    assert.match(container.children[0].allText, /<img src=x>/);
  } finally {
    globalThis.document = previousDocument;
  }
});
