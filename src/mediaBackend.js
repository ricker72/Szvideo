export function detectMediaBackend({ platform = (typeof navigator !== 'undefined' ? navigator.userAgent : ''), ffmpegAvailable = false } = {}) {
  const isWindows = /Windows/i.test(platform);
  return {
    primary: isWindows ? 'media-foundation' : 'html-media',
    playback: 'html-media',
    metadata: 'html-media',
    proxy: ffmpegAvailable ? 'ffmpeg' : 'unavailable',
    export: ffmpegAvailable ? 'ffmpeg' : 'unavailable',
  };
}

export function mediaFoundationCapabilities() {
  return { playback: true, metadata: true, seeking: true, proxy: false, export: false, source: 'Windows Media Foundation through HTMLMediaElement' };
}
