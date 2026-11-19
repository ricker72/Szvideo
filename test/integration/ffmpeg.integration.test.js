import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function ffmpegPath() {
  const configured = process.env.SZVIDEO_FFMPEG;
  if (configured && spawnSync(configured, ['-version'], { windowsHide: true }).status === 0) return configured;
  const fallback = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  return spawnSync(fallback, ['-version'], { windowsHide: true }).status === 0 ? fallback : null;
}

const executable = ffmpegPath();
test('real FFmpeg proxy and export pipeline', { skip: executable ? false : 'FFmpeg is not configured or available' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'szvideo-ffmpeg-'));
  try {
    const input = join(root, 'input.mp4'); const proxy = join(root, 'proxy.mp4'); const output = join(root, 'output.mp4');
    execFileSync(executable, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', input], { windowsHide: true });
    execFileSync(executable, ['-hide_banner', '-loglevel', 'error', '-i', input, '-vf', 'scale=160:-2', '-c:v', 'libx264', '-crf', '30', '-an', '-y', proxy], { windowsHide: true });
    execFileSync(executable, ['-hide_banner', '-loglevel', 'error', '-i', proxy, '-c:v', 'libx264', '-crf', '24', '-y', output], { windowsHide: true });
    assert.ok(existsSync(input) && statSync(input).size > 0);
    assert.ok(existsSync(proxy) && statSync(proxy).size > 0);
    assert.ok(existsSync(output) && statSync(output).size > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
