/** Minimal MLT project bridge for interoperability with Shotcut/MLT. */
export function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[character]));
}

export function buildMltProject({ clips = [], profile = 'atsc_1080p_25' } = {}) {
  const producers = clips.map((clip, index) => `<producer id="producer${index}" resource="${escapeXml(clip.path)}"><property name="length">${Number(clip.length || 0)}</property></producer>`).join('');
  const entries = clips.map((clip, index) => `<entry producer="producer${index}" in="${Number(clip.in || 0)}" out="${Number(clip.out || clip.length || 0)}"/>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?>\n<mlt LC_NUMERIC="C" version="7.0.0" profile="${escapeXml(profile)}">${producers}<playlist id="playlist0">${entries}</playlist><tractor id="tractor0" title="SzVideo project"><track producer="playlist0"/></tractor></mlt>`;
}
