/** SzVideo — herramientas de privacidad de metadatos (EXIF/GPS/autoría en contenedores de vídeo). */

export const SUPPORTED_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'];

const PRIVACY_RULES = [
  { category: 'ubicación', patterns: ['gps', 'location', 'gpmd', 'com.apple.quicktime.location'] },
  { category: 'dispositivo', patterns: ['make', 'model', 'device', 'camera', 'com.apple.quicktime.mak'] },
  { category: 'autoría', patterns: ['artist', 'author', 'composer', 'lyricist', 'copyright', 'com.apple.quicktime.author'] },
  { category: 'software', patterns: ['encoder', 'software', 'handler_name', 'writing_library', 'writting_application', 'lavf'] },
];

/** Argumentos FFmpeg que eliminan TODO el metadato del contenedor sin recodificar (-c copy). */
export function buildCleanArgs({ input, output, stripStreams = true }) {
  if (!input || !output) throw new Error('Input and output are required');
  const args = '-hide_banner -loglevel error -i'.split(' ');
  args.push(input);
  // Descarta pistas de datos (p. ej. GPS/telemetría GoPro) y adjuntos si existen.
  args.push('-map', '0', '-map', '-0:d?', '-map', '-0:t?');
  // Borra los metadatos del archivo.
  args.push('-map_metadata', '-1');
  // Borra los metadatos de todas las pistas (el soporte varía según la versión de FFmpeg).
  if (stripStreams) args.push('-map_metadata:s', '-1');
  args.push('-map_chapters', '-1', '-c', 'copy', '-progress', 'pipe:1', '-nostats', '-y', output);
  return args;
}

function extensionOf(filePath) {
  const name = String(filePath).split(/[\\/]/).pop();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function suggestCleanOutput(sourcePath) {
  const source = String(sourcePath);
  const separator = Math.max(source.lastIndexOf('/'), source.lastIndexOf('\\'));
  const name = source.slice(separator + 1);
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return `${source.slice(0, separator + 1)}${base}-clean${ext ? `.${ext}` : '.mp4'}`;
}

export function validateCleanRequest({ input, output } = {}) {
  if (!input || !output) throw new Error('Se requiere una ruta de entrada y una de salida');
  const inputExt = extensionOf(input);
  const outputExt = extensionOf(output);
  if (!SUPPORTED_EXTENSIONS.includes(inputExt)) throw new Error(`Formato de entrada no soportado para limpiar metadatos: ${inputExt || 'desconocido'}`);
  if (!SUPPORTED_EXTENSIONS.includes(outputExt)) throw new Error(`Formato de salida no soportado: ${outputExt || 'desconocido'}`);
  if (input.replace(/\//g, '\\').toLowerCase() === output.replace(/\//g, '\\').toLowerCase()) throw new Error('La salida debe ser un archivo distinto del original');
  return true;
}

/** Extrae los bloques "Metadata:" del volcado de FFmpeg (`ffmpeg -i input` en stderr). */
export function parseMetadataBlocks(raw) {
  const blocks = [];
  if (!raw) return blocks;
  let block = null;
  let pendingScope = { kind: 'archivo' };
  for (const rawLine of String(raw).split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (/^Input #\d+/.test(trimmed)) {
      if (block) { blocks.push(block); block = null; }
      pendingScope = { kind: 'archivo' };
      continue;
    }
    const streamMatch = trimmed.match(/^(Stream #\d+:\d+)/);
    if (streamMatch) {
      if (block) { blocks.push(block); block = null; }
      pendingScope = { kind: 'pista', label: streamMatch[1].replace(/^Stream /, '') };
      continue;
    }
    if (trimmed === 'Metadata:') {
      if (block) blocks.push(block);
      block = { scope: { ...pendingScope }, entries: [] };
      continue;
    }
    if (!block) continue;
    if (/^(Duration|Side data|Chapters|Chapter #|Data |Attachment |Press |Stream #|Input #)/.test(trimmed) || !/^\s/.test(rawLine)) {
      blocks.push(block);
      block = null;
      continue;
    }
    const entryMatch = /^\s+([^:]+?)\s*:\s*(.*)$/.exec(rawLine);
    if (entryMatch) block.entries.push({ key: entryMatch[1].trim(), value: entryMatch[2].trim() });
  }
  if (block) blocks.push(block);
  return blocks;
}

/** Clasifica las etiquetas en categorías de riesgo de privacidad. */
export function summarizePrivacyTags(blocks) {
  const categories = { 'ubicación': [], 'dispositivo': [], 'autoría': [], 'software': [], 'otros': [] };
  let total = 0;
  for (const block of Array.isArray(blocks) ? blocks : []) {
    for (const { key, value } of block.entries) {
      const lower = key.toLowerCase();
      const rule = PRIVACY_RULES.find(candidate => candidate.patterns.some(pattern => lower.includes(pattern)));
      const entries = rule ? categories[rule.category] : categories.otros;
      const prefix = block.scope?.kind === 'pista' ? `${block.scope.label} · ` : '';
      entries.push(`${prefix}${key}: ${value}`);
      total += 1;
    }
  }
  const riesgo = categories['ubicación'].length ? 'alto' : categories['dispositivo'].length ? 'medio' : 'bajo';
  return { total, categories, riesgo };
}

/** Resumen legible para la interfaz. */
export function formatMetadataSummary(summary) {
  if (!summary) return 'Sin metadatos analizados.';
  if (!summary.total) return 'Sin etiquetas de privacidad: 0 metadatos · riesgo bajo.';
  const lines = [`Metadatos detectados: ${summary.total} · riesgo ${summary.riesgo}`];
  for (const [category, entries] of Object.entries(summary.categories)) {
    if (!entries.length) continue;
    lines.push(`— ${category} (${entries.length}):`);
    for (const entry of entries) lines.push(`  · ${entry}`);
  }
  return lines.join('\n');
}
