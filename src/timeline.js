/** SzVideo native, non-destructive timeline model. */
export class TimelineProject {
  constructor({ name = 'Untitled SzVideo project', fps = 30 } = {}) {
    this.schema = 'szvideo-project/v1';
    this.name = name;
    this.fps = fps;
    this.tracks = [{ id: 'video-1', type: 'video', clips: [] }, { id: 'audio-1', type: 'audio', clips: [] }];
    this.markers = [];
    this.history = [];
    this.future = [];
  }

  snapshot() { return JSON.parse(JSON.stringify({ name: this.name, fps: this.fps, tracks: this.tracks, markers: this.markers })); }
  validate() {
    if (typeof this.name !== 'string' || !this.name.trim()) throw new Error('Project name must be a non-empty string');
    if (!Number.isFinite(this.fps) || this.fps <= 0 || this.fps > 240) throw new Error('Project FPS must be between 0 and 240');
    if (!Array.isArray(this.tracks) || !this.tracks.length) throw new Error('Project must contain at least one track');
    for (const track of this.tracks) {
      if (!track.id || !['video', 'audio'].includes(track.type) || !Array.isArray(track.clips)) throw new Error('Invalid track');
      for (const clip of track.clips) {
        if (!clip.id || typeof clip.source !== 'string' || !clip.source.trim()) throw new Error('Invalid clip source');
        if (![clip.start, clip.in, clip.out, clip.duration].every(Number.isFinite) || clip.start < 0 || clip.in < 0 || clip.out < clip.in || clip.out > clip.duration) throw new Error('Invalid clip time range');
      }
    }
    if (!Array.isArray(this.markers) || this.markers.some(marker => !Number.isFinite(marker.time) || marker.time < 0)) throw new Error('Invalid marker');
    return true;
  }
  commit() { this.history.push(this.snapshot()); this.future = []; }
  undo() { if (!this.history.length) return false; this.future.push(this.snapshot()); Object.assign(this, this.history.pop()); return true; }
  redo() { if (!this.future.length) return false; this.history.push(this.snapshot()); Object.assign(this, this.future.pop()); return true; }
  addClip(trackId, clip) {
    const track = this.tracks.find(item => item.id === trackId);
    if (!track) throw new Error(`Unknown track: ${trackId}`);
    this.commit();
    const duration = Math.max(0, Number(clip.duration || 0));
    if (!clip.source || !Number.isFinite(duration) || duration <= 0) throw new Error('A clip requires a source and a positive duration');
    const start = Number(clip.start || 0), input = Number(clip.in || 0), output = Number(clip.out || duration);
    if (start < 0 || input < 0 || output <= input || output > duration) throw new Error('Clip time range is outside its duration');
    track.clips.push({ id: clip.id || crypto.randomUUID(), source: clip.source, name: clip.name || null, size: Number.isFinite(clip.size) ? clip.size : null, tags: Array.isArray(clip.tags) ? [...clip.tags] : [], proxy: clip.proxy || null, useProxy: Boolean(clip.useProxy), addedAt: clip.addedAt || new Date().toISOString(), start, in: input, out: output, duration, effects: [], keyframes: [] });
    track.clips.sort((a, b) => a.start - b.start);
    return track.clips.at(-1);
  }
  trimClip(trackId, clipId, start, end) {
    const clip = this.findClip(trackId, clipId); if (!clip) return false;
    const nextIn = Number(start), nextOut = Number(end);
    if (!Number.isFinite(nextIn) || !Number.isFinite(nextOut) || nextIn < 0 || nextOut <= nextIn || nextOut > clip.duration) return false;
    this.commit(); clip.in = nextIn; clip.out = nextOut; return true;
  }
  splitClip(trackId, clipId, at) {
    const track = this.tracks.find(item => item.id === trackId); const index = track?.clips.findIndex(item => item.id === clipId); if (!track || index < 0) return false;
    const clip = track.clips[index]; const point = Number(at); if (point <= clip.in || point >= clip.out) return false;
    this.commit(); const right = { ...clip, id: crypto.randomUUID(), start: clip.start + point - clip.in, in: point }; clip.out = point; track.clips.splice(index + 1, 0, right); return true;
  }
  addMarker(time, label = '') { this.commit(); this.markers.push({ id: crypto.randomUUID(), time: Number(time), label }); this.markers.sort((a, b) => a.time - b.time); }
  updateMarker(markerId, time, label = '') { const marker = this.markers.find(item => item.id === markerId); if (!marker) return false; const nextTime = Number(time); if (!Number.isFinite(nextTime) || nextTime < 0) return false; this.commit(); marker.time = nextTime; marker.label = String(label); this.markers.sort((a, b) => a.time - b.time); return true; }
  removeMarker(markerId) { const index = this.markers.findIndex(item => item.id === markerId); if (index < 0) return false; this.commit(); this.markers.splice(index, 1); return true; }
  findClip(trackId, clipId) { return this.tracks.find(item => item.id === trackId)?.clips.find(item => item.id === clipId); }
  toJSON() { this.validate(); return JSON.stringify({ schema: this.schema, name: this.name, fps: this.fps, tracks: this.tracks, markers: this.markers }, null, 2); }
  static fromJSON(value) {
    const document = typeof value === 'string' ? JSON.parse(value) : value;
    if (!document || document.schema !== 'szvideo-project/v1') throw new Error('Unsupported project schema');
    const project = new TimelineProject({ name: document.name, fps: document.fps });
    project.tracks = document.tracks;
    project.markers = document.markers || [];
    project.validate();
    return project;
  }
}
