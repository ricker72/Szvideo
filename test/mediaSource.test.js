import test from 'node:test';
import assert from 'node:assert/strict';
import { createLazyMediaSource, ProxyManager } from '../src/mediaSource.js';

test('lazy media source stores descriptors without media bytes', () => {
  const source = createLazyMediaSource({ source: 'large.mkv', name: 'large.mkv', duration: 100, width: 3840, height: 2160, size: 999 });
  assert.equal(source.proxy, null); assert.equal(source.source, 'large.mkv'); assert.equal(Object.keys(source).includes('bytes'), false);
});

test('proxy manager delegates generation and returns a proxy descriptor', async () => {
  const states = []; const manager = new ProxyManager({ createProxy: async options => { assert.equal(options.width, 640); return { path: 'proxy.mp4' }; }, onProgress: state => states.push(state) });
  const result = await manager.create(createLazyMediaSource({ source: 'large.mkv', duration: 10, width: 1920, height: 1080 }));
  assert.equal(result.proxy, 'proxy.mp4'); assert.deepEqual(states.map(state => state.state), ['starting', 'complete']);
});
