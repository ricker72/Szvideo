/** SzVideo authenticity layer. */
export const Protector = (() => {
  const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
  function drawProvenanceMark(ctx, width, height, text = '© SzVideo') {
    ctx.save();
    const fontSize = Math.max(14, Math.round(width * 0.018));
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textBaseline = 'bottom';
    const padding = Math.max(8, Math.round(fontSize * 0.6));
    const metrics = ctx.measureText(text);
    const x = width - metrics.width - padding;
    const y = height - padding;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(x - padding / 2, y - fontSize - padding / 3, metrics.width + padding, fontSize + padding / 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillText(text, x, y);
    ctx.restore();
  }
  function processFrame(frameCanvas, options = {}) {
    const ctx = frameCanvas.getContext('2d');
    if (options.mark !== false) drawProvenanceMark(ctx, frameCanvas.width, frameCanvas.height, options.markText || '© SzVideo');
    return frameCanvas;
  }
  function buildExportConfig(width, height, format = 'mp4', metadata = {}) {
    return { width, height, format, codec: format === 'mp4' ? 'libx264' : 'libvpx-vp9', quality: 18, preset: 'medium', metadata: { title: metadata.title || 'SzVideo export', author: metadata.author || '', copyright: metadata.copyright || 'All rights reserved', provenance: metadata.provenance || 'Created with SzVideo' } };
  }
  return { processFrame, drawProvenanceMark, buildExportConfig, clamp };
})();
