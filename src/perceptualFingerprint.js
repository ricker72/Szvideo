import { VideoAnalyzer } from './analyzer.js';

export function buildPerceptualRecord(frame) {
  if (!frame?.hash || !Array.isArray(frame.histogram)) throw new Error('Frame analysis is incomplete');
  return { hash: frame.hash, histogram: frame.histogram, capturedAt: new Date().toISOString() };
}

export function comparePerceptualRecords(left, right) {
  if (!left?.hash || !right?.hash || left.hash.length !== right.hash.length) return { status: 'unknown', similarity: null };
  const distance = VideoAnalyzer.hammingDistance(left.hash, right.hash);
  const similarity = 1 - distance / left.hash.length;
  return { status: similarity >= 0.75 ? 'similar' : 'different', similarity, hammingDistance: distance };
}
