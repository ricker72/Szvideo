export class ErrorManager {
  constructor({ notify = () => {}, log = () => {} } = {}) { this.notify = notify; this.log = log; }
  report(error, context = 'operation') {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.log({ context, name: normalized.name, message: normalized.message, stack: normalized.stack, time: new Date().toISOString() });
    this.notify(`No se pudo completar ${context}: ${normalized.message}`);
    return normalized;
  }
  async run(operation, context) { try { return await operation(); } catch (error) { this.report(error, context); return null; } }
}
