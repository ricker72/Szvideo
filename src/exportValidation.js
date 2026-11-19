const FORMATS = new Set(['mp4', 'webm']);
export function validateExportRequest({ input, output, format = 'mp4', duration, backend }) {
  if (!input || typeof input !== 'string') throw new Error('La fuente de exportación es obligatoria');
  if (!output || typeof output !== 'string') throw new Error('La ruta de salida es obligatoria');
  if (!FORMATS.has(format)) throw new Error(`Formato no compatible: ${format}`);
  if (!output.toLowerCase().endsWith(`.${format}`)) throw new Error('La extensión no coincide con el formato');
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('La duración del clip no es válida');
  if (backend !== 'ffmpeg') throw new Error('El backend FFmpeg no está disponible');
  return true;
}
