export function projectVideoClips(project) {
  return (project?.tracks || []).filter(track => track.type === 'video').flatMap(track => track.clips || []).sort((a, b) => a.start - b.start);
}

export class PlaybackQueue {
  constructor(project) { this.project = project; this.index = -1; this.enabled = false; }
  refresh(project = this.project) { this.project = project; const clips = projectVideoClips(project); this.index = clips.findIndex(clip => clip.id === this.current?.id); return clips; }
  start(clipId = null) { const clips = this.refresh(); this.index = clipId ? clips.findIndex(clip => clip.id === clipId) : 0; this.enabled = this.index >= 0; return this.current; }
  get current() { return projectVideoClips(this.project)[this.index] || null; }
  next() { const clips = this.refresh(); if (!this.enabled || this.index + 1 >= clips.length) { this.enabled = false; return null; } this.index += 1; return clips[this.index]; }
  stop() { this.enabled = false; this.index = -1; }
}
