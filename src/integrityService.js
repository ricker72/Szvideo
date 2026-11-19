export function compareFingerprint(expected, actual) {
  if (!expected || !actual) return { status: 'unknown', reason: 'Fingerprint data is incomplete' };
  if (expected.sha256 !== actual.sha256) return { status: 'changed', reason: 'SHA-256 does not match', expected: expected.sha256, actual: actual.sha256 };
  return { status: 'verified', reason: 'SHA-256 matches', sha256: actual.sha256 };
}

export function buildIntegrityRecord(original, fingerprint) {
  const result = compareFingerprint(original, fingerprint);
  return { checkedAt: new Date().toISOString(), path: fingerprint?.path || original?.path || null, ...result };
}
