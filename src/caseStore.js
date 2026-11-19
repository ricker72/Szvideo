export function serializeCase(caseRecord) {
  if (!caseRecord?.original?.sha256) throw new Error('A case requires original SHA-256 evidence');
  return JSON.stringify({ schema: 'szvideo-case/v1', exportedAt: new Date().toISOString(), ...caseRecord }, null, 2);
}
export function deserializeCase(value) {
  const record = typeof value === 'string' ? JSON.parse(value) : value;
  if (!record || record.schema !== 'szvideo-case/v1' || !record.original?.sha256) throw new Error('Invalid SzVideo case');
  return record;
}
