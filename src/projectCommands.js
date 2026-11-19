import { TimelineProject } from './timeline.js';

export class ProjectCommandManager {
  constructor(project, { onChange = () => {} } = {}) {
    if (!(project instanceof TimelineProject)) throw new TypeError('Expected a TimelineProject');
    this.project = project; this.onChange = onChange; this.undoStack = []; this.redoStack = [];
  }
  execute(name, mutate) {
    const before = this.project.snapshot();
    const result = mutate(this.project);
    this.project.validate();
    const after = this.project.snapshot();
    this.undoStack.push({ name, before, after }); this.redoStack = []; this.onChange({ type: 'execute', name, dirty: true });
    return result;
  }
  undo() {
    const command = this.undoStack.pop(); if (!command) return false;
    Object.assign(this.project, command.before); this.project.validate(); this.redoStack.push(command); this.onChange({ type: 'undo', name: command.name, dirty: true }); return true;
  }
  redo() {
    const command = this.redoStack.pop(); if (!command) return false;
    Object.assign(this.project, command.after); this.project.validate(); this.undoStack.push(command); this.onChange({ type: 'redo', name: command.name, dirty: true }); return true;
  }
  replaceProject(project) {
    if (!(project instanceof TimelineProject)) throw new TypeError('Expected a TimelineProject');
    project.validate();
    this.project.name = project.name; this.project.fps = project.fps; this.project.tracks = project.tracks; this.project.markers = project.markers;
    this.undoStack = []; this.redoStack = [];
    this.onChange({ type: 'replace', name: 'load project', dirty: false });
    return this.project;
  }
  addClip(trackId, clip) { return this.execute('add clip', project => project.addClip(trackId, clip)); }
  relinkClip(trackId, clipId, source) { return this.execute('relink clip', project => { const clip = project.findClip(trackId, clipId); if (!clip || typeof source !== 'string' || !source.trim()) throw new Error('A clip and media source are required'); clip.source = source; return clip; }); }
  setClipTag(trackId, clipId, tag, enabled = true) { return this.execute('set clip tag', project => { const clip = project.findClip(trackId, clipId); const clean = String(tag || '').trim(); if (!clip || !clean) throw new Error('A clip and tag are required'); clip.tags = Array.isArray(clip.tags) ? clip.tags : []; clip.tags = enabled ? [...new Set([...clip.tags, clean])] : clip.tags.filter(item => item !== clean); return clip.tags; }); }
  trimClip(trackId, clipId, start, end) { return this.execute('trim clip', project => { if (!project.trimClip(trackId, clipId, start, end)) throw new Error('Invalid trim range'); return true; }); }
  splitClip(trackId, clipId, at) { return this.execute('split clip', project => { if (!project.splitClip(trackId, clipId, at)) throw new Error('Invalid split position'); return true; }); }
  addMarker(time, label = '') { return this.execute('add marker', project => project.addMarker(time, label)); }
  updateMarker(markerId, time, label = '') { return this.execute('update marker', project => { if (!project.updateMarker(markerId, time, label)) throw new Error('Invalid marker'); return true; }); }
  removeMarker(markerId) { return this.execute('remove marker', project => { if (!project.removeMarker(markerId)) throw new Error('Marker not found'); return true; }); }
  setClipProxy(trackId, clipId, proxyPath) { return this.execute('set clip proxy', project => { const clip = project.findClip(trackId, clipId); if (!clip || !proxyPath) throw new Error('A clip and proxy path are required'); clip.proxy = proxyPath; clip.useProxy = true; return clip; }); }
  setProxyEnabled(trackId, clipId, enabled) { return this.execute('toggle clip proxy', project => { const clip = project.findClip(trackId, clipId); if (!clip || (enabled && !clip.proxy)) throw new Error('Clip has no proxy'); clip.useProxy = Boolean(enabled); return clip.useProxy; }); }
}
