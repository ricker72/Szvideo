import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineProject } from '../src/timeline.js';
import { ProjectCommandManager } from '../src/projectCommands.js';

test('markers are added through commands and remain ordered for navigation', () => {
  const project = new TimelineProject(); const commands = new ProjectCommandManager(project);
  commands.addMarker(8, 'final'); commands.addMarker(2, 'inicio');
  assert.deepEqual(project.markers.map(marker => marker.time), [2, 8]);
  assert.deepEqual(project.markers.map(marker => marker.label), ['inicio', 'final']);
});
