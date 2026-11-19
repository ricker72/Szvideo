import test from 'node:test';
import assert from 'node:assert/strict';
import { deserializeProject } from '../src/projectStore.js';

test('a valid recovery document can be loaded before showing recovery choices', () => {
  const recovery = JSON.stringify({ schema: 'szvideo-project/v1', name: 'Recovered', fps: 30, tracks: [{ id: 'video-1', type: 'video', clips: [] }], markers: [] });
  assert.equal(deserializeProject(recovery).name, 'Recovered');
});

test('an invalid recovery document cannot be offered as recoverable', () => {
  assert.throws(() => deserializeProject('{"schema":"szvideo-project/v1"}'));
});
