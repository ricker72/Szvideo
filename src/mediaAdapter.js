const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'ogv']);

export function validateMediaMetadata(metadata) {
  if (!metadata || typeof metadata.source !== 'string' || !metadata.source) throw new Error('Media source is required');
  if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) throw new Error('Media duration is unavailable');
  if (!Number.isInteger(metadata.width) || metadata.width <= 0 || !Number.isInteger(metadata.height) || metadata.height <= 0) throw new Error('Media dimensions are unavailable');
  if (metadata.fps !== null && metadata.fps !== undefined && (!Number.isFinite(metadata.fps) || metadata.fps <= 0)) throw new Error('Invalid media FPS');
  return true;
}

function extensionOf(source) { return source.split(/[\\/.]/).pop()?.toLowerCase() || ''; }

export class MediaAdapter {
  constructor({ createVideo = () => document.createElement('video') } = {}) { this.createVideo = createVideo; }
  async inspect(source, { name = '', size = null } = {}) {
    const sourceValue = source instanceof File ? URL.createObjectURL(source) : localMediaUrl(String(source));
    const fileName = name || (source instanceof File ? source.name : String(source).split(/[\\/]/).pop());
    if (!VIDEO_EXTENSIONS.has(extensionOf(fileName))) throw new Error(`Unsupported video format: ${extensionOf(fileName) || 'unknown'}`);
    const video = this.createVideo(); video.preload = 'metadata'; video.muted = true; video.src = sourceValue;
    try {
      const metadata = await new Promise((resolve, reject) => {
        video.addEventListener('loadedmetadata', () => resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight }), { once: true });
        video.addEventListener('error', () => reject(new Error('The video could not be decoded')), { once: true });
        video.load();
      });
      let fps = null;
      if (typeof video.captureStream === 'function') fps = video.captureStream().getVideoTracks()[0]?.getSettings?.().frameRate || null;
      const result = { source: source instanceof File ? fileName : String(source), name: fileName, size: size ?? (source instanceof File ? source.size : null), duration: metadata.duration, width: metadata.width, height: metadata.height, fps: fps ? Number(fps) : null };
      validateMediaMetadata(result); return result;
    } finally { if (source instanceof File) URL.revokeObjectURL(sourceValue); video.removeAttribute('src'); video.load(); }
  }
}
