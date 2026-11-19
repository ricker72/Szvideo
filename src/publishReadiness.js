/** SzVideo — Chequeo previo a publicar en TikTok («Salud de publicación»).
 *  El estado «Solo yo» lo decide la moderación SERVIDORA de TikTok tras la subida:
 *  ningún parche de contenedor lo evita. Lo que sí reduce el riesgo es subir un
 *  archivo técnicamente limpio y con contenido conforme. Este módulo evalúa de forma
 *  determinista los factores que el propio TikTok documenta (música con copyright,
 *  subtítulos/hashtags, control de audiencia, señales de manipulación) y genera un
 *  informe accionable ANTES de publicar. No evasión de moderación: prevención honesta. */

export const AUDIO_SOURCES = ['propia', 'tiktok', 'libre', 'comercial'];

const AUDIO_SOURCE_RISK = {
  propia: { penalty: 0, label: 'Audio propio o sin música' },
  tiktok: { penalty: 0, label: 'Biblioteca con licencia de TikTok' },
  libre: { penalty: 4, label: 'Música libre de derechos externa' },
  comercial: { penalty: 45, label: 'Música/efectos comerciales con copyright' },
};

/** Ítems de verificación con la guía oficial que el propio TikTok recomienda seguir. */
export const CHECK_ITEMS = [
  { id: 'notificaciones', label: 'Revisé la bandeja de notificaciones de TikTok', guidance: 'Perfil → Actividad: si hubo un strike previo, el siguiente vídeo arranca en revisión. Resuélvela antes de subir.' },
  { id: 'audiencia', label: 'Verifiqué el control de audiencia (sin restricción +18 por error)', guidance: 'Al publicar, «Control de audiencia» debe estar en «No» para 18+. Un ajuste heredado de un vídeo anterior manda el nuevo a Solo yo.' },
  { id: 'etiqueta-ia', label: 'Marqué «Contenido generado con IA» en TikTok Studio', guidance: 'POLÍTICA OBLIGATORIA de TikTok: el contenido sintético realista SIN etiqueta se elimina sin apelación clara. Si tus dramas/series son generados o doblados con IA y no los etiquetas, la retirada no es por copyright: es por esto.' },
  { id: 'fingerprint-original', label: 'El episodio evita colisionar con catálogos de huellas (voz e intro propias)', guidance: 'El matching de copyright compara huellas audiovisuales: las voces sintéticas de los mismos proveedores, tropes y música stock chocan con catálogos de otras plataformas (los «enlaces» que ves). Usa narración/voz propias, intro y cierre distintivos por episodio y música no stock.' },
  { id: 'no-resubida', label: 'No re-subí tal cual un vídeo ya retirado', guidance: 'Re-subir contenido eliminado multiplica los strikes. Si crees que fue un error, usa la apelación desde el aviso (TikTok Studio → el vídeo → Estado → Apelar). Si re-subes, cambia título, portada y las primeras escenas.' },
  { id: 'subtitulos', label: 'Los subtítulos/textos en pantalla no tienen palabras sensibles', guidance: 'La IA de revisión hace OCR y transcribe el audio: groserías, marcas, drogas o cifras engañosas disparan la revisión manual.' },
  { id: 'hashtags', label: 'Los hashtags y la descripción son coherentes con el contenido', guidance: 'Hashtags que no coinciden con el vídeo (bait) o spam de tendencias son señal clásica de límite de difusión.' },
  { id: 'cache', label: 'Limpié la caché de la app antes de subir', guidance: 'Ajustes y privacidad → Liberar espacio → Caché. Evita estados de UI atascados que dejan la privacidad mal configurada.' },
];

export const HEAVY_OBFUSCATION_MODES = ['dct', 'espacial', 'croma', 'temporal'];

export function normalizeAnswers({ audioSource = 'propia', checks = [], heavyObfuscation = false, noblurApplied = false, metadataClean = true } = {}) {
  return {
    audioSource: AUDIO_SOURCES.includes(audioSource) ? audioSource : 'propia',
    checks: CHECK_ITEMS.filter(item => (Array.isArray(checks) ? checks : []).includes(item.id)).map(item => item.id),
    heavyObfuscation: Boolean(heavyObfuscation),
    noblurApplied: Boolean(noblurApplied),
    metadataClean: Boolean(metadataClean),
  };
}

/** Evaluación determinista de riesgo de terminarse en «Solo yo» o revisión. */
export function assessPublishReadiness(input = {}) {
  const { audioSource, checks, heavyObfuscation, noblurApplied, metadataClean } = normalizeAnswers(input);
  const risks = [];
  const recommendations = [];
  let score = 100;

  // 1. Copyright de audio: la causa nº 1 documentada de «Solo yo» automático.
  const audio = AUDIO_SOURCE_RISK[audioSource];
  score -= audio.penalty;
  if (audioSource === 'comercial') {
    risks.push({ id: 'copyright-audio', severity: 'alta', detail: 'Música o efectos comerciales detectados: causa más común de restricción automática a «Solo yo».' });
    recommendations.push('Cambia el audio por una pista de la biblioteca con licencia de TikTok (se elige DENTRO de la app al publicar) o música propia/libre.');
  } else if (audioSource === 'libre') {
    recommendations.push('La música libre externa puede activar la huella de audio si es una versión re-subida de una pista registrada: preferible tomarla desde la biblioteca de TikTok.');
  }

  // 2. Ítems de verificación no marcados.
  for (const item of CHECK_ITEMS) {
    if (!checks.includes(item.id)) {
      score -= 8;
      risks.push({ id: item.id, severity: 'media', detail: `Sin verificar: ${item.label}. ${item.guidance}` });
    }
  }

  // 3. Ofuscación agresiva: los clasificadores de manipulación la detectan y suben la prioridad de revisión.
  if (heavyObfuscation) {
    score -= 15;
    risks.push({ id: 'obfuscacion-agresiva', severity: 'alta', detail: 'Este archivo lleva ofuscación avanzada (ruido DCT/espacial o desplazamiento de croma). Los detectores de manipulación marcan ruido artificial intensivo como señal de re-subección.' });
    recommendations.push('Para publicar usa la versión NoBlur sin re-encode (calidad 100 %) o la original limpia: la nitidez natural es la que menos revisión genera. Reserva la ofuscación avanzada para pruebas forenses.');
  }

  // 4. Metadatos: los archivos con metadatos de otro editor/herramienta pueden heredar huellas.
  if (!metadataClean) {
    score -= 10;
    risks.push({ id: 'metadatos', severity: 'media', detail: 'Los metadatos originales siguen presentes: pueden incluir identificadores de la herramienta o del material fuente.' });
    recommendations.push('Aplica la limpieza de metadatos de SzVideo (pestaña Protección de autoría) antes de subir.');
  }

  // 5. NoBlur: técnica legítima de conservación de calidad — factor positivo.
  if (noblurApplied && !heavyObfuscation) {
    recommendations.push('El contenedor inflado sin re-encode conserva la calidad exacta del original: es la variante con mejor historial de procesamiento limpio.');
  }

  const scoreFinal = Math.max(0, Math.min(100, Math.round(score)));
  const level = scoreFinal >= 85 ? 'bajo' : scoreFinal >= 60 ? 'medio' : 'alto';
  return { score: scoreFinal, level, risks, recommendations, audioSource, checks };
}

/** Informe legible en español para el expediente y para el usuario. */
export function buildReadinessReport(assessment, { mediaName = 'vídeo', mediaInfo = null } = {}) {
  const lines = [
    `SALUD DE PUBLICACIÓN — ${mediaName}`,
    `Riesgo de terminar en «Solo yo» o revisión: ${assessment.level.toUpperCase()} (${assessment.score}/100)`,
    `Audio: ${AUDIO_SOURCE_RISK[assessment.audioSource].label}`,
  ];
  if (mediaInfo) {
    lines.push(`Archivo: ${mediaInfo.duration ? `${mediaInfo.duration.toFixed(1)} s` : 'duración desconocida'}${mediaInfo.size ? ` · ${(mediaInfo.size / 1048576).toFixed(2)} MB` : ''}`);
    if (mediaInfo.duration && mediaInfo.duration > 600) lines.push('⚠ Duración superior a 10 min: divide en episodios más cortos antes de subir (riesgo de marcado como spam).');
  }
  lines.push('');
  if (assessment.risks.length) {
    lines.push(`Riesgos detectados (${assessment.risks.length}):`);
    for (const risk of assessment.risks) lines.push(`  · [${risk.severity}] ${risk.detail}`);
  } else {
    lines.push('Sin riesgos detectados en los factores verificables localmente.');
  }
  if (assessment.recommendations.length) {
    lines.push('');
    lines.push('Recomendaciones antes de publicar:');
    assessment.recommendations.forEach((rec, i) => lines.push(`  ${i + 1}. ${rec}`));
  }
  lines.push('');
  lines.push('Recuerda: si el vídeo ya está publicado y quedó en «Solo yo» sin notificación, bórralo y vuelve a subirlo limpio con privacidad «Todo el mundo» marcada ANTES de publicar.');
  return lines.join('\n');
}
