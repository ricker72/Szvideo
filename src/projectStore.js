import { TimelineProject } from './timeline.js';

export const PROJECT_EXTENSION = 'szvideo';

export function serializeProject(project) {
  if (!(project instanceof TimelineProject)) throw new TypeError('Expected a TimelineProject');
  project.validate();
  return project.toJSON();
}

export function deserializeProject(value) {
  return TimelineProject.fromJSON(value);
}

export class ProjectStore {
  constructor({ save, load, intervalMs = 30000 } = {}) {
    if (typeof save !== 'function' || typeof load !== 'function') throw new TypeError('ProjectStore requires save and load functions');
    this.save = save; this.load = load; this.intervalMs = intervalMs; this.timer = null; this.dirty = false; this.project = null; this.path = null;
  }
  setProject(project) { project.validate(); this.project = project; this.dirty = false; return project; }
  markDirty() { if (!this.project) throw new Error('No project loaded'); this.dirty = true; }
  async saveNow() {
    if (!this.project) throw new Error('No project loaded');
    const content = serializeProject(this.project);
    const result = await this.save(content, this.path);
    if (result) this.path = typeof result === 'string' ? result : result.path || this.path;
    if (result) this.dirty = false;
    return result;
  }
  async loadProject(source) { const loaded = await this.load(source); const project = deserializeProject(loaded.content ?? loaded); this.setProject(project); this.path = loaded.path || source || null; return project; }
  startAutoSave() { this.stopAutoSave(); this.timer = setInterval(() => { if (this.dirty && this.path) this.saveNow().catch(() => {}); }, this.intervalMs); return this.timer; }
  stopAutoSave() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
