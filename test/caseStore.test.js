import test from 'node:test'; import assert from 'node:assert/strict'; import { serializeCase, deserializeCase } from '../src/caseStore.js';
test('serializes and imports a case independently', () => { const record = { original: { sha256: 'abc' }, history: [{ type: 'integrity', status: 'verified' }] }; const restored = deserializeCase(serializeCase(record)); assert.equal(restored.original.sha256, 'abc'); assert.equal(restored.history.length, 1); });
test('rejects invalid case documents', () => assert.throws(() => deserializeCase('{"schema":"szvideo-case/v1"}'), /Invalid/));
