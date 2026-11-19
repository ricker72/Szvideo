export function selectPlaybackSource(clip, { preferProxy = true } = {}) {
  if (!clip?.source) throw new Error('Clip has no original source');
  return preferProxy && clip.useProxy && clip.proxy ? clip.proxy : clip.source;
}
