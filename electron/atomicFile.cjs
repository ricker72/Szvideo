const path = require('path');
const fs = require('fs');

async function writeFileAtomic(filePath, content, fsPromises = require('fs').promises) {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fsPromises.writeFile(temporaryPath, content, 'utf8');
    await fsPromises.rename(temporaryPath, filePath);
    return filePath;
  } catch (error) {
    try { await fsPromises.unlink(temporaryPath); } catch {}
    throw error;
  }
}

async function recoverAtomicFile(filePath, fsPromises = fs.promises) {
  try { await fsPromises.access(filePath); return false; } catch {}
  const directory = path.dirname(filePath);
  const prefix = `.${path.basename(filePath)}.`;
  const entries = await fsPromises.readdir(directory);
  const candidates = entries.filter(name => name.startsWith(prefix) && name.endsWith('.tmp')).sort().reverse();
  if (!candidates.length) return false;
  await fsPromises.rename(path.join(directory, candidates[0]), filePath);
  return true;
}

async function cleanupAtomicFiles(filePath, maxAgeMs = 7 * 24 * 60 * 60 * 1000, fsPromises = fs.promises, now = Date.now()) {
  const directory = path.dirname(filePath);
  const prefix = `.${path.basename(filePath)}.`;
  const entries = await fsPromises.readdir(directory, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith('.tmp')) continue;
    const candidate = path.join(directory, entry.name);
    const stats = await fsPromises.stat(candidate);
    if (now - stats.mtimeMs <= maxAgeMs) continue;
    await fsPromises.unlink(candidate);
    removed += 1;
  }
  return removed;
}

module.exports = { writeFileAtomic, recoverAtomicFile, cleanupAtomicFiles };
