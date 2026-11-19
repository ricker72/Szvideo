export function clipPlaybackProgress(clip, time) {
  if (!clip || !Number.isFinite(time)) return { current: 0, duration: 0, percent: 0, finished: false };
  const duration = Math.max(0, clip.out - clip.in);
  const current = Math.min(Math.max(time - clip.in, 0), duration);
  return { current, duration, percent: duration ? (current / duration) * 100 : 0, finished: duration > 0 && current >= duration };
}

export function timeAtClipProgress(clip, percent) {
  if (!clip || !Number.isFinite(percent)) return null;
  const bounded = Math.min(Math.max(percent, 0), 100);
  return clip.in + ((clip.out - clip.in) * bounded) / 100;
}
