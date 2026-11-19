import { VideoAnalyzer } from '../src/analyzer.js';
import { Protector } from '../src/protector.js';
import { buildMltProject } from '../src/shotcutBridge.js';
import { TimelineProject } from '../src/timeline.js';
import { ProjectStore, deserializeProject } from '../src/projectStore.js';
import { ErrorManager } from '../src/errorManager.js';
import { connectCommandPersistence } from '../src/commandPersistence.js';
import { ApplicationCommandManager } from '../src/applicationCommands.js';
import { MediaAdapter } from '../src/mediaAdapter.js';
import { ProxyManager, createLazyMediaSource } from '../src/mediaSource.js';
import { selectPlaybackSource } from '../src/playbackSource.js';
import { PlaybackController } from '../src/playbackController.js';
import { detectMediaBackend, mediaFoundationCapabilities } from '../src/mediaBackend.js';
import { ExportService } from '../src/exportService.js';
import { compareFingerprint, buildIntegrityRecord } from '../src/integrityService.js';
import { buildClaimReport } from '../src/claimReport.js';
import { appendEvidence, summarizeEvidence } from '../src/evidenceHistory.js';
import { serializeCase, deserializeCase } from '../src/caseStore.js';
import { buildPerceptualRecord, comparePerceptualRecords } from '../src/perceptualFingerprint.js';
import { validateExportRequest } from '../src/exportValidation.js';
import { renderTimeline } from '../src/timelineView.js';
import { renderMediaBin, adjacentProjectMedia, toggleMediaSelection } from '../src/mediaBin.js';
import { findMissingMedia } from '../src/mediaValidation.js';
import { PlaybackQueue } from '../src/playbackQueue.js';
import { clipPlaybackProgress, timeAtClipProgress } from '../src/playbackProgress.js';
import { suggestCleanOutput, validateCleanRequest, parseMetadataBlocks, summarizePrivacyTags, formatMetadataSummary } from '../src/metadataPrivacy.js';
import { validateAudioLayersRequest, buildAudioGraph, buildAudioLayerArgs } from '../src/audioLayer.js';
import { validateVisualLayersRequest, buildVideoChain, describeVisualLayers, hasActiveEffects } from '../src/visualLayer.js';
import { STEALTH_PRESET, buildStealthPresetArgs, describeStealthPreset, validateTikTokUpload } from '../src/stealthPreset.js';
import { createIntelligenceCore, clipOutputPath, RESOURCE_CAP_SECONDS } from '../src/intelligenceCore.js';
import { motionScore } from '../src/videoInsights.js';
import { CHECK_ITEMS, assessPublishReadiness, buildReadinessReport } from '../src/publishReadiness.js';
import { recordProcessedCopy, describeNativeSupport, createNoiseAudio, setNoiseVolume, closeNoiseAudio } from '../src/nativePipeline.js';
import { localMediaUrl } from '../src/localMediaUrl.js';
import { ADVANCED_MODES, buildAdvancedObfuscationArgs, buildAttackVariants, buildNormalizationChain, clampIntensity, describeAdvancedRequest } from '../src/advancedObfuscation.js';
// ADVANCED_MODES se usa en la validación del panel de ofuscación avanzada.


const results = document.querySelector('#analysisResults');
const errorManager = new ErrorManager({ notify: message => { if (results) results.textContent = message; }, log: record => window.szvideo?.logError(record) });
const mediaBackend = detectMediaBackend({ ffmpegAvailable: false });
window.SzVideoMediaBackend = mediaBackend;
const exportService = window.szvideo ? new ExportService({ mediaBackend, ffmpegExport: options => window.szvideo.exportVideo(options) }) : null;
window.SzVideoExportService = exportService;
window.SzVideoIntegrity = { compareFingerprint, buildIntegrityRecord };
window.SzVideoClaimReport = { buildClaimReport };
window.SzVideoEvidenceHistory = { appendEvidence, summarizeEvidence };
window.SzVideoCaseStore = { serializeCase, deserializeCase };
window.SzVideoPerceptual = { buildPerceptualRecord };
window.szvideo?.onExportProgress(progress => { results.textContent = `Exportando: ${progress.percent.toFixed(1)}%`; });
const exportPanel = document.createElement('div'); exportPanel.className = 'export-panel'; exportPanel.innerHTML = '<h3>Exportar vídeo</h3><label>Formato <select id="exportFormat"><option value="mp4">MP4</option><option value="webm">WebM</option></select></label><label>Calidad <input id="exportQuality" type="range" min="16" max="35" value="18"><span id="exportQualityValue">18</span></label><button id="exportChoosePath" class="btn-secondary" type="button">Elegir salida</button><span id="exportPath">Sin ruta</span><button id="exportStart" class="btn-primary" type="button">Exportar</button><button id="exportCancel" class="btn-secondary" type="button" disabled>Cancelar</button><progress id="exportProgress" max="100" value="0"></progress></div>'; document.querySelector('#editor-view')?.appendChild(exportPanel);
const exportFormat = exportPanel.querySelector('#exportFormat'), exportQuality = exportPanel.querySelector('#exportQuality'), exportQualityValue = exportPanel.querySelector('#exportQualityValue'), exportPathLabel = exportPanel.querySelector('#exportPath'), exportProgress = exportPanel.querySelector('#exportProgress'), exportStart = exportPanel.querySelector('#exportStart'), exportCancel = exportPanel.querySelector('#exportCancel');
let exportPath = null, activeExportJob = null;
exportQuality.addEventListener('input', () => { exportQualityValue.textContent = exportQuality.value; });
window.szvideo?.onExportProgress(progress => { if (progress.jobId === activeExportJob || !progress.jobId) exportProgress.value = progress.percent; });
exportPanel.querySelector('#exportChoosePath').addEventListener('click', () => errorManager.run(async () => { exportPath = await window.szvideo.chooseExportOutput(exportFormat.value); exportPathLabel.textContent = exportPath || 'Sin ruta'; }, 'elegir la ruta de exportación'));
exportCancel.addEventListener('click', async () => { if (activeExportJob) await window.szvideo.cancelExport(activeExportJob); });
exportStart.addEventListener('click', () => errorManager.run(async () => { const clip = playback?.clip; if (!clip) throw new Error('Carga un vídeo antes de exportar'); validateExportRequest({ input: clip.source, output: exportPath, format: exportFormat.value, duration: clip.duration, backend: mediaBackend.export }); await window.szvideo.validateExportPath({ input: clip.source, output: exportPath }); activeExportJob = crypto.randomUUID(); exportProgress.value = 0; exportStart.disabled = true; exportCancel.disabled = false; try { await exportService.exportClip(clip, { output: exportPath, format: exportFormat.value, crf: Number(exportQuality.value), jobId: activeExportJob }); results.textContent = 'Exportación completada.'; } finally { activeExportJob = null; exportStart.disabled = false; exportCancel.disabled = true; } }, 'validar y exportar el vídeo'));
window.addEventListener('error', event => errorManager.report(event.error || event.message, 'la interfaz'));
window.addEventListener('unhandledrejection', event => errorManager.report(event.reason, 'una operación asíncrona'));

const timeline = new TimelineProject({ name: 'SzVideo project' });
window.SzVideoTimeline = timeline;
const projectStore = window.szvideo ? new ProjectStore({ save: (content, filePath) => window.szvideo.saveProject(content, filePath), load: () => window.szvideo.loadProject(), intervalMs: 30000 }) : null;
if (projectStore) { projectStore.setProject(timeline); projectStore.startAutoSave(); }
const commands = projectStore ? connectCommandPersistence(timeline, { store: projectStore, setDirty: dirty => window.szvideo.setDirty(dirty), writeRecovery: content => window.szvideo.writeRecovery(content) }) : null;
const mediaAdapter = new MediaAdapter();
const proxyManager = window.szvideo ? new ProxyManager({ createProxy: options => window.szvideo.createProxy(options), onProgress: state => { if (state.state === 'starting') results.textContent = 'Generando proxy en disco…'; } }) : null;
window.SzVideoProxyManager = proxyManager;
window.szvideo?.onProxyProgress(progress => { results.textContent = `Generando proxy: ${progress.percent.toFixed(1)}%`; });
window.SzVideoPlayback = { selectPlaybackSource };
window.SzVideoCommands = commands;
const appCommands = projectStore ? new ApplicationCommandManager({ projectCommands: commands, projectStore, loadFile: () => window.szvideo.loadProject() }) : null;
window.SzVideoApplicationCommands = appCommands;
document.addEventListener('keydown', event => {
  if (!appCommands || !event.ctrlKey) return;
  const command = event.key.toLowerCase() === 'z' && !event.shiftKey ? 'undo' : event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey) ? 'redo' : null;
  if (!command) return;
  event.preventDefault();
  appCommands.execute(command).catch(error => errorManager.report(error, command));
});

async function offerRecovery() {
  if (!window.szvideo || !projectStore) return;
  const recovery = await window.szvideo.readRecovery();
  if (!recovery) return;
  let recovered;
  try { recovered = deserializeProject(recovery.content); }
  catch (error) {
    results.textContent = `El archivo de recuperación no es válido: ${error.message}`;
    return;
  }
  const modal = document.createElement('div');
  modal.className = 'recovery-modal';
  modal.innerHTML = `<div class="recovery-card"><h2>Recuperar proyecto</h2><p>Se encontró un proyecto recuperable de una sesión anterior.</p><p><strong>${recovered.name}</strong></p><div class="recovery-actions"><button id="recoverProject" class="btn-primary">Recuperar</button><button id="discardRecovery" class="btn-secondary">Descartar</button></div></div>`;
  document.body.appendChild(modal);
  modal.querySelector('#recoverProject').addEventListener('click', async () => {
    await appCommands?.execute('recover', recovery.content);
    const missing = await refreshMissingMedia(recovered);
    await window.szvideo.deleteRecovery();
    window.szvideo.setDirty(false);
    modal.remove();
    results.textContent = missing.length ? `Proyecto recuperado con advertencias: ${missing.length} medio(s) no encontrado(s).` : `Proyecto recuperado: ${recovered.name}`;
  });
  modal.querySelector('#discardRecovery').addEventListener('click', async () => {
    await window.szvideo.deleteRecovery();
    modal.remove();
    results.textContent = 'Archivo de recuperación descartado.';
  });
}
errorManager.run(offerRecovery, 'revisar la recuperación');
window.szvideo?.onSafeClose(async () => {
  try {
    if (projectStore?.dirty) {
      const saved = await appCommands.execute('save');
      if (!saved) {
        results.textContent = 'Cierre cancelado: el proyecto sigue sin guardar y la recuperación se conservó.';
        return;
      }
    }
    await window.szvideo.deleteRecovery();
    await window.szvideo.allowClose();
  } catch (error) {
    results.textContent = `No se pudo cerrar sin guardar: ${error.message}`;
  }
});

const fileInput = document.querySelector('#fileInput');
const analyzeFileInput = document.querySelector('#analyzeFileInput');
const dropZone = document.querySelector('#dropZone');
const video = document.querySelector('#sourceVideo');
const canvas = document.querySelector('#previewCanvas');
const mediaBinPanel = document.createElement('section'); mediaBinPanel.className = 'media-bin-panel'; mediaBinPanel.innerHTML = '<h3>Medios del proyecto</h3><input id="mediaSearch" type="search" placeholder="Buscar por nombre, ruta o etiqueta" aria-label="Buscar medios por nombre, ruta o etiqueta"><select id="mediaSort" aria-label="Ordenar medios"><option value="added">Orden de incorporación</option><option value="name">Nombre</option><option value="duration">Duración</option><option value="clips">Número de clips</option></select><select id="mediaView" aria-label="Vista de medios"><option value="compact">Vista compacta</option><option value="detail">Vista detallada</option></select><span id="mediaSelectionStatus">0 seleccionados</span><input id="mediaTagInput" type="text" placeholder="Etiqueta" aria-label="Etiqueta para medios seleccionados"><button id="applyMediaTag" class="btn-secondary" type="button">Aplicar etiqueta</button><button id="removeMediaTag" class="btn-secondary" type="button">Quitar etiqueta</button><button id="clearMediaSelection" class="btn-secondary" type="button">Limpiar selección</button><div id="mediaBinItems"></div><div id="missingMediaPanel"></div><div class="media-bin-navigation"><button id="mediaPrevious" class="btn-secondary" type="button">Anterior</button><button id="mediaNext" class="btn-secondary" type="button">Siguiente</button><button id="relinkMediaButton" class="btn-secondary" type="button">Relocalizar seleccionado</button></div>'; document.querySelector('#editor-view')?.appendChild(mediaBinPanel);
const mediaBinItems = mediaBinPanel.querySelector('#mediaBinItems');
const mediaSearch = mediaBinPanel.querySelector('#mediaSearch');
const mediaSort = mediaBinPanel.querySelector('#mediaSort');
const mediaView = mediaBinPanel.querySelector('#mediaView');
const mediaSelectionStatus = mediaBinPanel.querySelector('#mediaSelectionStatus'); const clearMediaSelection = mediaBinPanel.querySelector('#clearMediaSelection'); const selectedMediaSources = new Set();
const mediaTagInput = mediaBinPanel.querySelector('#mediaTagInput'); const applyMediaTag = mediaBinPanel.querySelector('#applyMediaTag'); const removeMediaTag = mediaBinPanel.querySelector('#removeMediaTag');
const missingMediaPanel = mediaBinPanel.querySelector('#missingMediaPanel'); let missingMediaSources = [];
const mediaPrevious = mediaBinPanel.querySelector('#mediaPrevious'); const mediaNext = mediaBinPanel.querySelector('#mediaNext');
const relinkMediaButton = mediaBinPanel.querySelector('#relinkMediaButton');
const timelinePanel = document.createElement('section'); timelinePanel.className = 'timeline-panel'; timelinePanel.innerHTML = '<h3>Timeline</h3><div id="timelineTracks"></div><div id="timelineEditor">Selecciona un clip.</div><div id="markerPanel"><button id="addMarkerButton" class="btn-secondary" type="button">Añadir marcador en el tiempo actual</button><div id="markerList">Sin marcadores.</div></div>'; document.querySelector('#editor-view')?.appendChild(timelinePanel);
const timelineTracks = timelinePanel.querySelector('#timelineTracks'); const timelineEditor = timelinePanel.querySelector('#timelineEditor'); const markerList = timelinePanel.querySelector('#markerList'); const addMarkerButton = timelinePanel.querySelector('#addMarkerButton'); let selectedClipId = null;
let playback = null;
const playbackQueue = new PlaybackQueue(timeline);
function selectProjectClip(clip, autoplay = false) { selectedClipId = clip.id; playback?.selectClip(clip).then(() => autoplay ? playback.play() : null).catch(error => errorManager.report(error, 'seleccionar clip')); refreshPlaybackControls(); refreshTimeline(); refreshQueueControls(); }
function selectMediaItem(item) { const clip = timeline.tracks.flatMap(track => track.clips).find(candidate => candidate.source === item.source); if (clip) selectProjectClip(clip); }
function navigateMedia(direction) { const currentSource = playback?.clip?.source || null; const item = adjacentProjectMedia(timeline, currentSource, direction); if (item) selectMediaItem(item); }
mediaPrevious.addEventListener('click', () => navigateMedia(-1)); mediaNext.addEventListener('click', () => navigateMedia(1));
relinkMediaButton.addEventListener('click', () => errorManager.run(async () => { const clip = playback?.clip; if (!clip) throw new Error('Selecciona un clip antes de relocalizarlo'); const track = timeline.tracks.find(candidate => candidate.clips.some(item => item.id === clip.id)); if (!track) throw new Error('No se encontró la pista del clip seleccionado'); const source = await window.szvideo.chooseVideo(); if (!source) return; if (!await window.szvideo.fileExists(source)) throw new Error('El archivo seleccionado no está disponible'); commands.relinkClip(track.id, clip.id, source); const updated = commands.project.findClip(track.id, clip.id); playback.loadClip(updated); refreshPlaybackControls(); refreshTimeline(); results.textContent = 'Medio relocalizado; se conservaron los cortes y marcadores.'; }, 'relocalizar el medio'));
function renderMissingMedia() { missingMediaPanel.replaceChildren(); if (!missingMediaSources.length) return; const heading = document.createElement('h4'); heading.textContent = `Medios faltantes (${missingMediaSources.length})`; missingMediaPanel.appendChild(heading); for (const missing of missingMediaSources) { const row = document.createElement('div'); row.className = 'missing-media-row'; const label = document.createElement('span'); label.textContent = missing; const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-secondary'; button.textContent = 'Relocalizar'; button.addEventListener('click', () => errorManager.run(async () => { const replacement = await window.szvideo.chooseVideo(); if (!replacement) return; if (!await window.szvideo.fileExists(replacement)) throw new Error('El archivo seleccionado no está disponible'); for (const track of timeline.tracks) for (const clip of track.clips.filter(item => item.source === missing)) commands.relinkClip(track.id, clip.id, replacement); missingMediaSources = missingMediaSources.filter(source => source !== missing); renderMissingMedia(); refreshTimeline(); results.textContent = 'Medio faltante relocalizado.'; }, 'relocalizar medio faltante')); row.append(label, button); missingMediaPanel.appendChild(row); } }
async function refreshMissingMedia(project = timeline) {
  missingMediaSources = window.szvideo ? await findMissingMedia(project, source => window.szvideo.fileExists(source)) : [];
  renderMissingMedia();
  return missingMediaSources;
}
mediaBinPanel.addEventListener('keydown', event => { if (event.key === 'ArrowLeft') { event.preventDefault(); navigateMedia(-1); } if (event.key === 'ArrowRight') { event.preventDefault(); navigateMedia(1); } });
mediaSearch.addEventListener('input', () => refreshTimeline());
mediaSort.addEventListener('change', () => refreshTimeline());
mediaView.addEventListener('change', () => refreshTimeline());
clearMediaSelection.addEventListener('click', () => { selectedMediaSources.clear(); refreshTimeline(); });
applyMediaTag.addEventListener('click', () => errorManager.run(() => { const tag = mediaTagInput.value.trim(); if (!tag || !selectedMediaSources.size) throw new Error('Selecciona medios y escribe una etiqueta'); for (const track of timeline.tracks) for (const clip of track.clips.filter(item => selectedMediaSources.has(item.source))) commands.setClipTag(track.id, clip.id, tag); mediaTagInput.value = ''; refreshTimeline(); results.textContent = `Etiqueta aplicada a ${selectedMediaSources.size} fuente(s).`; }, 'etiquetar medios'));
removeMediaTag.addEventListener('click', () => errorManager.run(() => { const tag = mediaTagInput.value.trim(); if (!tag || !selectedMediaSources.size) throw new Error('Selecciona medios y escribe la etiqueta que quieres quitar'); for (const track of timeline.tracks) for (const clip of track.clips.filter(item => selectedMediaSources.has(item.source))) commands.setClipTag(track.id, clip.id, tag, false); mediaTagInput.value = ''; refreshTimeline(); results.textContent = `Etiqueta quitada de ${selectedMediaSources.size} fuente(s).`; }, 'quitar etiqueta'));
function renderMarkers() { markerList.replaceChildren(); if (!timeline.markers.length) { markerList.textContent = 'Sin marcadores.'; return; } for (const marker of timeline.markers) { const row = document.createElement('div'); row.className = 'marker-row'; const label = document.createElement('input'); label.value = marker.label; label.setAttribute('aria-label', 'Etiqueta del marcador'); const time = document.createElement('input'); time.type = 'number'; time.step = '0.01'; time.value = marker.time; time.setAttribute('aria-label', 'Tiempo del marcador'); const save = document.createElement('button'); save.type = 'button'; save.className = 'btn-secondary'; save.textContent = 'Guardar'; save.addEventListener('click', () => errorManager.run(() => { commands.updateMarker(marker.id, Number(time.value), label.value); refreshTimeline(); }, 'actualizar marcador')); const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn-secondary'; remove.textContent = 'Eliminar'; remove.addEventListener('click', () => errorManager.run(() => { commands.removeMarker(marker.id); refreshTimeline(); }, 'eliminar marcador')); const jump = document.createElement('button'); jump.type = 'button'; jump.className = 'marker-item'; jump.textContent = 'Ir'; jump.addEventListener('click', () => { if (playback?.clip) video.currentTime = Math.min(Math.max(marker.time, playback.clip.in), playback.clip.out); refreshClipProgress(); }); row.append(label, time, save, remove, jump); markerList.appendChild(row); } }
addMarkerButton.addEventListener('click', () => errorManager.run(() => { if (!playback?.clip) throw new Error('Carga un clip antes de añadir un marcador'); commands.addMarker(video.currentTime, `Marcador ${timeline.markers.length + 1}`); refreshTimeline(); }, 'añadir marcador'));
function refreshTimeline() { mediaSelectionStatus.textContent = `${selectedMediaSources.size} seleccionados`; renderMediaBin(mediaBinItems, timeline, item => { const clip = timeline.tracks.flatMap(track => track.clips).find(candidate => candidate.source === item.source); if (clip) selectProjectClip(clip); }, playback?.clip?.source || null, mediaSearch.value, mediaSort.value, mediaView.value, selectedMediaSources, source => { const next = toggleMediaSelection(selectedMediaSources, source); selectedMediaSources.clear(); next.forEach(value => selectedMediaSources.add(value)); refreshTimeline(); }); renderMarkers(); renderTimeline(timelineTracks, timeline, commands, (trackId, clip) => { selectedClipId = clip.id; playback?.selectClip(clip).catch(error => errorManager.report(error, 'seleccionar clip')); refreshPlaybackControls(); refreshTimeline(); timelineEditor.replaceChildren(); const label = document.createElement('span'); label.textContent = `${clip.source} · entrada/salida`; const start = document.createElement('input'); start.type = 'number'; start.step = '0.01'; start.value = clip.in; const end = document.createElement('input'); end.type = 'number'; end.step = '0.01'; end.value = clip.out; const trim = document.createElement('button'); trim.className = 'btn-primary'; trim.textContent = 'Recortar'; trim.addEventListener('click', () => errorManager.run(() => { commands.trimClip(trackId, clip.id, Number(start.value), Number(end.value)); refreshTimeline(); }, 'recortar clip')); const splitAt = document.createElement('input'); splitAt.type = 'number'; splitAt.step = '0.01'; splitAt.value = ((clip.in + clip.out) / 2).toFixed(2); const split = document.createElement('button'); split.className = 'btn-secondary'; split.textContent = 'Dividir'; split.addEventListener('click', () => errorManager.run(() => { commands.splitClip(trackId, clip.id, Number(splitAt.value)); refreshTimeline(); }, 'dividir clip')); const play = document.createElement('button'); play.className = 'btn-secondary'; play.textContent = 'Reproducir/Pausar'; play.addEventListener('click', () => video.paused ? video.play() : video.pause()); timelineEditor.append(label, start, end, trim, splitAt, split, play); }, selectedClipId); }
refreshTimeline();
playback = commands ? new PlaybackController({ video, commands }) : null;
video.addEventListener('ended', () => { const next = playbackQueue.next(); if (next) selectProjectClip(next, true); else refreshQueueControls(); });
window.SzVideoPlaybackController = playback;
const playbackPanel = document.createElement('div');
playbackPanel.className = 'playback-panel';
playbackPanel.innerHTML = '<span id="playbackSourceLabel">Fuente: ninguna</span><span id="queueStatus">Cola detenida</span><input id="clipProgress" type="range" min="0" max="100" step="0.1" value="0" aria-label="Posición del clip"><span id="clipTime">0.00 / 0.00s</span><button id="playButton" class="btn-primary" type="button">Reproducir</button><button id="pauseButton" class="btn-secondary" type="button">Pausa</button><button id="stopButton" class="btn-secondary" type="button">Detener</button><button id="frameBackButton" class="btn-secondary" type="button">◀ Cuadro</button><button id="frameForwardButton" class="btn-secondary" type="button">Cuadro ▶</button><label>Volumen <input id="volumeControl" type="range" min="0" max="1" step="0.01" value="1"></label><button id="muteButton" class="btn-secondary" type="button">Silenciar</button><button id="useOriginalBtn" class="btn-secondary" type="button">Usar original</button><button id="useProxyBtn" class="btn-primary" type="button">Usar proxy</button>';
document.querySelector('.editor-stage')?.appendChild(playbackPanel);
const playbackSourceLabel = playbackPanel.querySelector('#playbackSourceLabel');
const queueStatus = playbackPanel.querySelector('#queueStatus');
const clipProgress = playbackPanel.querySelector('#clipProgress'); const clipTime = playbackPanel.querySelector('#clipTime');
const playButton = playbackPanel.querySelector('#playButton'); const pauseButton = playbackPanel.querySelector('#pauseButton'); const stopButton = playbackPanel.querySelector('#stopButton');
const frameBackButton = playbackPanel.querySelector('#frameBackButton'); const frameForwardButton = playbackPanel.querySelector('#frameForwardButton'); const volumeControl = playbackPanel.querySelector('#volumeControl'); const muteButton = playbackPanel.querySelector('#muteButton');
const useOriginalButton = playbackPanel.querySelector('#useOriginalBtn');
const useProxyButton = playbackPanel.querySelector('#useProxyBtn');
function refreshPlaybackControls() {
  const clip = playback?.clip;
  const hasProxy = Boolean(clip?.proxy);
  if (!clip) { playbackSourceLabel.textContent = 'Fuente: ninguna'; useOriginalButton.disabled = true; useProxyButton.disabled = true; playButton.disabled = true; pauseButton.disabled = true; stopButton.disabled = true; frameBackButton.disabled = true; frameForwardButton.disabled = true; volumeControl.disabled = true; muteButton.disabled = true; return; }
  const usingProxy = Boolean(clip.useProxy && hasProxy);
  playbackSourceLabel.textContent = `Fuente: ${usingProxy ? 'proxy' : 'original'}`;
  useOriginalButton.disabled = !usingProxy; useProxyButton.disabled = !hasProxy || usingProxy;
  playButton.disabled = false; pauseButton.disabled = false; stopButton.disabled = false;
  frameBackButton.disabled = false; frameForwardButton.disabled = false; volumeControl.disabled = false; muteButton.disabled = false; muteButton.textContent = video.muted ? 'Activar sonido' : 'Silenciar';
}
function refreshQueueControls() { const current = playbackQueue.current; queueStatus.textContent = playbackQueue.enabled ? `Cola: ${current?.source?.split(/[\\/]/).pop() || 'activa'}` : 'Cola detenida'; stopQueueButton.disabled = !playbackQueue.enabled; }
function refreshClipProgress() { const state = clipPlaybackProgress(playback?.clip, video.currentTime); clipProgress.value = state.percent; clipTime.textContent = `${state.current.toFixed(2)} / ${state.duration.toFixed(2)}s`; clipProgress.disabled = !playback?.clip; }
clipProgress.addEventListener('input', () => { const time = timeAtClipProgress(playback?.clip, Number(clipProgress.value)); if (time === null) return; video.currentTime = time; refreshClipProgress(); });
playButton.addEventListener('click', () => errorManager.run(() => playback.play(), 'reproducir el clip'));
pauseButton.addEventListener('click', () => errorManager.run(() => playback.pause(), 'pausar el clip'));
stopButton.addEventListener('click', () => errorManager.run(() => { playback.stop(); playbackQueue.stop(); refreshQueueControls(); refreshClipProgress(); }, 'detener el clip'));
frameBackButton.addEventListener('click', () => errorManager.run(() => { playback.stepFrame(-1); refreshClipProgress(); }, 'retroceder un cuadro'));
frameForwardButton.addEventListener('click', () => errorManager.run(() => { playback.stepFrame(1); refreshClipProgress(); }, 'avanzar un cuadro'));
volumeControl.addEventListener('input', () => playback?.setVolume(volumeControl.value));
muteButton.addEventListener('click', () => errorManager.run(() => { playback.setMuted(!video.muted); refreshPlaybackControls(); }, 'cambiar el silencio'));
video.addEventListener('timeupdate', () => { refreshClipProgress(); const clip = playback?.clip; if (!clip || video.currentTime < clip.out || video.seeking) return; video.pause(); const next = playbackQueue.next(); if (next) { selectProjectClip(next); video.play().catch(error => errorManager.report(error, 'continuar la cola')); } else refreshQueueControls(); });
useOriginalButton.addEventListener('click', () => errorManager.run(async () => { await playback.toggleProxy(false); refreshPlaybackControls(); }, 'cambiar al vídeo original'));
useProxyButton.addEventListener('click', () => errorManager.run(async () => { await playback.toggleProxy(true); refreshPlaybackControls(); }, 'activar el proxy'));

// === Previsualización en vivo: el vídeo está oculto y el canvas es el que se muestra,
// así que hay que dibujar cada fotograma mientras reproduce (antes solo se dibujaba
// el primer fotograma al cargar y por eso «solo se oía el audio»). ===
let previewRafId = null;
function drawPreviewFrame() {
  if (video.readyState >= 2 && video.videoWidth > 0) {
    // Ajusta el canvas a la relación de aspecto real la primera vez que hay fotogramas.
    if (!canvas.dataset.aspect || canvas.dataset.aspect !== `${video.videoWidth}:${video.videoHeight}`) {
      canvas.width = Math.min(video.videoWidth, 1280);
      canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
      canvas.dataset.aspect = `${video.videoWidth}:${video.videoHeight}`;
    }
    try { canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height); } catch { /* frame aún no disponible */ }
  }
  previewRafId = requestAnimationFrame(drawPreviewFrame);
}
function startPreviewLoop() { if (previewRafId === null) previewRafId = requestAnimationFrame(drawPreviewFrame); }
startPreviewLoop();
const generateProxyButton = document.createElement('button');
generateProxyButton.className = 'btn-secondary'; generateProxyButton.textContent = 'Generar proxy'; generateProxyButton.type = 'button';
playbackPanel.appendChild(generateProxyButton);
const queueButton = document.createElement('button'); queueButton.className = 'btn-secondary'; queueButton.textContent = 'Reproducir clips'; queueButton.type = 'button'; playbackPanel.appendChild(queueButton);
const stopQueueButton = document.createElement('button'); stopQueueButton.className = 'btn-secondary'; stopQueueButton.textContent = 'Detener cola'; stopQueueButton.type = 'button'; playbackPanel.appendChild(stopQueueButton);
queueButton.addEventListener('click', () => { const clip = playback?.clip || timeline.tracks.flatMap(track => track.clips).find(Boolean); if (!clip) return; playbackQueue.start(clip.id); selectProjectClip(clip, true); refreshQueueControls(); });
stopQueueButton.addEventListener('click', () => { playbackQueue.stop(); video.pause(); refreshQueueControls(); });
const ffmpegStatusLabel = document.createElement('span');
ffmpegStatusLabel.className = 'ffmpeg-status'; ffmpegStatusLabel.textContent = 'FFmpeg: comprobando…'; playbackPanel.appendChild(ffmpegStatusLabel);
const chooseFfmpegButton = document.createElement('button');
chooseFfmpegButton.className = 'btn-secondary'; chooseFfmpegButton.textContent = 'Configurar FFmpeg'; chooseFfmpegButton.type = 'button'; playbackPanel.appendChild(chooseFfmpegButton);
let ffmpegAvailable = false;
function applyFfmpegStatus(status) { ffmpegAvailable = status.available; mediaBackend.proxy = status.available ? 'ffmpeg' : 'unavailable'; mediaBackend.export = status.available ? 'ffmpeg' : 'unavailable'; generateProxyButton.disabled = !ffmpegAvailable; window.SzVideoMetadataUI?.setAvailable(ffmpegAvailable); window.SzVideoAudioLayersUI?.setAvailable(ffmpegAvailable); window.SzVideoVisualLayersUI?.setAvailable(ffmpegAvailable); window.SzVideoStealthUI?.setAvailable(ffmpegAvailable); ffmpegStatusLabel.textContent = `Básico: Media Foundation · ${status.available ? `FFmpeg ${status.version}` : 'FFmpeg no disponible'}`; }
window.szvideo?.ffmpegStatus().then(applyFfmpegStatus).catch(error => { generateProxyButton.disabled = true; ffmpegStatusLabel.textContent = 'Básico: Media Foundation · FFmpeg: error de detección'; errorManager.report(error, 'detectar FFmpeg'); });
chooseFfmpegButton.addEventListener('click', () => errorManager.run(async () => { const status = await window.szvideo.chooseFfmpeg(); if (status) { applyFfmpegStatus(status); results.textContent = `FFmpeg configurado: ${status.version}`; } }, 'configurar FFmpeg'));
generateProxyButton.addEventListener('click', () => errorManager.run(async () => {
  if (!ffmpegAvailable) throw new Error('FFmpeg no está disponible');
  const clip = playback?.clip;
  if (!clip || !proxyManager) throw new Error('Carga un vídeo local antes de generar un proxy');
  const proxy = await proxyManager.create({ source: clip.source, duration: clip.duration });
  commands.setClipProxy('video-1', clip.id, proxy.proxy);
  playback.clip = commands.project.findClip('video-1', clip.id);
  refreshPlaybackControls(); results.textContent = 'Proxy generado y asignado al clip.';
}, 'generar el proxy'));

// === Herramientas de metadatos (EXIF/GPS/autoría) ===
const metadataPanel = document.createElement('div');
metadataPanel.className = 'export-panel metadata-panel';
metadataPanel.innerHTML = '<h3>Privacidad de metadatos (EXIF/GPS/autoría)</h3>'
  + '<span id="metadataSourceLabel">Archivo: ninguno</span>'
  + '<button id="metadataInspect" class="btn-secondary" type="button" disabled>Inspeccionar metadatos</button>'
  + '<button id="metadataClean" class="btn-primary" type="button" disabled>Limpiar metadatos (copia sin EXIF)</button>'
  + '<span id="metadataPath">Sin salida</span>'
  + '<button id="metadataCancel" class="btn-secondary" type="button" disabled>Cancelar</button>'
  + '<progress id="metadataProgress" max="100" value="0"></progress>'
  + '<pre id="metadataResults">Selecciona un vídeo y pulsa «Inspeccionar metadatos» para ver sus etiquetas.</pre>';
document.querySelector('#editor-view')?.appendChild(metadataPanel);
const metadataSourceLabel = metadataPanel.querySelector('#metadataSourceLabel');
const metadataInspectButton = metadataPanel.querySelector('#metadataInspect');
const metadataCleanButton = metadataPanel.querySelector('#metadataClean');
const metadataPathLabel = metadataPanel.querySelector('#metadataPath');
const metadataCancelButton = metadataPanel.querySelector('#metadataCancel');
const metadataProgress = metadataPanel.querySelector('#metadataProgress');
const metadataResults = metadataPanel.querySelector('#metadataResults');
let metadataSource = null, metadataSummary = null, activeMetadataJob = null;
window.SzVideoMetadata = { suggestCleanOutput, validateCleanRequest, parseMetadataBlocks, summarizePrivacyTags, formatMetadataSummary };
window.SzVideoMetadataUI = { setAvailable(available) { metadataInspectButton.disabled = !available; metadataCleanButton.disabled = !available; } };
window.szvideo?.onMetadataProgress(progress => {
  if (progress.jobId && progress.jobId !== activeMetadataJob) return;
  metadataProgress.value = progress.percent;
  if (progress.jobId) results.textContent = `Limpiando metadatos: ${progress.percent.toFixed(1)}%`;
});
async function metadataSourceReady() {
  const source = metadataSource || playback?.clip?.source || null;
  if (source) return source;
  const chosen = await window.szvideo.chooseVideo();
  if (!chosen) throw new Error('Selecciona un vídeo primero');
  metadataSource = chosen;
  return chosen;
}
metadataInspectButton.addEventListener('click', () => errorManager.run(async () => {
  if (!ffmpegAvailable) throw new Error('FFmpeg no está disponible');
  const input = await metadataSourceReady();
  metadataSourceLabel.textContent = `Archivo: ${input.split(/[\\/]/).pop()}`;
  const inspection = await window.szvideo.inspectMetadata(input);
  metadataSummary = summarizePrivacyTags(parseMetadataBlocks(inspection.raw));
  metadataResults.textContent = formatMetadataSummary(metadataSummary);
  results.textContent = `Metadatos: ${metadataSummary.total} etiqueta(s), riesgo ${metadataSummary.riesgo}.`;
}, 'inspeccionar los metadatos'));
metadataCancelButton.addEventListener('click', async () => { if (activeMetadataJob) await window.szvideo.cancelMetadata(activeMetadataJob); });
metadataCleanButton.addEventListener('click', () => errorManager.run(async () => {
  if (!ffmpegAvailable) throw new Error('FFmpeg no está disponible');
  const input = await metadataSourceReady();
  if (!metadataSummary) throw new Error('Inspecciona los metadatos antes de limpiar');
  const ext = (input.split(/[\\/]/).pop().split('.').pop() || '').toLowerCase();
  const output = await window.szvideo.chooseMetadataOutput({ input, format: ext });
  if (!output) return;
  validateCleanRequest({ input, output });
  await window.szvideo.validateExportPath({ input, output });
  activeMetadataJob = crypto.randomUUID();
  metadataProgress.value = 0; metadataCleanButton.disabled = true; metadataCancelButton.disabled = false;
  try {
    const result = await window.szvideo.cleanMetadata({ jobId: activeMetadataJob, input, output, duration: playback?.clip?.duration || 0 });
    const after = summarizePrivacyTags(parseMetadataBlocks((await window.szvideo.inspectMetadata(output)).raw));
    const size = result.bytes === undefined ? 'n/d' : `${(result.bytes / 1048576).toFixed(2)} MB`;
    metadataResults.textContent = `Limpieza completada (${size}).\nMetadatos originales: ${metadataSummary.total} → restantes en la copia: ${after.total}.\n\n${formatMetadataSummary(after)}`;
    metadataPathLabel.textContent = output;
    if (window.SzVideoCase?.history) {
      window.SzVideoCase.history = appendEvidence(window.SzVideoCase.history, { type: 'metadata-strip', status: after.total === 0 ? 'clean' : 'partial', path: output });
      renderCasePanel();
    }
    results.textContent = `Metadatos limpiados: ${output} · ${metadataSummary.total} → ${after.total} etiqueta(s).`;
  } finally {
    activeMetadataJob = null; metadataCleanButton.disabled = !ffmpegAvailable; metadataCancelButton.disabled = true;
  }
}, 'limpiar los metadatos'));

// === Capas de audio (ruido de fondo + modulación de tono) ===
const audioLayersPanel = document.createElement('div');
audioLayersPanel.className = 'export-panel audio-layers-panel';
audioLayersPanel.innerHTML = '<h3>Capas de audio (huella digital)</h3>'
  + '<label>Capa de fondo <select id="audioNoiseType"><option value="ninguno" selected>Ninguna</option><option value="rosa">Ruido rosa</option><option value="blanco">Ruido blanco</option><option value="ambiental">Ruido ambiental (gravedad)</option></select></label>'
  + '<label>Volumen del fondo (%) <input id="audioNoiseVolume" type="number" min="1" max="5" step="0.5" value="2" aria-label="Volumen del ruido de fondo en porcentaje"></label>'
  + '<label>Modulación de tono (%) <input id="audioPitch" type="number" min="-3" max="3" step="0.25" value="0" aria-label="Modulación de tono en porcentaje"></label>'
  + '<span id="audioSourceLabel">Archivo: ninguno</span>'
  + '<button id="audioApply" class="btn-primary" type="button" disabled>Aplicar capas de audio (copia)</button>'
  + '<span id="audioPath">Sin salida</span>'
  + '<button id="audioCancel" class="btn-secondary" type="button" disabled>Cancelar</button>'
  + '<progress id="audioProgress" max="100" value="0"></progress>'
  + '<pre id="audioResults">Con ruido rosa/blanco/ambiental al 1-2% y un tono ±1-2% la huella del audio cambia sin ser perceptible.</pre>';
document.querySelector('#editor-view')?.appendChild(audioLayersPanel);
const audioNoiseType = audioLayersPanel.querySelector('#audioNoiseType');
const audioNoiseVolume = audioLayersPanel.querySelector('#audioNoiseVolume');
const audioPitch = audioLayersPanel.querySelector('#audioPitch');
const audioSourceLabel = audioLayersPanel.querySelector('#audioSourceLabel');
const audioApplyButton = audioLayersPanel.querySelector('#audioApply');
const audioPathLabel = audioLayersPanel.querySelector('#audioPath');
const audioCancelButton = audioLayersPanel.querySelector('#audioCancel');
const audioProgress = audioLayersPanel.querySelector('#audioProgress');
const audioResults = audioLayersPanel.querySelector('#audioResults');
let audioSource = null, activeAudioJob = null;
window.SzVideoAudioLayers = { validateAudioLayersRequest, buildAudioGraph, buildAudioLayerArgs };
window.SzVideoAudioLayersUI = { setAvailable(available) { audioApplyButton.disabled = !available; } };
window.szvideo?.onAudioLayersProgress(progress => {
  if (progress.jobId && progress.jobId !== activeAudioJob) return;
  audioProgress.value = progress.percent;
  if (progress.jobId) results.textContent = `Aplicando capas de audio: ${progress.percent.toFixed(1)}%`;
});
audioNoiseType.addEventListener('change', () => { audioNoiseVolume.disabled = audioNoiseType.value === 'ninguno'; });
audioNoiseVolume.disabled = true; // empieza en "Ninguna"
audioCancelButton.addEventListener('click', async () => { if (activeAudioJob) await window.szvideo.cancelAudioLayers(activeAudioJob); });
audioApplyButton.addEventListener('click', () => errorManager.run(async () => {
  if (!ffmpegAvailable) throw new Error('FFmpeg no está disponible');
  if (!audioSource && playback?.clip?.source) audioSource = playback.clip.source;
  if (!audioSource) { const chosen = await window.szvideo.chooseVideo(); if (!chosen) throw new Error('Selecciona un vídeo primero'); audioSource = chosen; }
  const input = audioSource;
  audioSourceLabel.textContent = `Archivo: ${input.split(/[\\/]/).pop()}`;
  const noiseType = audioNoiseType.value;
  const noiseVolume = Number(audioNoiseVolume.value);
  const pitchPercent = Number(audioPitch.value);
  if (noiseType === 'ninguno' && pitchPercent === 0) throw new Error('Selecciona al menos una capa: ruido de fondo o modulación de tono');
  const ext = (input.split(/[\\/]/).pop().split('.').pop() || '').toLowerCase();
  const output = await window.szvideo.chooseAudioOutput({ input, format: ext });
  if (!output) return;
  validateAudioLayersRequest({ output, noiseType, noiseVolume, pitchPercent });
  await window.szvideo.validateExportPath({ input, output });
  activeAudioJob = crypto.randomUUID();
  audioProgress.value = 0; audioApplyButton.disabled = true; audioCancelButton.disabled = false;
  try {
    const result = await window.szvideo.applyAudioLayers({ jobId: activeAudioJob, input, output, duration: playback?.clip?.duration || 0, noiseType, noiseVolume, pitchPercent });
    const capas = [];
    if (noiseType !== 'ninguno') capas.push(`${noiseType} a ${noiseVolume}%`);
    if (pitchPercent !== 0) capas.push(`tono ${pitchPercent > 0 ? '+' : ''}${pitchPercent}%`);
    audioPathLabel.textContent = output;
    const size = result.bytes === undefined ? 'n/d' : `${(result.bytes / 1048576).toFixed(2)} MB`;
    audioResults.textContent = `Capas aplicadas (${size}): ${capas.join(' · ')}.\nVídeo copiado sin recodificar; audio re-mezclado y metadatos eliminados.\nSalida: ${output}`;
    if (window.SzVideoCase?.history) {
      window.SzVideoCase.history = appendEvidence(window.SzVideoCase.history, { type: 'audio-layers', status: capas.join('+'), path: output });
      renderCasePanel();
    }
    results.textContent = `Capas de audio aplicadas: ${output} (${capas.join(' · ')}).`;
  } finally {
    activeAudioJob = null; audioApplyButton.disabled = !ffmpegAvailable; audioCancelButton.disabled = true;
  }
}, 'aplicar las capas de audio'));
attachCompareButton(audioLayersPanel, 'capas de audio', () => ({ input: audioSource || playback?.clip?.source || null, output: audioPathLabel.textContent, target: audioResults }), 'audio-comparison');

// === Transformación visual (velocidad, zoom, marcos, color) ===
const visualPanel = document.createElement('div');
visualPanel.className = 'export-panel visual-layers-panel';
visualPanel.innerHTML = '<h3>Transformación visual (huella digital)</h3>'
  + '<div class="visual-controls-grid">'
  + '<label>Velocidad (%) <input id="visualSpeed" type="number" min="-3" max="3" step="0.25" value="2" aria-label="Cambio de velocidad en porcentaje"></label>'
  + '<label>Zoom (%) <input id="visualZoom" type="number" min="0" max="5" step="0.5" value="0" aria-label="Zoom en porcentaje"></label>'
  + '<label>Desplazamiento X (%) <input id="visualOffsetX" type="number" min="-5" max="5" step="0.5" value="0" aria-label="Desplazamiento horizontal en porcentaje"></label>'
  + '<label>Desplazamiento Y (%) <input id="visualOffsetY" type="number" min="-5" max="5" step="0.5" value="0" aria-label="Desplazamiento vertical en porcentaje"></label>'
  + '<label>Barras (%) <input id="visualBars" type="number" min="0" max="10" step="1" value="0" aria-label="Altura de las barras en porcentaje"></label>'
  + '<label>Ruido visual (0-10) <input id="visualNoise" type="number" min="0" max="10" step="1" value="0" aria-label="Fuerza del ruido visual"></label>'
  + '<label>Saturación (%) <input id="visualSaturation" type="number" min="-5" max="5" step="1" value="0" aria-label="Cambio de saturación en porcentaje"></label>'
  + '<label>Contraste (%) <input id="visualContrast" type="number" min="-5" max="5" step="1" value="0" aria-label="Cambio de contraste en porcentaje"></label>'
  + '<label>Capa de color <select id="visualTint"><option value="ninguno" selected>Ninguna</option><option value="azul">Azul</option><option value="magenta">Magenta</option><option value="rojo">Rojo</option></select></label>'
  + '<label>Opacidad capa (%) <input id="visualTintOpacity" type="number" min="1" max="5" step="1" value="2" aria-label="Opacidad de la capa de color en porcentaje"></label>'
  + '<label class="visual-checkbox"><input id="visualSticker" type="checkbox"> Sticker translúcido</label>'
  + '<label>Opacidad sticker (%) <input id="visualStickerOpacity" type="number" min="1" max="15" step="1" value="6" aria-label="Opacidad del sticker en porcentaje"></label>'
  + '</div>'
  + '<span id="visualSourceLabel">Archivo: ninguno</span>'
  + '<button id="visualApply" class="btn-primary" type="button" disabled>Aplicar transformación visual (copia)</button>'
  + '<span id="visualPath">Sin salida</span>'
  + '<button id="visualCancel" class="btn-secondary" type="button" disabled>Cancelar</button>'
  + '<progress id="visualProgress" max="100" value="0"></progress>'
  + '<pre id="visualResults">Velocidad ±2% rompe la sincronía del detector; el zoom 2-5% con desplazamiento elimina los márgenes originales.</pre>';
document.querySelector('#editor-view')?.appendChild(visualPanel);
const visualSpeed = visualPanel.querySelector('#visualSpeed');
const visualZoom = visualPanel.querySelector('#visualZoom');
const visualOffsetX = visualPanel.querySelector('#visualOffsetX');
const visualOffsetY = visualPanel.querySelector('#visualOffsetY');
const visualBars = visualPanel.querySelector('#visualBars');
const visualNoise = visualPanel.querySelector('#visualNoise');
const visualSaturation = visualPanel.querySelector('#visualSaturation');
const visualContrast = visualPanel.querySelector('#visualContrast');
const visualTint = visualPanel.querySelector('#visualTint');
const visualTintOpacity = visualPanel.querySelector('#visualTintOpacity');
const visualSticker = visualPanel.querySelector('#visualSticker');
const visualStickerOpacity = visualPanel.querySelector('#visualStickerOpacity');
const visualSourceLabel = visualPanel.querySelector('#visualSourceLabel');
const visualApplyButton = visualPanel.querySelector('#visualApply');
const visualPathLabel = visualPanel.querySelector('#visualPath');
const visualCancelButton = visualPanel.querySelector('#visualCancel');
const visualProgress = visualPanel.querySelector('#visualProgress');
const visualResults = visualPanel.querySelector('#visualResults');
let visualSource = null, activeVisualJob = null;
window.SzVideoVisualLayers = { validateVisualLayersRequest, buildVideoChain, describeVisualLayers };
window.SzVideoVisualLayersUI = { setAvailable(available) { visualApplyButton.disabled = !available; } };
window.szvideo?.onVideoLayersProgress(progress => {
  if (progress.jobId && progress.jobId !== activeVisualJob) return;
  visualProgress.value = progress.percent;
  if (progress.jobId) results.textContent = `Aplicando transformación visual: ${progress.percent.toFixed(1)}%`;
});
visualCancelButton.addEventListener('click', async () => { if (activeVisualJob) await window.szvideo.cancelVideoLayers(activeVisualJob); });
visualApplyButton.addEventListener('click', () => errorManager.run(async () => {
  if (!ffmpegAvailable) throw new Error('FFmpeg no está disponible');
  if (!visualSource && playback?.clip?.source) visualSource = playback.clip.source;
  if (!visualSource) { const chosen = await window.szvideo.chooseVideo(); if (!chosen) throw new Error('Selecciona un vídeo primero'); visualSource = chosen; }
  const input = visualSource;
  visualSourceLabel.textContent = `Archivo: ${input.split(/[\\/]/).pop()}`;
  const efectos = {
    speedPercent: Number(visualSpeed.value), zoomPercent: Number(visualZoom.value),
    offsetXPercent: Number(visualOffsetX.value), offsetYPercent: Number(visualOffsetY.value),
    barsPercent: Number(visualBars.value), noiseStrength: Number(visualNoise.value),
    saturationPercent: Number(visualSaturation.value), contrastPercent: Number(visualContrast.value),
    tint: visualTint.value, tintOpacity: Number(visualTintOpacity.value),
    sticker: visualSticker.checked, stickerOpacity: Number(visualStickerOpacity.value),
  };
  if (!hasActiveEffects(efectos)) throw new Error('Selecciona al menos un efecto visual');
  const ext = (input.split(/[\\/]/).pop().split('.').pop() || '').toLowerCase();
  const output = await window.szvideo.chooseVideoLayersOutput({ input, format: ext });
  if (!output) return;
  validateVisualLayersRequest({ ...efectos, output });
  await window.szvideo.validateExportPath({ input, output });
  activeVisualJob = crypto.randomUUID();
  visualProgress.value = 0; visualApplyButton.disabled = true; visualCancelButton.disabled = false;
  try {
    const result = await window.szvideo.applyVideoLayers({ jobId: activeVisualJob, input, output, duration: playback?.clip?.duration || 0, ...efectos });
    const descripcion = describeVisualLayers(efectos);
    visualPathLabel.textContent = output;
    const size = result.bytes === undefined ? 'n/d' : `${(result.bytes / 1048576).toFixed(2)} MB`;
    visualResults.textContent = `Efectos aplicados (${size}): ${descripcion}.\nVídeo re-codificado (x264) y metadatos eliminados.\nSalida: ${output}`;
    if (window.SzVideoCase?.history) {
      window.SzVideoCase.history = appendEvidence(window.SzVideoCase.history, { type: 'video-layers', status: descripcion, path: output });
      renderCasePanel();
    }
    results.textContent = `Transformación visual aplicada: ${output} (${descripcion}).`;
  } finally {
    activeVisualJob = null; visualApplyButton.disabled = !ffmpegAvailable; visualCancelButton.disabled = true;
  }
}, 'aplicar la transformación visual'));
attachCompareButton(visualPanel, 'transformación visual', () => ({ input: visualSource || playback?.clip?.source || null, output: visualPathLabel.textContent, target: visualResults }), 'visual-comparison');

// === Preset: Evasión completa (un solo pase) ===
const stealthPanel = document.createElement('div');
stealthPanel.className = 'export-panel stealth-panel';
stealthPanel.innerHTML = '<h3>Preset: Evasión completa (un solo pase)</h3>'
  + '<div class="visual-controls-grid">'
  + `<label>Velocidad (%) <input id="stealthSpeed" type="number" min="-3" max="3" step="0.25" value="${STEALTH_PRESET.speedPercent}"></label>`
  + `<label>Zoom (%) <input id="stealthZoom" type="number" min="0" max="5" step="0.5" value="${STEALTH_PRESET.zoomPercent}"></label>`
  + `<label>Tono audio (%) <input id="stealthPitch" type="number" min="-3" max="3" step="0.25" value="${STEALTH_PRESET.pitchPercent}"></label>`
  + `<label>Volumen ruido rosa (%) <input id="stealthNoiseVolume" type="number" min="1" max="5" step="0.5" value="${STEALTH_PRESET.audioNoiseVolume}"></label>`
  + '</div>'
  + '<span id="stealthSourceLabel">Archivo: ninguno</span>'
  + '<button id="stealthApply" class="btn-primary" type="button" disabled>Aplicar preset completo (1 re-codificación)</button>'
  + '<span id="stealthPath">Sin salida</span>'
  + '<button id="stealthCancel" class="btn-secondary" type="button" disabled>Cancelar</button>'
  + '<progress id="stealthProgress" max="100" value="0"></progress>'
  + '<pre id="stealthResults">Velocidad + zoom + color + ruido visual + ruido rosa en audio + limpieza de metadatos, en una sola pasada FFmpeg.</pre>';
document.querySelector('#editor-view')?.appendChild(stealthPanel);
const stealthSpeed = stealthPanel.querySelector('#stealthSpeed');
const stealthZoom = stealthPanel.querySelector('#stealthZoom');
const stealthPitch = stealthPanel.querySelector('#stealthPitch');
const stealthNoiseVolume = stealthPanel.querySelector('#stealthNoiseVolume');
const stealthSourceLabel = stealthPanel.querySelector('#stealthSourceLabel');
const stealthApplyButton = stealthPanel.querySelector('#stealthApply');
const stealthPathLabel = stealthPanel.querySelector('#stealthPath');
const stealthCancelButton = stealthPanel.querySelector('#stealthCancel');
const stealthProgress = stealthPanel.querySelector('#stealthProgress');
const stealthResults = stealthPanel.querySelector('#stealthResults');
let stealthSource = null, activeStealthJob = null;
window.SzVideoStealth = { STEALTH_PRESET, buildStealthPresetArgs, describeStealthPreset };
window.SzVideoStealthUI = { setAvailable(available) { stealthApplyButton.disabled = !available; } };
window.szvideo?.onStealthProgress(progress => {
  if (progress.jobId && progress.jobId !== activeStealthJob) return;
  stealthProgress.value = progress.percent;
  if (progress.jobId) results.textContent = `Aplicando preset completo: ${progress.percent.toFixed(1)}%`;
});
stealthCancelButton.addEventListener('click', async () => { if (activeStealthJob) await window.szvideo.cancelStealthPreset(activeStealthJob); });
stealthApplyButton.addEventListener('click', () => errorManager.run(async () => {
  if (!ffmpegAvailable) throw new Error('FFmpeg no está disponible');
  if (!stealthSource && playback?.clip?.source) stealthSource = playback.clip.source;
  if (!stealthSource) { const chosen = await window.szvideo.chooseVideo(); if (!chosen) throw new Error('Selecciona un vídeo primero'); stealthSource = chosen; }
  const input = stealthSource;
  stealthSourceLabel.textContent = `Archivo: ${input.split(/[\\/]/).pop()}`;
  const overrides = {
    speedPercent: Number(stealthSpeed.value), zoomPercent: Number(stealthZoom.value),
    pitchPercent: Number(stealthPitch.value), audioNoiseVolume: Number(stealthNoiseVolume.value),
  };
  const ext = (input.split(/[\\/]/).pop().split('.').pop() || '').toLowerCase();
  const output = await window.szvideo.chooseStealthOutput({ input, format: ext });
  if (!output) return;
  await window.szvideo.validateExportPath({ input, output });
  activeStealthJob = crypto.randomUUID();
  stealthProgress.value = 0; stealthApplyButton.disabled = true; stealthCancelButton.disabled = false;
  try {
    const result = await window.szvideo.applyStealthPreset({ jobId: activeStealthJob, input, output, duration: playback?.clip?.duration || 0, ...overrides });
    const descripcion = describeStealthPreset({ ...STEALTH_PRESET, ...overrides });
    stealthPathLabel.textContent = output;
    const size = result.bytes === undefined ? 'n/d' : `${(result.bytes / 1048576).toFixed(2)} MB`;
    // Chequeo de compatibilidad con la subida web de TikTok Studio (duración/tamaño del archivo exportado).
    const clip = playback?.clip;
    const tiktok = validateTikTokUpload({ duration: clip?.duration ?? null, size: result.bytes ?? null });
    stealthResults.textContent = [
      `Preset aplicado (${size}) en una sola re-codificación.`,
      `Efectos: ${descripcion}`,
      `Salida: ${output}`,
      tiktok.compatible ? '✔ Compatible con TikTok Studio: listo para subir desde tiktok.com/tiktokstudio/upload.' : `✖ Ajustes antes de subir: ${tiktok.issues.join(' · ')}`,
      ...tiktok.warnings.map(w => `⚠ ${w}`),
    ].join('\n');
    if (window.SzVideoCase?.history) {
      window.SzVideoCase.history = appendEvidence(window.SzVideoCase.history, { type: 'stealth-preset', status: `${descripcion}${tiktok.compatible ? ' · TikTok Studio OK' : ' · NO compatible'}`, path: output });
      renderCasePanel();
    }
    results.textContent = `Preset TikTok Studio aplicado: ${output}.`;
  } finally {
    activeStealthJob = null; stealthApplyButton.disabled = !ffmpegAvailable; stealthCancelButton.disabled = true;
  }
}, 'aplicar el preset de evasión completa'));
async function compararHuellaPerceptual({ input, output, target, evidenceType = 'perceptual-comparison' }) {
  if (!input) throw new Error('Carga o aplica la transformación sobre un vídeo primero');
  if (!output || output === 'Sin salida') throw new Error('Aplica la transformación antes de comparar');
  target.textContent = 'Analizando huella perceptual de ambos vídeos…';
  const [originalFrame, outputFrame] = await Promise.all([analyzeFrameFromPath(input), analyzeFrameFromPath(output)]);
  const originalPerceptual = buildPerceptualRecord(originalFrame);
  const outputPerceptual = buildPerceptualRecord(outputFrame);
  const perceptual = comparePerceptualRecords(originalPerceptual, outputPerceptual);
  const outputFingerprint = await window.szvideo.fingerprint(output);
  const similitud = perceptual.similarity === null ? 'n/d' : `${(perceptual.similarity * 100).toFixed(1)}%`;
  target.textContent = [
    'Comparación original vs. salida:',
    `· Huella perceptual (frame 0): ${perceptual.status} · similitud ${similitud} · distancia Hamming ${perceptual.hammingDistance}`,
    `· Hash original: ${originalPerceptual.hash}`,
    `· Hash salida:   ${outputPerceptual.hash}`,
    `· SHA-256 salida: ${outputFingerprint.sha256.slice(0, 24)}…`,
    perceptual.status === 'similar' ? 'El vídeo sigue viéndose igual para una persona; los bytes y la huella SHA cambiaron.' : 'La salida cambió demasiado: revisa la intensidad de los efectos.',
  ].join('\n');
  if (window.SzVideoCase?.history) {
    window.SzVideoCase.history = appendEvidence(window.SzVideoCase.history, { type: evidenceType, status: `perceptual ${perceptual.status} (${similitud})`, path: output });
    renderCasePanel();
  }
  return perceptual;
}
function attachCompareButton(panel, label, getPaths, evidenceType) {
  const button = document.createElement('button');
  button.className = 'btn-secondary'; button.type = 'button';
  button.textContent = 'Comparar huella (original vs. salida)';
  panel.appendChild(button);
  button.addEventListener('click', () => errorManager.run(async () => {
    const { input, output, target } = getPaths();
    const perceptual = await compararHuellaPerceptual({ input, output, target, evidenceType });
    const similitud = perceptual.similarity === null ? 'n/d' : `${(perceptual.similarity * 100).toFixed(1)}%`;
    results.textContent = `Comparación: perceptual ${perceptual.status} · similitud ${similitud}.`;
  }, 'comparar la huella perceptual de la salida'));
  return button;
}
attachCompareButton(stealthPanel, 'preset', () => ({ input: stealthSource || playback?.clip?.source || null, output: stealthPathLabel.textContent, target: stealthResults }), 'stealth-comparison');

// === Director inteligente (LLM del core) ===
const directorPanel = document.createElement('div');
directorPanel.className = 'export-panel director-panel';
directorPanel.innerHTML = '<h3>Director inteligente (LLM del core)</h3>'
  + '<div class="visual-controls-grid">'
  + `<label>Duración del clip (s, tope 180) <input id="directorClipDuration" type="number" min="15" max="${RESOURCE_CAP_SECONDS}" step="5" value="45" aria-label="Duración objetivo de cada clip en segundos"></label>`
  + '<label>Clips máx. <input id="directorMaxClips" type="number" min="1" max="5" step="1" value="3" aria-label="Número máximo de clips"></label>'
  + '</div>'
  + '<span id="directorSourceLabel">Archivo: ninguno</span><span id="directorEngine">Motor: —</span>'
  + '<button id="directorAnalyze" class="btn-primary" type="button">Analizar vídeo y crear plan</button>'
  + '<button id="directorApplyFfmpeg" class="btn-secondary" type="button" disabled>Aplicar plan (FFmpeg)</button>'
  + '<button id="directorApplyNative" class="btn-secondary" type="button" disabled>Aplicar plan (nativo Windows)</button>'
  + '<progress id="directorProgress" max="100" value="0"></progress>'
  + `<pre id="directorResults">El núcleo analiza movimiento y cortes de escena, elige los mejores momentos (tope duro ${RESOURCE_CAP_SECONDS} s por clip) y aplica el preset de evasión borrando los metadatos y aplicando unos nuevos.</pre>`;
document.querySelector('#editor-view')?.appendChild(directorPanel);
const directorClipDuration = directorPanel.querySelector('#directorClipDuration');
const directorMaxClips = directorPanel.querySelector('#directorMaxClips');
const directorSourceLabel = directorPanel.querySelector('#directorSourceLabel');
const directorEngine = directorPanel.querySelector('#directorEngine');
const directorAnalyzeButton = directorPanel.querySelector('#directorAnalyze');
const directorApplyFfmpeg = directorPanel.querySelector('#directorApplyFfmpeg');
const directorApplyNative = directorPanel.querySelector('#directorApplyNative');
const directorProgress = directorPanel.querySelector('#directorProgress');
const directorResults = directorPanel.querySelector('#directorResults');
let directorSource = null, directorPlan = null, activeDirectorJob = null, modeloInfo = null;
window.SzVideoDirector = { createIntelligenceCore, clipOutputPath, RESOURCE_CAP_SECONDS };
const directorCore = createIntelligenceCore({
  askModel: async prompt => {
    if (!window.szvideo) return null;
    modeloInfo = await window.szvideo.askIntelligence({ prompt });
    return modeloInfo?.available ? modeloInfo.text : null;
  },
});
window.szvideo?.onStealthProgress(progress => { if (progress.jobId && progress.jobId === activeDirectorJob) directorProgress.value = progress.percent; });

function seekTo(video, time) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, 1500);
    video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
    video.currentTime = time;
  });
}
async function sampleVideoInsights(sourcePath, { maxSamples = 60, onProgress = null } = {}) {
  const video = document.createElement('video');
  video.muted = true; video.preload = 'auto';
  video.src = localMediaUrl(sourcePath);
  await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('No se pudo leer el vídeo para el análisis')); });
  const duration = video.duration || 0;
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = Math.max(2, Math.round(160 * (video.videoHeight || 90) / (video.videoWidth || 160)));
  const step = Math.max(2, duration / maxSamples);
  const samples = [];
  for (let time = 0; time < duration; time += step) {
    await seekTo(video, time);
    const frame = await VideoAnalyzer.analyzeFrame(video, canvas, Math.round(time * 30));
    samples.push({ time: Number((frame.time ?? time).toFixed(2)), hash: frame.hash });
    onProgress?.(time, duration);
  }
  video.removeAttribute('src');
  return { duration, samples };
}
async function directorSourceReady() {
  if (directorSource) return directorSource;
  if (playback?.clip?.source) { directorSource = playback.clip.source; return directorSource; }
  const chosen = await window.szvideo.chooseVideo();
  if (!chosen) throw new Error('Selecciona un vídeo primero');
  directorSource = chosen;
  return chosen;
}
directorAnalyzeButton.addEventListener('click', () => errorManager.run(async () => {
  const input = await directorSourceReady();
  directorSourceLabel.textContent = `Archivo: ${input.split(/[\\/]/).pop()}`;
  directorProgress.value = 0;
  modeloInfo = null;
  const insights = await sampleVideoInsights(input, {
    maxSamples: 60,
    onProgress: (time, duration) => {
      directorResults.textContent = `Analizando vídeo: ${time.toFixed(0)} / ${duration.toFixed(0)} s`;
      directorProgress.value = (time / duration) * 100;
    },
  });
  directorProgress.value = 0;
  directorResults.textContent = 'Creando plan de edición…';
  const nombreBase = input.split(/[\\/]/).pop();
  directorPlan = await directorCore.plan(insights, {
    clipDuration: Number(directorClipDuration.value) || 45,
    maxClips: Number(directorMaxClips.value) || 3,
    sourceName: nombreBase,
  });
  const motor = directorPlan.engine === 'model' ? `modelo local (${modeloInfo?.model || 'Ollama'})` : 'heurística local mejorada (sin IA)' + (modeloInfo?.available ? ' (plan del modelo inválido, se usó el local)' : '');
  directorEngine.textContent = `Motor: ${motor}`;
  const clasificacion = directorPlan.classification ? ` · contenido ${directorPlan.classification.type} (${directorPlan.classification.cutCount} cortes)` : '';
  directorResults.textContent = [
    `Plan (${directorPlan.engine})${clasificacion}: ${directorPlan.clips.length} clip(s) · tope ${RESOURCE_CAP_SECONDS}s por clip.`,
    ...directorPlan.clips.map((clip, index) => [
      `  ${index + 1}. ${clip.start}s → ${(clip.start + clip.duration).toFixed(0)}s (${clip.duration}s)${clip.score !== undefined ? ` · puntuación ${clip.score}` : ''}`,
      `     efectos: ${describeStealthPreset(clip.preset || directorPlan.preset)}`,
      clip.reason ? `     por qué: ${clip.reason}` : '',
      `     metadatos: ${clip.metadata?.title || directorPlan.metadata?.title}`,
    ].filter(Boolean).join('\n')),
    `Motivo: ${directorPlan.rationale}`,
  ].join('\n');
  directorApplyFfmpeg.disabled = !ffmpegAvailable;
  directorApplyNative.disabled = !describeNativeSupport().mediaRecorder || !describeNativeSupport().canvas;
  if (window.SzVideoCase?.history) {
    window.SzVideoCase.history = appendEvidence(window.SzVideoCase.history, { type: 'director-plan', status: `${directorPlan.engine} · ${directorPlan.clips.length} clips`, path: input });
    renderCasePanel();
  }
  results.textContent = `Plan creado: ${directorPlan.clips.length} clip(s) con el motor ${directorPlan.engine}.`;
}, 'crear el plan del director inteligente'));
directorApplyFfmpeg.addEventListener('click', () => errorManager.run(async () => {
  if (!directorPlan?.clips?.length) throw new Error('Crea un plan primero (Analizar vídeo)');
  if (!ffmpegAvailable) throw new Error('FFmpeg no está disponible');
  const input = directorSource;
  const outputs = [];
  for (const [index, clip] of directorPlan.clips.entries()) {
    const output = clipOutputPath(input, clip, 'stealth');
    activeDirectorJob = crypto.randomUUID();
    directorProgress.value = 0;
    results.textContent = `Clip ${index + 1}/${directorPlan.clips.length}: ${clip.start}s → aplicando preset + metadatos…`;
    try {
      await window.szvideo.applyStealthPreset({
        jobId: activeDirectorJob, input, output, duration: clip.duration, start: clip.start, seconds: clip.duration,
        metadata: clip.metadata || directorPlan.metadata,
        ...(clip.preset || directorPlan.preset),
      });
      outputs.push(output);
    } finally { activeDirectorJob = null; }
  }
  directorResults.textContent = `Clips generados en una sola re-codificación cada uno (metadatos borrados y nuevos aplicados):\n${outputs.join('\n')}`;
  results.textContent = `Plan aplicado con FFmpeg: ${outputs.length} clip(s).`;
}, 'aplicar el plan con FFmpeg'));
directorApplyNative.addEventListener('click', () => errorManager.run(async () => {
  if (!directorPlan?.clips?.length) throw new Error('Crea un plan primero (Analizar vídeo)');
  const support = describeNativeSupport();
  if (!support.mediaRecorder || !support.canvas) throw new Error('La ruta nativa requiere MediaRecorder y canvas (abre la app en Electron)');
  const input = directorSource;
  const video = document.createElement('video');
  video.src = localMediaUrl(input);
  await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('No se pudo leer el vídeo (ruta nativa)')); });
  const noiseAudio = createNoiseAudio(video, directorPlan.preset?.audioNoiseVolume ?? 2); // una vez por elemento <video>
  const outputs = [];
  try {
    for (const [index, clip] of directorPlan.clips.entries()) {
      results.textContent = `Clip nativo ${index + 1}/${directorPlan.clips.length}: grabando ${clip.duration}s…`;
      const preset = clip.preset || directorPlan.preset || {};
      setNoiseVolume(noiseAudio, preset.audioNoiseVolume ?? 2);
      const blob = await recordProcessedCopy({
        video,
        start: clip.start,
        duration: clip.duration,
        audio: noiseAudio,
        effects: {
          zoomPercent: preset.zoomPercent, offsetXPercent: preset.offsetXPercent, offsetYPercent: preset.offsetYPercent,
          barsPercent: preset.barsPercent, tint: preset.tint, tintOpacity: preset.tintOpacity,
          sticker: preset.sticker, stickerOpacity: preset.stickerOpacity,
        },
        onProgress: percent => { directorProgress.value = percent; },
      });
      const output = clipOutputPath(input, clip, 'nativo').replace(/\.[^.]+$/, '.webm');
      await window.szvideo.saveNativeOutput({ filePath: output, bytes: await blob.arrayBuffer() });
      outputs.push(output);
    }
  } finally {
    closeNoiseAudio(noiseAudio);
    video.removeAttribute('src');
  }
  directorResults.textContent = `Clips nativos (WebM · Media Foundation + canvas + WebAudio + MediaRecorder, sin FFmpeg):\n${outputs.join('\n')}\nNota: la ruta nativa graba en tiempo real y no escribe metadatos personalizados.`;
  results.textContent = `Plan aplicado con la ruta nativa: ${outputs.length} clip(s).`;
}, 'aplicar el plan con la ruta nativa'));

// === Ofuscación avanzada (dominio DCT, ruido temporal, croma, minterpolate) ===
const advancedPanel = document.createElement('div');
advancedPanel.className = 'export-panel advanced-panel';
advancedPanel.innerHTML = '<h3>Ofuscación avanzada y robustez forense</h3>'
  + '<div class="visual-controls-grid">'
  + '<label><input id="advModeDct" type="checkbox" checked> Ruido DCT (frecuencia)</label>'
  + '<label><input id="advModeSpatial" type="checkbox" checked> Ruido temporal (gaussiano)</label>'
  + '<label><input id="advModeChroma" type="checkbox" checked> Aberración cromática</label>'
  + '<label><input id="advModeTemporal" type="checkbox"> minterpolate (rompe GOP · lento)</label>'
  + '</div>'
  + '<label>Intensidad (1–10): <span id="advIntensityLabel">5</span> <input id="advIntensity" type="range" min="1" max="10" step="1" value="5" aria-label="Intensidad de la ofuscación"></label>'
  + '<label>Nivel de normalización (1–3): <input id="advNormLevel" type="number" min="1" max="3" step="1" value="2" aria-label="Nivel de filtros inversos"></label>'
  + '<span id="advancedSourceLabel">Archivo: ninguno</span>'
  + '<button id="advancedApply" class="btn-primary" type="button">Aplicar ofuscación avanzada (FFmpeg)</button>'
  + '<button id="advancedRobustez" class="btn-secondary" type="button">Prueba de robustez de la huella</button>'
  + '<button id="advancedNormalize" class="btn-secondary" type="button">Normalizar señal (filtros inversos)</button>'
  + '<progress id="advancedProgress" max="100" value="0"></progress>'
  + '<pre id="advancedResults">DCT dnoiz altera el espectro 8×8 · el ruido gaussiano temporal (Box-Muller en FFmpeg 9.0.2) destruye el vector estático · rgbashift/chromashift desplazan los canales · minterpolate re-dibuja cada frame. La prueba de robustez mide si la huella perceptual resiste estos ataques.</pre>';
document.querySelector('#editor-view')?.appendChild(advancedPanel);
const advModeDct = advancedPanel.querySelector('#advModeDct');
const advModeSpatial = advancedPanel.querySelector('#advModeSpatial');
const advModeChroma = advancedPanel.querySelector('#advModeChroma');
const advModeTemporal = advancedPanel.querySelector('#advModeTemporal');
const advIntensity = advancedPanel.querySelector('#advIntensity');
const advIntensityLabel = advancedPanel.querySelector('#advIntensityLabel');
const advNormLevel = advancedPanel.querySelector('#advNormLevel');
const advancedSourceLabel = advancedPanel.querySelector('#advancedSourceLabel');
const advancedApplyButton = advancedPanel.querySelector('#advancedApply');
const advancedRobustezButton = advancedPanel.querySelector('#advancedRobustez');
const advancedNormalizeButton = advancedPanel.querySelector('#advancedNormalize');
const advancedProgress = advancedPanel.querySelector('#advancedProgress');
const advancedResults = advancedPanel.querySelector('#advancedResults');
let advancedSource = null, activeAdvancedJob = null;
advIntensity.addEventListener('input', () => { advIntensityLabel.textContent = advIntensity.value; });
window.szvideo?.onAdvancedProgress(progress => {
  if (progress.jobId && progress.jobId !== activeAdvancedJob) return;
  advancedProgress.value = progress.percent;
  if (progress.percent === 100) advancedResults.textContent += `\n✔ ${progress.percent}% — proceso terminado.`;
});
const advancedSourceReady = async () => {
  if (advancedSource) return advancedSource;
  if (playback?.clip?.source) { advancedSource = playback.clip.source; return advancedSource; }
  const chosen = await window.szvideo.chooseVideo();
  if (!chosen) throw new Error('Selecciona un vídeo primero');
  advancedSource = chosen;
  return chosen;
};
advancedApplyButton.addEventListener('click', () => errorManager.run(async () => {
  if (!ffmpegAvailable) throw new Error('FFmpeg no está disponible');
  const input = await advancedSourceReady();
  advancedSourceLabel.textContent = `Archivo: ${input.split(/[\\/]/).pop()}`;
  const modes = [
    advModeDct.checked && 'dct', advModeSpatial.checked && 'espacial',
    advModeChroma.checked && 'croma', advModeTemporal.checked && 'temporal',
  ].filter(Boolean);
  const separator = Math.max(input.lastIndexOf('/'), input.lastIndexOf('\\'));
  const base = input.slice(0, input.lastIndexOf('.'));
  const output = `${base}-ofuscado${modes.map(m => `-${m}`).join('')}.mp4`;
  activeAdvancedJob = crypto.randomUUID();
  advancedProgress.value = 0;
  const duration = playback?.clip?.duration || 0;
  try {
    const result = await window.szvideo.applyAdvancedObfuscation({ jobId: activeAdvancedJob, input, output, duration, modes, intensity: Number(advIntensity.value), seconds: advModeTemporal.checked ? 10 : null });
    advancedResults.textContent = [
      `✔ Ofuscación aplicada (${describeAdvancedRequest({ modes, intensity: Number(advIntensity.value) })}):`,
      result.path,
      result.chain ? `Cadena aplicada: ${result.chain}` : '',
      'Metadatos originales eliminados. La huella perceptual del resultado ya no coincide con la del original.',
    ].filter(Boolean).join('\n');
    results.textContent = 'Ofuscación avanzada aplicada.';
    if (window.SzVideoCase?.history) {
      window.SzVideoCase.history = appendEvidence(window.SzVideoCase.history, { type: 'advanced-obfuscation', status: modes.join('+'), path: result.path });
      renderCasePanel();
    }
  } finally {
    activeAdvancedJob = null;
  }
}, 'aplicar la ofuscación avanzada'));
advancedRobustezButton.addEventListener('click', () => errorManager.run(async () => {
  if (!ffmpegAvailable) throw new Error('FFmpeg no está disponible (la prueba genera variantes de ataque con FFmpeg)');
  const input = await advancedSourceReady();
  advancedSourceLabel.textContent = `Archivo: ${input.split(/[\\/]/).pop()}`;
  const intensity = Number(advIntensity.value);
  const variants = buildAttackVariants({ intensity, segmentSeconds: 6 });
  const frameIndex = Math.round(3 * 30); // huella del segundo 3 de cada variante
  advancedResults.textContent = 'Midiendo la huella perceptual del original…';
  advancedProgress.value = 0;
  const original = await analyzeFrameFromPath(input, frameIndex);
  const lines = [`Robustez de la huella (intensidad ${intensity} · distancia Hamming sobre 64 bits, menor = firma intacta):`];
  for (const [index, variant] of variants.entries()) {
    const attackedPath = `${input.slice(0, input.lastIndexOf('.'))}-ataque-${variant.id}.mp4`;
    results.textContent = `Ataque ${index + 1}/${variants.length}: ${variant.label}…`;
    activeAdvancedJob = crypto.randomUUID();
    advancedProgress.value = 0;
    try {
      await window.szvideo.applyAdvancedObfuscation({
        jobId: activeAdvancedJob, input, output: attackedPath, duration: variant.seconds,
        chainOverride: variant.chain, seconds: variant.seconds,
      });
      const attacked = await analyzeFrameFromPath(attackedPath, frameIndex);
      const distance = motionScore(original.hash, attacked.hash);
      lines.push(`${distance < 0.15 ? '✔ RESISTE' : '✖ ALTERA'}  ${variant.label}: ${distance.toFixed(3)}`);
    } catch (error) {
      lines.push(`✖ ${variant.label}: ${error.message}`);
    } finally {
      activeAdvancedJob = null;
    }
  }
  lines.push('Interpretación: < 0.15 la huella perceptual sobrevive al ataque · ≥ 0.15 la alteración la rompe.');
  lines.push('Los clips de ataque quedan junto al original (-ataque-<id>.mp4) para inspección.');
  advancedResults.textContent = lines.join('\n');
  if (window.SzVideoCase?.history) {
    window.SzVideoCase.history = appendEvidence(window.SzVideoCase.history, { type: 'robustez-huella', status: `${lines.filter(l => l.includes('✔')).length}/6 ataques resistidos`, path: input });
    renderCasePanel();
  }
}, 'ejecutar la prueba de robustez'));
advancedNormalizeButton.addEventListener('click', () => errorManager.run(async () => {
  if (!ffmpegAvailable) throw new Error('FFmpeg no está disponible');
  const input = await advancedSourceReady();
  advancedSourceLabel.textContent = `Archivo: ${input.split(/[\\/]/).pop()}`;
  const level = Number(advNormLevel.value) || 2;
  const normalizedPath = `${input.slice(0, input.lastIndexOf('.'))}-normalizado.mp4`;
  activeAdvancedJob = crypto.randomUUID();
  advancedProgress.value = 0;
  const frameIndex = Math.round(3 * 30);
  try {
    await window.szvideo.normalizeSignal({ jobId: activeAdvancedJob, input, output: normalizedPath, level, normalizeGeometry: true, seconds: 12 });
    results.textContent = 'Señal normalizada: comparando huellas…';
    const [original, normalized] = await Promise.all([analyzeFrameFromPath(input, frameIndex), analyzeFrameFromPath(normalizedPath, frameIndex)]);
    const distance = motionScore(original.hash, normalized.hash);
    advancedResults.textContent = [
      `✔ Señal estabilizada (nivel ${level}: ${buildNormalizationChain({ level, normalizeGeometry: true })})`,
      `Distancia original ↔ normalizada: ${distance.toFixed(3)}`,
      distance < 0.2
        ? 'La normalización conserva la esencia del contenido: es el punto de partida estable para extraer la firma o comparar sospechosos.'
        : 'La señal cambió mucho: usa un nivel más bajo de normalización para restaurar en lugar de reescribir.',
      `Salida: ${normalizedPath}`,
    ].join('\n');
    if (window.SzVideoCase?.history) {
      window.SzVideoCase.history = appendEvidence(window.SzVideoCase.history, { type: 'normalizacion-senal', status: `nivel ${level} · distancia ${distance.toFixed(3)}`, path: normalizedPath });
      renderCasePanel();
    }
  } finally {
    activeAdvancedJob = null;
  }
}, 'normalizar la señal'));

// === Anti-blur TikTok (NoBlur): parcheo del contenedor sin re-encode + VFI opcional ===
const noblurPanel = document.createElement('div');
noblurPanel.className = 'export-panel noblur-panel';
noblurPanel.innerHTML = '<h3>Anti-blur TikTok (NoBlur)</h3>'
  + '<div class="visual-controls-grid">'
  + '<label>Modo: <select id="noblurMode" aria-label="Modo NoBlur">'
  + '<option value="legal" selected>Parche legal completo (obfuscación + NoBlur · TikTok Studio 100 %)</option>'
  + '<option value="inflate">Parche rápido (sin re-encode, segundos · calidad 100 %)</option>'
  + '<option value="vfi">VFI 60 fps + inflar (usa FFmpeg, lento)</option>'
  + '</select></label>'
  + '<label>Resolución (solo VFI): <select id="noblurResolution" aria-label="Resolución de salida">'
  + '<option value="original" selected>Original</option><option value="720p">720p</option>'
  + '<option value="1080p">1080p</option><option value="1440p">1440p</option>'
  + '</select></label>'
  + '</div>'
  + '<label>Factor de inflado (×<span id="noblurMultiplierLabel">10</span>): <input id="noblurMultiplier" type="number" min="2" max="20" step="1" value="10" aria-label="Factor de inflado"></label>'
  + '<span id="noblurSourceLabel">Archivo: ninguno</span>'
  + '<button id="noblurProcess" class="btn-primary" type="button">Parchear vídeo (salida: &lt;original&gt;-tiktok.mp4)</button>'
  + '<button id="noblurCancel" class="btn-secondary" type="button">Cancelar</button>'
  + '<progress id="noblurProgress" max="100" value="0"></progress>'
  + '<pre id="noblurResults">Parche legal completo (1 clic): primero aplica la obfuscación legal del preset (H.264 High · yuv420p · AAC · faststart) y en segundos infla el contenedor ×10. Es el equivalente al «Patch videos» de la web de NoBlur, pero con la codificación exacta que TikTok Studio espera. El modo rápido salta la obfuscación (segundos puros, sin FFmpeg).</pre>';
document.querySelector('#editor-view')?.appendChild(noblurPanel);
const noblurMode = noblurPanel.querySelector('#noblurMode');
const noblurResolution = noblurPanel.querySelector('#noblurResolution');
const noblurResolutionLabel = noblurResolution.closest('label');
const noblurMultiplier = noblurPanel.querySelector('#noblurMultiplier');
const noblurMultiplierLabel = noblurPanel.querySelector('#noblurMultiplierLabel');
const noblurSourceLabel = noblurPanel.querySelector('#noblurSourceLabel');
const noblurProcessButton = noblurPanel.querySelector('#noblurProcess');
const noblurCancelButton = noblurPanel.querySelector('#noblurCancel');
const noblurProgress = noblurPanel.querySelector('#noblurProgress');
const noblurResults = noblurPanel.querySelector('#noblurResults');
let activeNoblurJob = null;
noblurMultiplier.addEventListener('input', () => { noblurMultiplierLabel.textContent = noblurMultiplier.value; });
noblurMode.addEventListener('change', () => {
  noblurResolutionLabel.style.display = noblurMode.value === 'vfi' ? '' : 'none';
});
noblurResolutionLabel.style.display = 'none';
window.szvideo?.onNoblurProgress(progress => {
  if (progress.jobId && progress.jobId !== activeNoblurJob) return;
  noblurProgress.value = progress.percent;
});
noblurCancelButton.addEventListener('click', () => errorManager.run(async () => {
  if (!activeNoblurJob) return;
  const cancelled = await window.szvideo.cancelNoblur(activeNoblurJob);
  noblurResults.textContent = cancelled ? '✖ Proceso NoBlur cancelado.' : 'El proceso ya había terminado.';
}, 'cancelar el proceso NoBlur'));
noblurProcessButton.addEventListener('click', () => errorManager.run(async () => {
  const mode = noblurMode.value;
  if (mode === 'vfi' && !ffmpegAvailable) throw new Error('El modo VFI necesita FFmpeg (el modo Parche rápido funciona sin él)');
  if (mode === 'legal' && !ffmpegAvailable) throw new Error('El parche legal necesita FFmpeg (el modo Parche rápido funciona sin él)');
  const sourcePath = playback?.clip?.source || await window.szvideo.chooseVideo();
  if (!sourcePath) throw new Error('Selecciona un vídeo primero');
  noblurSourceLabel.textContent = `Archivo: ${sourcePath.split(/[\\/]/).pop()}`;
  const base = sourcePath.slice(0, sourcePath.lastIndexOf('.'));
  const output = mode === 'legal' ? `${base}-tiktok.mp4` : `${base}-noblur.mp4`;
  const multiplier = Math.max(2, Math.min(20, Number(noblurMultiplier.value) || 10));
  activeNoblurJob = crypto.randomUUID();
  noblurProgress.value = 0;
  noblurResults.textContent = mode === 'vfi'
    ? 'Interpolando a 60 fps (VFI)… esto puede tardar varios minutos.'
    : mode === 'legal'
      ? 'Parche legal completo: obfuscación legal + inflado del contenedor…'
      : 'Parcheando el contenedor MP4 (sin re-encode, segundos)…';
  try {
    const result = mode === 'vfi'
      ? await window.szvideo.noblurVfi({ jobId: activeNoblurJob, input: sourcePath, output, duration: playback?.clip?.duration || 0, multiplier, resolution: noblurResolution.value })
      : mode === 'legal'
        ? await window.szvideo.noblurPatch({ jobId: activeNoblurJob, input: sourcePath, output, duration: playback?.clip?.duration || 0, multiplier, legal: true })
        : await window.szvideo.noblurInflate({ jobId: activeNoblurJob, input: sourcePath, output, multiplier });
    const stats = result.stats;
    // Validación de la SALIDA contra los límites de TikTok Studio (duración/tamaño reales del archivo).
    const tiktok = validateTikTokUpload({ duration: playback?.clip?.duration ?? null, size: result.bytes ?? null });
    const modoTexto = mode === 'vfi' ? 'VFI 60 fps + inflado' : mode === 'legal' ? 'obfuscación legal + inflado' : 'inflado sin re-encode';
    noblurResults.textContent = [
      `✔ Listo (${modoTexto}):`,
      result.path,
      `Códec: ${stats.codec} · muestras reales ${stats.realSamples} + ${stats.fakeSamples} dummy (×${stats.multiplier}) = ${stats.totalSamples}`,
      `Tamaño final: ${result.bytes ? (result.bytes / 1048576).toFixed(2) + ' MB' : 'n/d'} · contenedor ${stats.normalized ? 'reordenado (moov→mdat) y marcado isom' : 'ya estaba normalizado'}`,
      tiktok.compatible
        ? '✔ 100 % compatible con TikTok Studio: súbelo desde tiktok.com/tiktokstudio/upload y marca la privacidad «Todo el mundo» antes de publicar.'
        : `✖ Antes de subir: ${tiktok.issues.join(' · ')}`,
      ...tiktok.warnings.map(w => `⚠ ${w}`),
      'Recuerda en TikTok Studio: marca «Contenido generado con IA» si aplica.',
    ].join('\n');
    results.textContent = 'NoBlur aplicado.';
    if (window.SzVideoCase?.history) {
      window.SzVideoCase.history = appendEvidence(window.SzVideoCase.history, { type: 'noblur', status: `${mode} ×${multiplier}${tiktok.compatible ? ' · TikTok Studio OK' : ''}`, path: result.path });
      renderCasePanel();
    }
  } finally {
    activeNoblurJob = null;
  }
}, 'aplicar el parche NoBlur'));

// === Salud de publicación: chequeo previo para evitar que TikTok mande el vídeo a «Solo yo» ===
const readinessPanel = document.createElement('div');
readinessPanel.className = 'export-panel readiness-panel';
readinessPanel.innerHTML = '<h3>Salud de publicación (TikTok)</h3>'
  + '<p class="readiness-intro">El estado «Solo yo» lo decide la moderación de TikTok tras la subida. Este chequeo audita los factores que la disparan (música con copyright, textos sensibles, control de audiencia, señales de manipulación) ANTES de publicar.</p>'
  + '<label>Origen del audio: <select id="readinessAudio" aria-label="Origen del audio">'
  + '<option value="propia">Audio propio / sin música</option>'
  + '<option value="tiktok" selected>Biblioteca con licencia de TikTok</option>'
  + '<option value="libre">Música libre de derechos externa</option>'
  + '<option value="comercial">Música/efectos comerciales (¡riesgo!)</option>'
  + '</select></label>'
  + '<div class="visual-controls-grid">'
  + CHECK_ITEMS.map(item => `<label><input type="checkbox" data-readiness="${item.id}"> ${item.label}</label>`).join('')
  + '</div>'
  + '<button id="readinessEvaluate" class="btn-primary" type="button">Evaluar y generar informe</button>'
  + '<pre id="readinessResults">Marca lo que ya verificaste y evalúa. La causa nº 1 de «Solo yo» automático es el audio con copyright: si es comercial, súbete el sonido desde la biblioteca con licencia de TikTok al publicar.</pre>';
document.querySelector('#editor-view')?.appendChild(readinessPanel);
const readinessAudio = readinessPanel.querySelector('#readinessAudio');
const readinessEvaluate = readinessPanel.querySelector('#readinessEvaluate');
const readinessResults = readinessPanel.querySelector('#readinessResults');
readinessEvaluate.addEventListener('click', () => errorManager.run(async () => {
  const checks = [...readinessPanel.querySelectorAll('[data-readiness]:checked')].map(input => input.dataset.readiness);
  const history = window.SzVideoCase?.history || [];
  // Señales automáticas del propio proyecto (no requieren que el usuario las marque).
  const noblurApplied = history.some(entry => entry.type === 'noblur');
  const heavyObfuscation = history.some(entry => entry.type === 'advanced-obfuscation' && /espacial|dct|croma|temporal/.test(entry.status || ''));
  const metadataClean = history.some(entry => entry.type === 'metadata' || entry.type === 'advanced-obfuscation' || entry.type === 'noblur');
  const clip = playback?.clip;
  const mediaInfo = clip ? { duration: clip.duration, size: clip.size } : null;
  const assessment = assessPublishReadiness({
    audioSource: readinessAudio.value, checks, heavyObfuscation, noblurApplied, metadataClean,
  });
  const report = buildReadinessReport(assessment, { mediaName: clip?.name || 'vídeo', mediaInfo });
  readinessResults.textContent = report;
  results.textContent = `Salud de publicación: riesgo ${assessment.level} (${assessment.score}/100).`;
  if (window.SzVideoCase?.history) {
    window.SzVideoCase.history = appendEvidence(window.SzVideoCase.history, { type: 'salud-publicacion', status: `riesgo ${assessment.level} · ${assessment.score}/100`, path: clip?.source || '' });
    renderCasePanel();
  }
}, 'evaluar la salud de publicación'));

refreshPlaybackControls();
refreshQueueControls();
refreshClipProgress();
function loadFile(file) {
  if (!file || !file.type.startsWith('video/')) return;
  video.src = URL.createObjectURL(file);
  video.onloadedmetadata = () => {
    canvas.width = Math.min(video.videoWidth, 1280);
    canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    results.textContent = `Cargado: ${file.name} · ${video.videoWidth}×${video.videoHeight} · ${video.duration.toFixed(2)} s`;
    errorManager.run(async () => { const media = await mediaAdapter.inspect(file, { name: file.name, size: file.size }); const clip = commands?.addClip('video-1', { source: media.source, name: file.name, size: file.size, duration: media.duration }); if (clip) { playback?.adoptClip(clip); refreshPlaybackControls(); refreshTimeline(); } return media; }, 'añadir el vídeo al proyecto');
  };
}

async function loadDesktopVideo() {
  if (!window.szvideo) return;
  const filePath = await window.szvideo.chooseVideo();
  if (!filePath) return;
  const fingerprint = await window.szvideo.fingerprint(filePath);
  const media = await errorManager.run(() => mediaAdapter.inspect(filePath, { name: fingerprint.name, size: fingerprint.size }), 'leer los metadatos del vídeo');
  if (!media) return;
  window.SzVideoCase = { original: fingerprint, media, integrity: buildIntegrityRecord(fingerprint, fingerprint), perceptual: null, history: [{ type: 'integrity', status: 'verified', path: fingerprint.path }], transformations: [], provenance: 'Created with SzVideo' };
  const clip = commands?.addClip('video-1', { source: filePath, name: fingerprint.name, size: fingerprint.size, duration: media.duration });
  if (clip) { playback?.loadClip(clip); refreshPlaybackControls(); refreshTimeline(); }
  const frame = await errorManager.run(() => new Promise((resolve, reject) => { video.src = localMediaUrl(filePath); video.onloadedmetadata = () => { canvas.width = Math.min(video.videoWidth, 1280); canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth); VideoAnalyzer.analyzeFrame(video, canvas, 0).then(resolve, reject); }; video.onerror = () => reject(new Error('No se pudo leer un fotograma')); }), 'calcular la huella perceptual');
  if (frame) window.SzVideoCase.perceptual = buildPerceptualRecord(frame);
  renderCasePanel();
  results.textContent = `Original: ${fingerprint.name} · ${(fingerprint.size / 1048576).toFixed(2)} MB · SHA-256: ${fingerprint.sha256}`;
  updateIntegrityStatus(window.SzVideoCase.integrity);
  renderCasePanel();
}

const integrityStatus = document.createElement('div'); integrityStatus.className = 'integrity-status'; integrityStatus.textContent = 'Autoría: sin verificar'; document.querySelector('#editor-view')?.prepend(integrityStatus);
const casePanel = document.createElement('details'); casePanel.className = 'case-panel'; casePanel.innerHTML = '<summary>Expediente de autoría</summary><pre id="caseDetails">Sin archivo cargado.</pre>'; document.querySelector('#editor-view')?.prepend(casePanel);
const caseDetails = casePanel.querySelector('#caseDetails');
function renderCasePanel() { const record = window.SzVideoCase; if (!record) { caseDetails.textContent = 'Sin archivo cargado.'; return; } caseDetails.textContent = JSON.stringify({ archivo: record.original?.name, ruta: record.original?.path, tamañoBytes: record.original?.size, sha256: record.original?.sha256, integridad: record.integrity?.status || 'unknown', huellaPerceptual: record.perceptual?.hash || null, histograma: record.perceptual?.histogram || null, duración: record.media?.duration || null, resolución: record.media?.width && record.media?.height ? `${record.media.width}x${record.media.height}` : null, backend: mediaBackend, historial: summarizeEvidence(record.history || []) }, null, 2); }
const compareButton = document.createElement('button'); compareButton.className = 'btn-secondary'; compareButton.textContent = 'Comparar otra copia'; compareButton.type = 'button'; document.querySelector('#editor-view')?.prepend(compareButton);
const compareResult = document.createElement('div'); compareResult.className = 'compare-result'; document.querySelector('#editor-view')?.prepend(compareResult);
const reportButton = document.createElement('button'); reportButton.className = 'btn-secondary'; reportButton.textContent = 'Guardar informe de copyright'; reportButton.type = 'button'; document.querySelector('#editor-view')?.prepend(reportButton);
reportButton.addEventListener('click', () => errorManager.run(async () => { const report = buildClaimReport({ caseRecord: window.SzVideoCase, comparison: window.SzVideoComparison || null, project: timeline }); const saved = await window.szvideo.saveReport(report); if (saved) results.textContent = `Informe guardado: ${saved}`; }, 'guardar el informe de copyright'));
const exportCaseButton = document.createElement('button'); exportCaseButton.className = 'btn-secondary'; exportCaseButton.textContent = 'Exportar expediente'; exportCaseButton.type = 'button'; document.querySelector('#editor-view')?.prepend(exportCaseButton);
const importCaseButton = document.createElement('button'); importCaseButton.className = 'btn-secondary'; importCaseButton.textContent = 'Importar expediente'; importCaseButton.type = 'button'; document.querySelector('#editor-view')?.prepend(importCaseButton);
exportCaseButton.addEventListener('click', () => errorManager.run(async () => { const saved = await window.szvideo.saveEvidenceCase(serializeCase({ ...window.SzVideoCase, project: { name: timeline.name, fps: timeline.fps, tracks: timeline.tracks, markers: timeline.markers } })); if (saved) results.textContent = `Expediente exportado: ${saved}`; }, 'exportar el expediente'));
importCaseButton.addEventListener('click', () => errorManager.run(async () => { const loaded = await window.szvideo.loadEvidenceCase(); if (!loaded) return; window.SzVideoCase = deserializeCase(loaded.content); if (window.SzVideoCase.project) { const document = { schema: 'szvideo-project/v1', ...window.SzVideoCase.project }; const missing = await findMissingMedia(document, source => window.szvideo.fileExists(source)); missingMediaSources = missing; await appCommands.execute('recover', JSON.stringify(document)); const firstClip = timeline.tracks.find(track => track.type === 'video')?.clips.find(clip => !missing.includes(clip.source)); if (firstClip) { selectedClipId = firstClip.id; playback?.loadClip(firstClip); } refreshPlaybackControls(); refreshTimeline(); renderMissingMedia(); results.textContent = missing.length ? `Expediente importado con advertencias: ${missing.length} medio(s) no encontrado(s).` : 'Expediente importado correctamente.'; } else results.textContent = 'Expediente importado sin timeline.'; updateIntegrityStatus(window.SzVideoCase.integrity); renderCasePanel(); }, 'importar el expediente'));
function analyzeFrameFromPath(sourcePath, frameIndex = 0) {
  return new Promise((resolve, reject) => {
    const sampleVideo = document.createElement('video');
    const sampleCanvas = document.createElement('canvas');
    sampleVideo.muted = true; sampleVideo.preload = 'metadata';
    sampleVideo.src = localMediaUrl(sourcePath);
    sampleVideo.onloadedmetadata = () => {
      sampleCanvas.width = Math.min(sampleVideo.videoWidth, 1280);
      sampleCanvas.height = Math.round(sampleCanvas.width * sampleVideo.videoHeight / sampleVideo.videoWidth);
      VideoAnalyzer.analyzeFrame(sampleVideo, sampleCanvas, frameIndex).then(resolve, reject);
    };
    sampleVideo.onerror = () => reject(new Error('No se pudo leer el vídeo para el análisis'));
    sampleVideo.load();
  });
}
compareButton.addEventListener('click', () => errorManager.run(async () => {
  const original = window.SzVideoCase?.original; const originalPerceptual = window.SzVideoCase?.perceptual;
  if (!original || !originalPerceptual) throw new Error('Carga y analiza primero el vídeo original');
  const path = await window.szvideo.chooseVideo(); if (!path) return;
  const fingerprint = await window.szvideo.fingerprint(path);
  const comparison = compareFingerprint(original, fingerprint);
  const media = await mediaAdapter.inspect(path, { name: fingerprint.name, size: fingerprint.size });
  const sample = await analyzeFrameFromPath(path);
  const perceptual = comparePerceptualRecords(originalPerceptual, buildPerceptualRecord(sample));
  window.SzVideoComparison = { sha256: comparison, perceptual, media: { width: media.width, height: media.height, duration: media.duration } };
  window.SzVideoCase.history = appendEvidence(window.SzVideoCase.history, { type: 'comparison', status: `${comparison.status}/${perceptual.status}`, path });
  renderCasePanel();
  compareResult.textContent = `Comparación: SHA-256 ${comparison.status} · perceptual ${perceptual.status} · similitud ${perceptual.similarity === null ? 'n/d' : `${(perceptual.similarity * 100).toFixed(1)}%`} · ${media.width}x${media.height}`;
}, 'comparar la copia'));
function updateIntegrityStatus(record) { integrityStatus.textContent = `Autoría: ${record?.status === 'verified' ? 'original verificado' : record?.status === 'changed' ? 'archivo modificado' : 'no disponible'}`; integrityStatus.dataset.status = record?.status || 'unknown'; }
const verifyIntegrityButton = document.createElement('button'); verifyIntegrityButton.className = 'btn-secondary'; verifyIntegrityButton.textContent = 'Verificar original'; verifyIntegrityButton.type = 'button'; document.querySelector('#editor-view')?.prepend(verifyIntegrityButton);
verifyIntegrityButton.addEventListener('click', () => errorManager.run(async () => { const original = window.SzVideoCase?.original; if (!original) throw new Error('Abre un vídeo original primero'); const current = await window.szvideo.fingerprint(original.path); const record = buildIntegrityRecord(original, current); window.SzVideoCase.integrity = record; window.SzVideoCase.history = appendEvidence(window.SzVideoCase.history, { type: 'integrity', status: record.status, path: original.path }); updateIntegrityStatus(record); renderCasePanel(); results.textContent = record.status === 'verified' ? 'El original coincide con su SHA-256.' : 'El archivo no coincide con el original registrado.'; }, 'verificar la autoría'));

fileInput?.addEventListener('change', event => loadFile(event.target.files[0]));
analyzeFileInput?.addEventListener('change', event => loadFile(event.target.files[0]));
dropZone?.addEventListener('click', () => fileInput?.click());
dropZone?.addEventListener('dragover', event => event.preventDefault());
dropZone?.addEventListener('drop', event => { event.preventDefault(); loadFile(event.dataTransfer.files[0]); });
document.querySelector('#desktopOpenBtn')?.addEventListener('click', loadDesktopVideo);

document.querySelector('#saveCaseBtn')?.addEventListener('click', async () => {
  if (!window.szvideo || !window.SzVideoCase) { results.textContent = 'Abre un vídeo original primero.'; return; }
  const saved = await window.szvideo.saveCase({ ...window.SzVideoCase, project: { name: timeline.name, fps: timeline.fps, tracks: timeline.tracks, markers: timeline.markers } });
  if (saved) results.textContent = `Expediente guardado: ${saved}`;
});

const mltButton = document.createElement('button');
mltButton.className = 'btn-primary';
mltButton.textContent = 'Exportar proyecto MLT/Shotcut';
document.querySelector('#dropZone .drop-zone-content')?.appendChild(mltButton);
mltButton.addEventListener('click', async () => {
  if (!window.szvideo || !window.SzVideoCase?.original) { results.textContent = 'Abre un vídeo original primero.'; return; }
  const xml = buildMltProject({ clips: [{ path: window.SzVideoCase.original.path, length: 0 }] });
  const saved = await window.szvideo.saveMlt(xml);
  if (saved) results.textContent = `Proyecto MLT guardado: ${saved}`;
});

const saveProjectButton = document.createElement('button');
saveProjectButton.className = 'btn-primary';
saveProjectButton.textContent = 'Guardar proyecto';
document.querySelector('#dropZone .drop-zone-content')?.appendChild(saveProjectButton);
saveProjectButton.addEventListener('click', async () => {
  if (!projectStore) return;
  try { const saved = await appCommands.execute('save'); window.szvideo.setDirty(false); if (saved) results.textContent = `Proyecto guardado: ${saved}`; }
  catch (error) { results.textContent = `No se pudo guardar: ${error.message}`; }
});

const loadProjectButton = document.createElement('button');
loadProjectButton.className = 'btn-primary';
loadProjectButton.textContent = 'Cargar proyecto';
document.querySelector('#dropZone .drop-zone-content')?.appendChild(loadProjectButton);
loadProjectButton.addEventListener('click', async () => {
  if (!projectStore) return;
  try { const loaded = await appCommands.execute('load'); if (loaded) { window.SzVideoTimeline = timeline; const missing = await refreshMissingMedia(loaded); results.textContent = missing.length ? `Proyecto cargado con advertencias: ${missing.length} medio(s) no encontrado(s).` : `Proyecto cargado: ${loaded.name}`; } }
  catch (error) { results.textContent = `No se pudo cargar: ${error.message}`; }
});

document.querySelector('#analyzeBtn')?.addEventListener('click', async () => {
  if (!video.src) { results.textContent = 'Carga un vídeo primero.'; return; }
  try {
    const frame = await VideoAnalyzer.analyzeFrame(video, canvas, 0);
    results.innerHTML = `<pre>${JSON.stringify(frame, null, 2)}</pre>`;
  } catch (error) { errorManager.report(error, 'analizar el vídeo'); }
});

document.querySelectorAll('.nav-btn').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.nav-btn').forEach(item => item.classList.remove('active'));
  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
  button.classList.add('active');
  document.querySelector(`#${button.dataset.view}-view`)?.classList.add('active');
}));

window.SzVideo = { Protector, VideoAnalyzer };
