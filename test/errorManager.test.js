import test from 'node:test';
import assert from 'node:assert/strict';
import { ErrorManager } from '../src/errorManager.js';
test('normalizes, logs and notifies operation errors', () => {
  const notifications = [], logs = [];
  const manager = new ErrorManager({ notify: message => notifications.push(message), log: entry => logs.push(entry) });
  const error = manager.report(new Error('disk unavailable'), 'guardar el proyecto');
  assert.equal(error.message, 'disk unavailable'); assert.match(notifications[0], /guardar el proyecto/); assert.equal(logs[0].context, 'guardar el proyecto');
});
test('run returns null and prevents an operation error from escaping', async () => {
  const manager = new ErrorManager();
  assert.equal(await manager.run(async () => { throw new Error('analysis failed'); }, 'analizar'), null);
});
