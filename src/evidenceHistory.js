export function appendEvidence(history = [], entry) {
  if (!entry?.type || !entry?.status) throw new Error('Evidence entry requires type and status');
  return [...history, { ...entry, recordedAt: entry.recordedAt || new Date().toISOString() }];
}
export function summarizeEvidence(history = []) { return history.map(item => `${item.recordedAt} · ${item.type} · ${item.status}`); }
