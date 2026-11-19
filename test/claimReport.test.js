import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClaimReport } from '../src/claimReport.js';
test('builds a complete technical copyright report', () => { const report = buildClaimReport({ caseRecord: { original: { name: 'original.mp4', sha256: 'abc' }, integrity: { status: 'verified' }, perceptual: { hash: '1010' } }, comparison: { status: 'similar' }, claimant: 'Creator' }); assert.equal(report.schema, 'szvideo-copyright-report/v1'); assert.equal(report.original.sha256, 'abc'); assert.equal(report.comparison.status, 'similar'); assert.ok(report.generatedAt); });
test('requires original hash evidence', () => assert.throws(() => buildClaimReport({ caseRecord: { original: {} } }), /verified original/));
test('includes validated project markers in the copyright report', () => { const report = buildClaimReport({ caseRecord: { original: { sha256: 'abc' } }, project: { name: 'Edit', fps: 30, tracks: [], markers: [{ time: 3, label: 'escena' }] } }); assert.equal(report.project.markers[0].label, 'escena'); });
