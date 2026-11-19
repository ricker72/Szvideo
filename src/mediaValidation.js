export function projectMediaSources(project) {
  return [...new Set((project?.tracks || []).flatMap(track => (track.clips || []).map(clip => clip.source)))];
}

export async function findMissingMedia(project, exists = async () => true) {
  const sources = projectMediaSources(project);
  const missing = [];
  for (const source of sources) if (!await exists(source)) missing.push(source);
  return missing;
}
