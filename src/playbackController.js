import { selectPlaybackSource } from './playbackSource.js';

import { localMediaUrl } from './localMediaUrl.js';

function toPlayableUrl(source) { return localMediaUrl(source); }
function sourceMatches(video, clip) {
  const selected = selectPlaybackSource(clip);
  return video.src === toPlayableUrl(selected) || decodeURI(video.src) === toPlayableUrl(selected);
}

export class PlaybackController {
  constructor({ video, commands }) { if (!video || !commands) throw new TypeError('Video and commands are required'); this.video = video; this.commands = commands; this.clip = null; }
  loadClip(clip) { this.clip = clip; this.video.src = toPlayableUrl(selectPlaybackSource(clip)); this.video.load(); return this.video.src; }
  adoptClip(clip) { this.clip = clip; return clip; }
  play() { if (!this.clip) throw new Error('No clip loaded'); if (this.video.currentTime < this.clip.in || this.video.currentTime >= this.clip.out) this.video.currentTime = this.clip.in; return this.video.play(); }
  pause() { this.video.pause(); return true; }
  stop() { this.video.pause(); this.video.currentTime = this.clip?.in || 0; return this.video.currentTime; }
  setVolume(value) { const volume = Math.min(Math.max(Number(value), 0), 1); this.video.volume = volume; if (volume > 0) this.video.muted = false; return volume; }
  setMuted(muted) { this.video.muted = Boolean(muted); return this.video.muted; }
  stepFrame(direction = 1, fps = this.clip?.fps || 30) { if (!this.clip) throw new Error('No clip loaded'); const frame = 1 / (Number(fps) > 0 ? Number(fps) : 30); this.video.pause(); this.video.currentTime = Math.min(Math.max(this.video.currentTime + (direction < 0 ? -frame : frame), this.clip.in), this.clip.out); return this.video.currentTime; }
  async selectClip(clip) {
    if (!clip || typeof clip.in !== 'number') throw new TypeError('A valid clip is required');
    const wasPlaying = !this.video.paused;
    this.video.pause();
    this.clip = clip;
    if (!sourceMatches(this.video, clip)) this.loadClip(clip);
    if (this.video.readyState < 1) {
      await new Promise((resolve, reject) => {
        const onMetadata = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error('No se pudo cargar la fuente del clip')); };
        const cleanup = () => { this.video.removeEventListener('loadedmetadata', onMetadata); this.video.removeEventListener('error', onError); };
        this.video.addEventListener('loadedmetadata', onMetadata, { once: true });
        this.video.addEventListener('error', onError, { once: true });
      });
    }
    this.video.currentTime = Math.max(0, clip.in);
    if (wasPlaying) await this.video.play();
    return this.video.currentTime;
  }
  async toggleProxy(enabled) {
    if (!this.clip) throw new Error('No clip loaded');
    const time = this.video.currentTime || 0; const wasPlaying = !this.video.paused;
    this.commands.setProxyEnabled('video-1', this.clip.id, enabled);
    this.clip = this.commands.project.findClip('video-1', this.clip.id);
    this.video.src = toPlayableUrl(selectPlaybackSource(this.clip));
    this.video.load();
    await new Promise(resolve => { const restore = () => { this.video.removeEventListener('loadedmetadata', restore); this.video.currentTime = Math.min(time, this.video.duration || time); resolve(); }; this.video.addEventListener('loadedmetadata', restore, { once: true }); });
    if (wasPlaying) await this.video.play();
    return this.video.src;
  }
}
