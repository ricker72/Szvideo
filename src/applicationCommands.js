import { deserializeProject } from './projectStore.js';

export class ApplicationCommandManager {
  constructor({ projectCommands, projectStore, loadFile, saveFile }) {
    if (!projectCommands || !projectStore) throw new TypeError('Project commands and store are required');
    this.projectCommands = projectCommands; this.projectStore = projectStore; this.loadFile = loadFile; this.saveFile = saveFile;
  }
  async execute(command, payload) {
    switch (command) {
      case 'save': return this.projectStore.saveNow();
      case 'load': return this.load();
      case 'recover': return this.recover(payload);
      case 'undo': return this.projectCommands.undo();
      case 'redo': return this.projectCommands.redo();
      default: throw new Error(`Unknown application command: ${command}`);
    }
  }
  async load() {
    const loaded = await this.loadFile();
    if (!loaded) return null;
    const project = deserializeProject(loaded.content);
    this.projectStore.setProject(project); this.projectCommands.replaceProject(project);
    return project;
  }
  recover(content) {
    const project = deserializeProject(content);
    this.projectStore.setProject(project); this.projectCommands.replaceProject(project);
    return project;
  }
}
