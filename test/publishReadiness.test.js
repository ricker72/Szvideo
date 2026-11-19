import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_SOURCES, CHECK_ITEMS, assessPublishReadiness, buildReadinessReport, normalizeAnswers } from '../src/publishReadiness.js';

test('normalizeAnswers sanea entradas inválidas de forma determinista', () => {
  const answers = normalizeAnswers({ audioSource: 'cuántica', checks: ['notificaciones', 'inventado'], heavyObfuscation: 1 });
  assert.equal(answers.audioSource, 'propia'); // inválida → default
  assert.deepEqual(answers.checks, ['notificaciones']); // ids desconocidos descartados
  assert.equal(answers.heavyObfuscation, true);
  assert.equal(AUDIO_SOURCES.length, 4);
  assert.equal(CHECK_ITEMS.length, 8);
});

test('todo en orden → riesgo bajo sin penalizaciones', () => {
  const result = assessPublishReadiness({
    audioSource: 'tiktok',
    checks: CHECK_ITEMS.map(i => i.id),
    metadataClean: true,
  });
  assert.equal(result.score, 100);
  assert.equal(result.level, 'bajo');
  assert.deepEqual(result.risks, []);
});

test('música comercial con copyright: la causa nº 1 de «Solo yo» penaliza fuerte', () => {
  const result = assessPublishReadiness({ audioSource: 'comercial', checks: CHECK_ITEMS.map(i => i.id) });
  assert.equal(result.score, 55);
  assert.equal(result.level, 'alto');
  assert.ok(result.risks.some(r => r.id === 'copyright-audio' && r.severity === 'alta'));
  assert.ok(result.recommendations.some(r => /biblioteca con licencia/i.test(r)));
});

test('ítems sin verificar restan 8 puntos cada uno y aparecen como riesgo medio', () => {
  const result = assessPublishReadiness({ audioSource: 'propia', checks: [] });
  assert.equal(result.score, 100 - 8 * 8);
  assert.equal(result.risks.length, 8);
  assert.ok(result.risks.every(r => r.severity === 'media'));
});

test('ofuscación agresiva: señal de manipulación que sube la prioridad de revisión', () => {
  const limpio = assessPublishReadiness({ audioSource: 'propia', checks: CHECK_ITEMS.map(i => i.id) });
  const ofuscado = assessPublishReadiness({ audioSource: 'propia', checks: CHECK_ITEMS.map(i => i.id), heavyObfuscation: true });
  assert.equal(limpio.score, 100);
  assert.equal(ofuscado.score, 85);
  assert.ok(ofuscado.risks.some(r => r.id === 'obfuscacion-agresiva'));
  assert.ok(ofuscado.recommendations.some(r => /NoBlur sin re-encode/.test(r)));
});

test('metadatos sucios restan y recomiendan la limpieza de SzVideo', () => {
  const result = assessPublishReadiness({ audioSource: 'propia', checks: CHECK_ITEMS.map(i => i.id), metadataClean: false });
  assert.equal(result.score, 90);
  assert.ok(result.risks.some(r => r.id === 'metadatos'));
  assert.ok(result.recommendations.some(r => /limpieza de metadatos/i.test(r)));
});

test('score nunca sale del rango 0–100 incluso combinando todo lo malo', () => {
  const result = assessPublishReadiness({ audioSource: 'comercial', checks: [], heavyObfuscation: true, metadataClean: false });
  assert.equal(result.score, 0);
  assert.equal(result.level, 'alto');
});

test('el informe es legible y contiene las secciones clave', () => {
  const report = buildReadinessReport(assessPublishReadiness({ audioSource: 'comercial', checks: ['notificaciones'] }), { mediaName: 'clip.mp4', mediaInfo: { duration: 42.5, size: 24 * 1048576 } });
  assert.match(report, /SALUD DE PUBLICACIÓN — clip\.mp4/);
  assert.match(report, /ALTO \(\d+\/100\)/);
  assert.match(report, /42\.5 s/);
  assert.match(report, /Riesgos detectados/);
  assert.match(report, /Recomendaciones antes de publicar/);
  assert.match(report, /Todo el mundo/);
  const vacio = buildReadinessReport(assessPublishReadiness({ audioSource: 'propia', checks: CHECK_ITEMS.map(i => i.id) }));
  assert.match(vacio, /Sin riesgos detectados/);
});
