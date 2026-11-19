/** Video provenance and similarity analysis utilities. */
export const VideoAnalyzer = (() => {
  function averageHash(imageData, size = 8) {
    const { width, height, data } = imageData;
    const samples = [];
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const px = Math.min(width - 1, Math.floor((x + 0.5) * width / size));
      const py = Math.min(height - 1, Math.floor((y + 0.5) * height / size));
      const i = (py * width + px) * 4;
      samples.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    return samples.map(value => value >= mean ? '1' : '0').join('');
  }
  function colorHistogram(imageData, bins = 16) {
    const histogram = new Float32Array(bins);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const r = imageData.data[i] / 255, g = imageData.data[i + 1] / 255, b = imageData.data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max === min) continue;
      const delta = max - min;
      let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
      if (hue < 0) hue += 6;
      histogram[Math.min(bins - 1, Math.floor((hue * 60) / (360 / bins)))] += 1;
    }
    const total = histogram.reduce((sum, value) => sum + value, 0) || 1;
    return Array.from(histogram, value => Number((value / total).toFixed(5)));
  }
  function hammingDistance(a, b) {
    if (a.length !== b.length) return null;
    return [...a].reduce((distance, bit, index) => distance + (bit !== b[index] ? 1 : 0), 0);
  }
  function analyzeFrame(video, canvas, frameIndex = 0) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    video.currentTime = Math.min(video.duration || 0, frameIndex / 30);
    return new Promise((resolve, reject) => {
      const draw = () => { try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height); resolve({ frameIndex, time: video.currentTime, hash: averageHash(imageData), histogram: colorHistogram(imageData) }); } catch (error) { reject(error); } };
      if (video.readyState >= 2) draw(); else video.addEventListener('loadeddata', draw, { once: true });
    });
  }
  return { averageHash, colorHistogram, hammingDistance, analyzeFrame };
})();
