export function renderTimeline(container, project, commands, onSelect = () => {}, selectedId = null) {
  container.replaceChildren();
  for (const track of project.tracks) {
    const row = document.createElement('div'); row.className = 'timeline-track';
    const title = document.createElement('strong'); title.textContent = `${track.type} · ${track.id}`; row.appendChild(title);
    for (const clip of track.clips) {
      const item = document.createElement('div'); item.className = `timeline-clip${clip.id === selectedId ? ' selected' : ''}`; item.dataset.clipId = clip.id; item.textContent = `${clip.source.split(/[\\/]/).pop()} · ${clip.in.toFixed(2)}–${clip.out.toFixed(2)}s`;
      item.addEventListener('click', () => onSelect(track.id, clip)); row.appendChild(item);
    }
    container.appendChild(row);
  }
  if (!project.tracks.some(track => track.clips.length)) { const empty = document.createElement('p'); empty.textContent = 'Añade un vídeo para comenzar la edición.'; container.appendChild(empty); }
}
