import { ProjectCommandManager } from './projectCommands.js';
import { TimelineProject } from './timeline.js';

export function connectCommandPersistence(project, { store, setDirty = () => {}, writeRecovery = async () => {} } = {}) {
  if (!(project instanceof TimelineProject)) throw new TypeError('Expected a TimelineProject');
  if (!store || typeof store.markDirty !== 'function') throw new TypeError('A project store is required');
  return new ProjectCommandManager(project, { onChange: change => {
    if (!change.dirty) return;
    store.markDirty(); setDirty(true); writeRecovery(project.toJSON()).catch(() => {});
  } });
}
