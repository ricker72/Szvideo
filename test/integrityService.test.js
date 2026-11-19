import test from 'node:test';
import assert from 'node:assert/strict';
import { compareFingerprint, buildIntegrityRecord } from '../src/integrityService.js';

const original = { sha256: 'abc', path: 'video.mp4' };
test('verifies an unchanged original', () => assert.equal(compareFingerprint(original, { sha256: 'abc' }).status, 'verified'));
test('detects a changed original', () => assert.equal(compareFingerprint(original, { sha256: 'def' }).status, 'changed'));
test('reports incomplete fingerprint data safely', () => assert.equal(compareFingerprint(original, null).status, 'unknown'));
test('builds a timestamped integrity record', () => { const record = buildIntegrityRecord(original, { sha256: 'abc', path: 'video.mp4' }); assert.equal(record.status, 'verified'); assert.ok(record.checkedAt); });
