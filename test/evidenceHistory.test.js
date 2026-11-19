import test from 'node:test'; import assert from 'node:assert/strict'; import { appendEvidence, summarizeEvidence } from '../src/evidenceHistory.js';
test('appends immutable evidence entries', () => { const history = appendEvidence([], { type: 'integrity', status: 'verified' }); assert.equal(history.length, 1); assert.ok(history[0].recordedAt); });
test('summarizes evidence for display', () => { assert.match(summarizeEvidence([{ recordedAt: 'now', type: 'comparison', status: 'similar' }])[0], /comparison · similar/); });
