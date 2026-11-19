export function createLazyMediaSource(metadata) {
  if (!metadata?.source || !Number.isFinite(metadata.duration)) throw new Error('A valid media descriptor is required');
  return Object.freeze({ source: metadata.source, name: metadata.name || metadata.source.split(/[\\/]/).pop(), duration: metadata.duration, width: metadata.width, height: metadata.height, fps: metadata.fps ?? null, size: metadata.size ?? null, proxy: null });
}

export class ProxyManager {
  constructor({ createProxy, onProgress = () => {} } = {}) { if (typeof createProxy !== 'function') throw new TypeError('createProxy is required'); this.createProxy = createProxy; this.onProgress = onProgress; }
  async create(source, { width = 640, height = -2, crf = 28 } = {}) {
    if (!source?.source) throw new Error('A media source is required');
    this.onProgress({ state: 'starting', source: source.source });
    const proxy = await this.createProxy({ source: source.source, width, height, crf });
    if (!proxy?.path) throw new Error('Proxy creation returned no file');
    this.onProgress({ state: 'complete', path: proxy.path });
    return Object.freeze({ ...source, proxy: proxy.path });
  }
}
