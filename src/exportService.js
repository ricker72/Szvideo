export class ExportService {
  constructor({ mediaBackend, ffmpegExport }) { this.mediaBackend = mediaBackend; this.ffmpegExport = ffmpegExport; }
  playbackBackend() { return this.mediaBackend.playback; }
  async exportClip(clip, options = {}) {
    if (!clip?.source) throw new Error('A clip source is required');
    if (this.mediaBackend.export !== 'ffmpeg') throw new Error('FFmpeg is not configured for export');
    validateExportRequest({ input: clip.source, output: options.output, format: options.format || 'mp4', duration: clip.duration, backend: this.mediaBackend.export });
    return this.ffmpegExport({ jobId: options.jobId, input: clip.source, output: options.output, format: options.format || 'mp4', duration: clip.duration, crf: options.crf ?? 18 });
  }
}
import { validateExportRequest } from './exportValidation.js';
