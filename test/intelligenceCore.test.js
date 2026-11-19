import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalPlan, clipOutputPath, createIntelligenceCore, deriveClipMetadata, derivePreset, hashSeed, normalizePlan, parsePlanResponse, planArgsPreview, RESOURCE_CAP_SECONDS, seededRandom, validatePlan } from '../src/intelligenceCore.js';

const samples = [];
for (let t = 0; t <= 300; t += 5) samples.push({ time: t, hash: (t % 10 < 5 ? '11111111' : '00000000') + '000000000000000000000000' });

const insights = { samples, duration: 300 };

test('el plan local genera clips dentro de los límites', () => {
  const plan = buildLocalPlan(insights, { clipDuration: 45, maxClips: 3 });
  assert.equal(plan.engine, 'local');
  assert.ok(plan.clips.length >= 1 && plan.clips.length <= 3);
  assert.ok(plan.clips.every(clip => clip.duration <= RESOURCE_CAP_SECONDS && clip.duration >= 5));
  validatePlan(plan);
  const args = planArgsPreview(plan);
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
  assert.equal(args[args.indexOf('-map_metadata') + 1], '-1');
  const metadataIndex = args.indexOf('-metadata');
  assert.equal(args[metadataIndex + 1].startsWith('title='), true);
});

test('extrae y normaliza el JSON del modelo aunque venga con texto alrededor', () => {
  const respuesta = 'Claro, aquí va el plan:\n```json\n{"clips":[{"startSeconds":10,"seconds":60}],"preset":{"speedPercent":1},"metadata":{"title":"Clip dinámico"},"rationale":"Los primeros segundos tienen más acción."}\n```';
  const plan = normalizePlan(parsePlanResponse(respuesta));
  assert.equal(plan.engine, 'model');
  assert.deepEqual(plan.clips, [{ start: 10, duration: 60 }]);
  assert.equal(plan.preset.speedPercent, 1);
  assert.equal(plan.metadata.title, 'Clip dinámico');
  assert.equal(parsePlanResponse('sin json aquí'), null);
  assert.equal(parsePlanResponse(null), null);
  assert.equal(parsePlanResponse('{json roto'), null);
});

test('recorta los clips del modelo al tope de 180 s y los filtra', () => {
  const plan = normalizePlan(parsePlanResponse('{"clips":[{"start":0,"duration":600},{"start":-5,"duration":30},{"start":100}]}'));
  assert.equal(plan.clips.length, 2); // el de start negativo se descarta
  assert.equal(plan.clips[0].duration, RESOURCE_CAP_SECONDS);
  assert.equal(plan.clips[1].duration, 45); // valor por defecto
});

test('rechaza planes con efectos fuera de rango y cae al plan local', () => {
  const loco = normalizePlan({ clips: [{ start: 0, duration: 30 }], preset: { speedPercent: 50 } });
  assert.throws(() => validatePlan(loco), /velocidad/);
  let fallbackUsed = false;
  const core = createIntelligenceCore({
    async askModel() { fallbackUsed = true; return '{"clips":[{"start":0,"duration":30}],"preset":{"speedPercent":900}}'; },
    clipDuration: 45,
    maxClips: 3,
  });
  return core.plan(insights).then(plan => {
    assert.equal(fallbackUsed, true);
    assert.equal(plan.engine, 'local'); // el plan del modelo era inválido → heurística local
    validatePlan(plan);
  });
});

test('usa el modelo cuando propone un plan válido', () => {
  const core = createIntelligenceCore({
    async askModel() { return '{"clips":[{"start":30,"duration":90}],"preset":{"speedPercent":2,"zoomPercent":3},"metadata":{"title":"Top"},"rationale":"r"}'; },
  });
  return core.plan(insights).then(plan => {
    assert.equal(plan.engine, 'model');
    assert.equal(plan.clips[0].duration, 90);
    validatePlan(plan);
  });
});

test('funciona sin proveedor de modelo', () => {
  const core = createIntelligenceCore({});
  return core.plan(insights).then(plan => {
    assert.equal(plan.engine, 'local');
    assert.ok(plan.clips.length >= 1);
  });
});

test('acepta clipDuration/maxClips al planificar (no solo al crear el core)', () => {
  const core = createIntelligenceCore({});
  return core.plan(insights, { clipDuration: 15, maxClips: 2 }).then(plan => {
    assert.equal(plan.engine, 'local');
    assert.equal(plan.clips.length, 2);
    assert.ok(plan.clips.every(clip => clip.duration <= 15));
    validatePlan(plan);
  });
});

test('rutas de salida automáticas por clip', () => {
  assert.equal(clipOutputPath('C:\\v\\dia.mp4', { start: 30 }), 'C:\\v\\dia-stealth-clip30s.mp4');
  assert.equal(clipOutputPath('/v/dia.webm', { start: 5 }), '/v/dia-stealth-clip5s.webm');
});

test('hashSeed y seededRandom son deterministas', () => {
  assert.equal(hashSeed('mivideo.mp4'), hashSeed('mivideo.mp4'));
  assert.notEqual(hashSeed('a'), hashSeed('b'));
  const rngA = seededRandom(42);
  const rngB = seededRandom(42);
  assert.deepEqual(Array.from({ length: 5 }, () => rngA()), Array.from({ length: 5 }, () => rngB()));
  const rngC = seededRandom(43);
  assert.notDeepEqual(Array.from({ length: 5 }, () => rngA()), Array.from({ length: 5 }, () => rngC()));
});

test('el preset adaptativo siempre pasa la validación dura', () => {
  for (const type of ['estático', 'medio', 'dinámico']) {
    for (let variation = -1; variation < 8; variation += 1) {
      const preset = derivePreset({ type }, { seed: 7, variation });
      assert.doesNotThrow(() => validatePlan({ clips: [{ start: 0, duration: 30 }], preset }));
      // Rangos imperceptibles garantizados
      assert.ok(preset.zoomPercent >= 0 && preset.zoomPercent <= 5);
      assert.ok(Math.abs(preset.offsetXPercent) <= 2 && preset.offsetYPercent <= 2);
      assert.ok(preset.pitchPercent >= -3 && preset.pitchPercent <= 3 && preset.pitchPercent !== 0);
      assert.ok(preset.audioNoiseVolume > 0 && preset.audioNoiseVolume <= 5);
    }
  }
});

test('cada clip recibe una variación única pero reproducible', () => {
  const classification = { type: 'medio' };
  const uno = derivePreset(classification, { seed: hashSeed('dia.mp4'), variation: 0 });
  const dos = derivePreset(classification, { seed: hashSeed('dia.mp4'), variation: 1 });
  const repetido = derivePreset(classification, { seed: hashSeed('dia.mp4'), variation: 0 });
  assert.deepEqual(uno, repetido); // determinista
  assert.notDeepEqual(uno, dos); // variado por clip
});

test('los metadatos se derivan del nombre del original y son únicos por clip', () => {
  const primero = deriveClipMetadata('vacaciones_2024.mp4', { start: 10, duration: 45 }, 0);
  const segundo = deriveClipMetadata('vacaciones_2024.mp4', { start: 60, duration: 45 }, 1);
  assert.equal(primero.title, 'vacaciones 2024 · clip 1');
  assert.equal(segundo.title, 'vacaciones 2024 · clip 2');
  assert.equal(primero.copyright, 'All rights reserved');
  assert.match(primero.comment, /45s desde 10s/);
  assert.notEqual(primero.title, segundo.title);
  assert.equal(deriveClipMetadata('', { duration: 45 }, 0).title, 'SzVideo clip · clip 1');
});

test('el plan local ahora clasifica, adapta y explica cada clip', () => {
  const plan = buildLocalPlan(insights, { clipDuration: 45, maxClips: 3, sourceName: 'viaje.mp4' });
  assert.equal(plan.engine, 'local');
  assert.ok(['estático', 'medio', 'dinámico'].includes(plan.classification.type));
  assert.ok(plan.clips.length >= 1);
  for (const clip of plan.clips) {
    assert.ok(clip.preset, 'preset por clip');
    assert.ok(clip.metadata.title.startsWith('viaje · clip'));
    assert.match(clip.reason, /Elegido por puntuación/);
  }
  assert.match(plan.rationale, /sin IA/);
  assert.match(plan.rationale, new RegExp(`contenido ${plan.classification.type}`));
  validatePlan(plan); // presets por clip incluidos
  const args = planArgsPreview(plan, 'viaje.mp4');
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
  const metadataIndex = args.indexOf('-metadata');
  assert.equal(args[metadataIndex + 1].startsWith('title='), true);
});

test('el mismo vídeo produce el mismo plan exacto (sin IA externa)', () => {
  const planA = buildLocalPlan(insights, { clipDuration: 45, maxClips: 3, sourceName: 'viaje.mp4' });
  const planB = buildLocalPlan(insights, { clipDuration: 45, maxClips: 3, sourceName: 'viaje.mp4' });
  assert.deepEqual(planA, planB);
  const otro = buildLocalPlan(insights, { clipDuration: 45, maxClips: 3, sourceName: 'otro.mp4' });
  assert.notDeepEqual(planA.preset, otro.preset); // la semilla cambia con el nombre
});
