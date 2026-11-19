import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPerceptualRecord, comparePerceptualRecords } from '../src/perceptualFingerprint.js';
test('stores a perceptual hash and histogram', () => { const record = buildPerceptualRecord({ hash: '1010', histogram: [0.5, 0.5] }); assert.equal(record.hash, '1010'); assert.ok(record.capturedAt); });
test('compares similar and different fingerprints', () => { assert.equal(comparePerceptualRecords({ hash: '1111' }, { hash: '1110' }).status, 'similar'); assert.equal(comparePerceptualRecords({ hash: '1111' }, { hash: '0000' }).status, 'different'); });
