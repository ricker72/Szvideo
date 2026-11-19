import test from 'node:test';
import assert from 'node:assert/strict';
import { ExportService } from '../src/exportService.js';

test('uses explicit FFmpeg backend for export', async () => {
  let request;
  const service = new ExportService({ mediaBackend: { playback: 'html-media', export: 'ffmpeg' }, ffmpegExport: async options => { request = options; return { path: options.output }; } });
  assert.equal(service.playbackBackend(), 'html-media');
  await service.exportClip({ source: 'original.mp4', duration: 12 }, { output: 'export.mp4' });
  assert.equal(request.input, 'original.mp4'); assert.equal(request.output, 'export.mp4');
});

test('does not silently fall back when FFmpeg is unavailable', async () => {
  const service = new ExportService({ mediaBackend: { playback: 'html-media', export: 'unavailable' }, ffmpegExport: async () => ({}) });
  await assert.rejects(() => service.exportClip({ source: 'video.mp4', duration: 2 }), /not configured/);
});
