/**
 * SzVideo Exporter — ffmpeg.wasm powered video export.
 *
 * Uses @ffmpeg/ffmpeg (ffmpeg.wasm) loaded via CDN to encode video
 * in the browser with the protective layer applied frame-by-frame.
 *
 * Pipeline:
 *   1. Extract frames from source video at target FPS
 *   2. Apply protective layer (via Protector.processFrame)
 *   3. Write frames as PNG sequence to ffmpeg MEMFS
 *   4. Run ffmpeg to encode MP4/WebM
 *   5. Read output blob from MEMFS
 */

export const Exporter = (() => {
  const { createFFmpeg, fetchFile } = window.ffmpeg || {};

  if (!createFFmpeg) {
    console.warn('[SzVideo] ffmpeg.wasm not loaded. Export will fall back to MediaRecorder.');
  }

  // ffmpeg instance (lazy-initialized)
  let ffmpegInstance = null;

  async function getFFmpeg() {
    if (!createFFmpeg) throw new Error('ffmpeg.wasm not available');
    if (!ffmpegInstance) {
      ffmpegInstance = createFFmpeg({ log: true });
      await ffmpegInstance.load();
    }
    return ffmpegInstance;
  }

  /**
   * Draw video frame at a given timestamp to canvas, apply protective layer.
   */
  async function captureFrame(videoEl, canvas, ctx, timeSec, opts = {}) {
    videoEl.currentTime = timeSec;
    await new Promise((resolve) => {
      const onSeek = () => {
        videoEl.removeEventListener('seeked', onSeek);
        resolve();
      };
      if (videoEl.seekable && videoEl.seekable.length > 0) {
        videoEl.addEventListener('seeked', onSeek);
      } else {
        setTimeout(onSeek, 50);
      }
    });

    ctx.drawImage(videoEl, 0, 0);

    // Apply protective layer if enabled
    Protector.processFrame(canvas, { mark: opts.mark !== false, markText: opts.markText || '© SzVideo' });

    return canvas;
  }

  /**
   * Convert canvas to PNG Uint8Array.
   */
  async function canvasToPNGBytes(canvas) {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(new Uint8Array(reader.result));
        reader.readAsArrayBuffer(blob);
      }, 'image/png');
    });
  }

  /**
   * Full export: extract frames -> apply protection -> ffmpeg encode -> blob.
   */
  async function exportVideo(
    videoEl,
    options = {}
  ) {
    const {
      format = 'mp4',
      fps = 24,
      maxSize = 1280,
      mark = true,
      markText = '© SzVideo',
    } = options;

    if (!createFFmpeg) {
      throw new Error('ffmpeg.wasm is required for export. Load https://unpkg.com/@ffmpeg/ffmpeg@0.12.9/dist/ffmpeg.min.js');
    }

    const ffmpeg = await getFFmpeg();

    // Setup canvas for frame extraction
    const canvas = document.createElement('canvas');
    let w = videoEl.videoWidth;
    let h = videoEl.videoHeight;
    if (Math.max(w, h) > maxSize) {
      const scale = maxSize / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    const duration = videoEl.duration;
    const totalFrames = Math.max(1, Math.floor(duration * fps));
    const frameInterval = duration / totalFrames;

    console.log(`[SzVideo] Exporting ${totalFrames} frames @ ${fps}fps, ${w}x${h}`);

    // Write frames to MEMFS as PNG sequence
    for (let i = 0; i < totalFrames; i++) {
      const timeSec = i * frameInterval;
      await captureFrame(videoEl, canvas, ctx, timeSec, { mark, markText });
      const pngBytes = await canvasToPNGBytes(canvas);
      const frameName = `frame_${String(i).padStart(5, '0')}.png`;
      ffmpeg.FS('writeFile', frameName, pngBytes);

      if (i % 10 === 0 || i === totalFrames - 1) {
        console.log(`[SzVideo] Frame ${i + 1}/${totalFrames}`);
      }
    }

    // Build ffmpeg command
    const inputPattern = 'frame_%05d.png';
    const outputName = `output.${format === 'webm' ? 'webm' : 'mp4'}`;
    const codec = format === 'webm' ? 'libvpx-vp9' : 'libx264';
    const pixFmt = format === 'webm' ? 'yuv420p' : 'yuv420p';

    const args = [
      '-framerate', String(fps),
      '-i', inputPattern,
      '-c:v', codec,
      '-preset', 'medium',
      '-crf', '23',
      '-pix_fmt', pixFmt,
      '-movflags', '+faststart',
      '-y',
      outputName,
    ];

    console.log('[SzVideo] Running ffmpeg:', args.join(' '));
    await ffmpeg.run(...args);

    // Read output from MEMFS
    const data = ffmpeg.FS('readFile', outputName);
    const blob = new Blob([data], { type: format === 'webm' ? 'video/webm' : 'video/mp4' });

    // Cleanup MEMFS
    ffmpeg.FS('unlink', outputName);
    for (let i = 0; i < totalFrames; i++) {
      ffmpeg.FS('unlink', `frame_${String(i).padStart(5, '0')}.png`);
    }

    console.log('[SzVideo] Export complete:', blob.size, 'bytes');
    return blob;
  }

  /**
   * High-level exporter factory bound to a video element.
   */
  async function createExporter(videoEl) {
    return {
      async export({
        format = 'mp4',
        fps = 24,
        maxSize = 1280,
        obfuscateMetadata = true,
        mark = true,
        markText = '© SzVideo',
      } = {}) {
        return await exportVideo(videoEl, {
          format,
          fps,
          maxSize,
          mark,
          markText,
        });
      },
    };
  }

  return {
    exportVideo,
    createExporter,
  };
})();
