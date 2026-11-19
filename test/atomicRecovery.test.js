import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { writeFileAtomic, recoverAtomicFile, cleanupAtomicFiles } = require('../electron/atomicFile.cjs');

test('atomic recovery write replaces the destination only after the temporary write succeeds', async () => {
  const writes = new Map([['recovery.szvideo', 'old']]);
  const fsStub = {
    writeFile: async (filePath, content) => writes.set(filePath, content),
    rename: async (temporaryPath, destination) => { writes.set(destination, writes.get(temporaryPath)); writes.delete(temporaryPath); },
    unlink: async filePath => writes.delete(filePath)
  };
  await writeFileAtomic('recovery.szvideo', 'new', fsStub);
  assert.equal(writes.get('recovery.szvideo'), 'new');
  assert.equal([...writes.keys()].some(key => key.endsWith('.tmp')), false);
});

test('failed atomic recovery write preserves the existing destination and cleans the temporary file', async () => {
  const writes = new Map([['recovery.szvideo', 'old']]);
  const fsStub = {
    writeFile: async (filePath, content) => { writes.set(filePath, content); throw new Error('disk full'); },
    rename: async () => { throw new Error('must not rename'); },
    unlink: async filePath => writes.delete(filePath)
  };
  await assert.rejects(() => writeFileAtomic('recovery.szvideo', 'new', fsStub), /disk full/);
  assert.equal(writes.get('recovery.szvideo'), 'old');
  assert.equal([...writes.keys()].some(key => key.endsWith('.tmp')), false);
});

test('atomic project recovery promotes a temporary file only when the destination is missing', async () => {
  // Use platform-native paths so path.dirname / path.join work on Linux CI and Windows.
  const destination = path.join('temp', 'project.szvideo');
  const temporaryName = '.project.szvideo.1.2.tmp';
  const temporary = path.join('temp', temporaryName);
  const writes = new Map([[temporary, 'new']]);
  const fsStub = {
    access: async filePath => { if (writes.has(filePath)) return true; throw new Error('missing'); },
    readdir: async () => [temporaryName],
    rename: async (temporaryPath, dest) => { writes.set(dest, writes.get(temporaryPath)); writes.delete(temporaryPath); }
  };
  assert.equal(await recoverAtomicFile(destination, fsStub), true);
  assert.equal(writes.get(destination), 'new');
  assert.equal(await recoverAtomicFile(destination, { ...fsStub, access: async () => true }), false);
});

test('atomic cleanup removes only old temporary files', async () => {
  const now = 20_000;
  const destination = path.join('temp', 'project.szvideo');
  const files = new Map([
    ['.project.szvideo.old.tmp', { mtimeMs: 1, content: 'old' }],
    ['.project.szvideo.recent.tmp', { mtimeMs: 19_500, content: 'recent' }],
    ['project.szvideo', { mtimeMs: 1, content: 'project' }]
  ]);
  const fsStub = {
    readdir: async () => [...files.keys()].map(name => ({ name, isFile: () => true })),
    stat: async filePath => files.get(path.basename(filePath)),
    unlink: async filePath => files.delete(path.basename(filePath))
  };
  assert.equal(await cleanupAtomicFiles(destination, 1_000, fsStub, now), 1);
  assert.equal(files.has('.project.szvideo.old.tmp'), false);
  assert.equal(files.has('.project.szvideo.recent.tmp'), true);
  assert.equal(files.has('project.szvideo'), true);
});
