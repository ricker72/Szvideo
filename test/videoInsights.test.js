import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyContent, findSceneCuts, motionScore, scoreTimeline, selectBestMoments, summarizeInsights, RESOURCE_CAP_SECONDS } from '../src/videoInsights.js';

function hashOf(bits) { return bits; }

const samples = [];
for (let t = 0; t <= 100; t += 5) samples.push({ time: t, hash: (Math.floor(t / 25) % 2 ? '1'.repeat(64) : '0'.repeat(64)) });

test('calcula el movimiento entre hashes (0..1)', () => {
  assert.equal(motionScore(null, 'x'), 0);
  assert.equal(motionScore('0101', '0101'), 0);
  assert.equal(motionScore('0101', '1010'), 1);
  assert.equal(motionScore('0000', '1000'), 0.25);
});

test('puntúa la línea de tiempo y detecta cortes de escena', () => {
  const scored = scoreTimeline(samples);
  assert.equal(scored.length, samples.length);
  assert.equal(scored[0].motion, 0);
  assert.equal(findSceneCuts(scored, 0.5).length, 4); // cortes en 25s, 50s, 75s y 100s
  assert.deepEqual(findSceneCuts(scored, 1.01), []);
});

test('selecciona los mejores momentos sin solaparse y dentro del tope', () => {
  const scored = scoreTimeline(samples);
  const clips = selectBestMoments(scored, { clipDuration: 45, maxClips: 2 });
  assert.equal(clips.length, 2);
  for (const clip of clips) {
    assert.ok(clip.duration <= RESOURCE_CAP_SECONDS);
    assert.ok(clip.duration >= 5);
  }
  assert.equal(clips[0].start < clips[1].start, true); // ordenados por tiempo
  const solapan = clips[0].start < clips[1].start + clips[1].duration && clips[1].start < clips[0].start + clips[0].duration;
  assert.equal(solapan, false);
  // Las ventanas con más movimiento acumulado ganan: [10,55) y luego la mejor no solapada
  assert.equal(clips[0].start, 10);
  assert.equal(clips[1].start, 60);
});

test('recorta el clip al final del vídeo y respeta el máximo de clips', () => {
  const corto = scoreTimeline([{ time: 0, hash: '0000' }, { time: 10, hash: '1111' }]);
  const clips = selectBestMoments(corto, { clipDuration: 45, maxClips: 3 });
  assert.equal(clips.length, 1);
  assert.equal(clips[0].duration, 10);
  assert.equal(selectBestMoments([], {}).length, 0);
});

test('el tope duro de 180 s nunca se supera', () => {
  const largo = [];
  for (let t = 0; t <= 600; t += 5) largo.push({ time: t, hash: (t % 2 ? '1111' : '0000') + '000000000000' });
  const clips = selectBestMoments(scoreTimeline(largo), { clipDuration: 45, maxClips: 5, capSeconds: RESOURCE_CAP_SECONDS });
  assert.ok(clips.every(clip => clip.duration <= 180));
});

test('resume el análisis en una línea compacta', () => {
  const resumen = summarizeInsights({ samples, duration: 35 });
  assert.match(resumen, /duration=35\.0s/);
  assert.match(resumen, /samples=21/);
  assert.match(resumen, /sceneCuts=\d+/);
  assert.match(resumen, /hottestTimes=\[/);
});

test('clasifica el contenido: estático, medio o dinámico', () => {
  const same = '01010101010101010101010101010101';
  const estatico = classifyContent(scoreTimeline([{ time: 0, hash: same }, { time: 30, hash: same }, { time: 60, hash: same }]));
  assert.equal(estatico.type, 'estático');
  assert.equal(estatico.avgMotion, 0);
  assert.equal(estatico.cutCount, 0);

  const dinamico = classifyContent(scoreTimeline(samples)); // 4 cortes en 100 s
  assert.equal(dinamico.type, 'dinámico');
  assert.ok(dinamico.avgMotion > 0.12);
  assert.equal(dinamico.cutCount, 4);
  assert.ok(dinamico.cutsPerMinute > 2); // ~2.4 cortes/min
  assert.ok(dinamico.activityIndex > 0 && dinamico.activityIndex <= 1);

  const medio = classifyContent(scoreTimeline([
    { time: 0, hash: '0'.repeat(64) },
    { time: 10, hash: '0'.repeat(56) + '1'.repeat(8) }, // motion 0.125
    { time: 20, hash: '0'.repeat(64) },                 // motion 0.125
    { time: 30, hash: '0'.repeat(64) },
  ]));
  assert.equal(medio.type, 'medio'); // media 0.0625 ∈ [0.04, 0.12)
  assert.equal(classifyContent([]).type, 'estático'); // vacío = estático (inofensivo)
});
