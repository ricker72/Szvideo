export function listProjectMedia(project) {
  if (!project?.tracks) return [];
  const items = [];
  for (const track of project.tracks) {
    for (const clip of track.clips || []) {
      if (!items.some(item => item.source === clip.source)) items.push({ source: clip.source, name: clip.name || null, size: clip.size, tags: [...(clip.tags || [])], duration: clip.duration, addedAt: clip.addedAt || null, clipCount: 1, clipIds: [clip.id] });
      else {
        const item = items.find(candidate => candidate.source === clip.source);
        item.clipCount += 1;
        item.clipIds.push(clip.id);
        item.tags = [...new Set([...(item.tags || []), ...(clip.tags || [])])];
      }
    }
  }
  return items;
}

export function adjacentProjectMedia(project, source, direction = 1) {
  const items = listProjectMedia(project);
  if (!items.length) return null;
  const current = items.findIndex(item => item.source === source);
  const offset = direction < 0 ? -1 : 1;
  const next = current < 0 ? (offset > 0 ? 0 : items.length - 1) : (current + offset + items.length) % items.length;
  return items[next] || null;
}

export function filterProjectMedia(items, query = '') {
  const needle = String(query).trim().toLowerCase();
  return needle ? items.filter(item => {
    const haystack = [item.source, item.name, ...(item.tags || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  }) : items;
}

export function sortProjectMedia(items, sort = 'added') {
  const sorted = [...items];
  if (sort === 'added') sorted.sort((a, b) => String(a.addedAt || '').localeCompare(String(b.addedAt || '')));
  else if (sort === 'name') sorted.sort((a, b) => a.source.localeCompare(b.source));
  else if (sort === 'duration') sorted.sort((a, b) => a.duration - b.duration || a.source.localeCompare(b.source));
  else if (sort === 'clips') sorted.sort((a, b) => b.clipCount - a.clipCount || a.source.localeCompare(b.source));
  return sorted;
}

export function toggleMediaSelection(selected, source) {
  const next = new Set(selected || []);
  next.has(source) ? next.delete(source) : next.add(source);
  return next;
}

export function renderMediaBin(container, project, onSelect = () => {}, selectedSource = null, query = '', sort = 'added', view = 'compact', selectedSources = new Set(), onToggle = () => {}) {
  container.replaceChildren();
  container.dataset.view = view;
  const items = sortProjectMedia(filterProjectMedia(listProjectMedia(project), query), sort);
  if (!items.length) { const empty = document.createElement('p'); empty.textContent = 'No hay medios en el proyecto.'; container.appendChild(empty); return; }
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `media-bin-item${item.source === selectedSource ? ' selected' : ''}`;
    button.dataset.source = item.source;
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selectedSources.has(item.source); checkbox.setAttribute('aria-label', `Seleccionar ${item.name || item.source}`); checkbox.addEventListener('click', event => event.stopPropagation()); checkbox.addEventListener('change', () => onToggle(item.source)); button.appendChild(checkbox);
    const size = Number.isFinite(item.size) ? `${(item.size / 1048576).toFixed(1)} MB` : 'n/d'; const added = item.addedAt ? new Date(item.addedAt).toLocaleDateString() : 'n/d'; const name = item.name || item.source.split(/[\\/]/).pop();
    const tags = item.tags?.length ? item.tags.join(', ') : 'sin etiquetas';
    const text = document.createElement('span');
    if (view === 'detail') {
      const title = document.createElement('strong');
      title.textContent = name;
      text.appendChild(title);
      for (const detail of [`Duración: ${item.duration.toFixed(2)}s`, `Tamaño: ${size}`, `Incorporado: ${added}`, `Clips: ${item.clipCount}`, `Etiquetas: ${tags}`]) {
        const field = document.createElement('span');
        field.textContent = detail;
        text.appendChild(field);
      }
    } else {
      text.textContent = `${name} · ${item.duration.toFixed(2)}s · ${size} · ${item.clipCount} clip${item.clipCount === 1 ? '' : 's'} · ${added} · ${tags}`;
    }
    button.appendChild(text);
    button.addEventListener('click', () => onSelect(item));
    container.appendChild(button);
  }
}
