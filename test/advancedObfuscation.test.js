import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADVANCED_MODES, MAX_INTENSITY, MIN_INTENSITY,
  buildAdvancedChain, buildAdvancedObfuscationArgs, buildAttackVariants,
  buildChromaChain, buildDctChain, buildNormalizationArgs, buildNormalizationChain,
  buildSpatialChain, buildTemporalChain, clampIntensity, describeAdvancedRequest,
  validateAdvancedRequest,
} from '../src/advancedObfuscation.js';

test('clampIntensity valida el rango 1..10', () => {
  assert.equal(clampIntensity(1), 1);
  assert.equal(clampIntensity(10), 10);
  assert.equal(clampIntensity(5.4), 5); // redondea
  assert.throws(() => clampIntensity(0), /intensidad/);
  assert.throws(() => clampIntensity(11), /intensidad/);
  assert.throws(() => clampIntensity('x'), /intensidad/);
});

test('dctdnoiz: sigma crece con la intensidad y n=3 son bloques 8×8', () => {
  const bajo = buildDctChain({ intensity: 1 });
  const alto = buildDctChain({ intensity: 10 });
  assert.match(bajo, /dctdnoiz=sigma=0\.6:n=3/);
  assert.match(alto, /dctdnoiz=sigma=3\.75:n=3/);
  assert.notEqual(bajo, alto);
});

test('noise: ruido temporal gaussiano por defecto (Box-Muller, FFmpeg 9.0.2) y uniforme con flag u', () => {
  const gaussiano = buildSpatialChain({ intensity: 5 });
  assert.match(gaussiano, /noise=alls=\d+:allf=t$/); // sin «u» → gaussiano (default)
  const uniforme = buildSpatialChain({ intensity: 5, gaussian: false });
  assert.match(uniforme, /allf=t\+u/);
  const fuerzaBaja = Number(buildSpatialChain({ intensity: 1 }).match(/alls=(\d+)/)[1]);
  const fuerzaAlta = Number(buildSpatialChain({ intensity: 10 }).match(/alls=(\d+)/)[1]);
  assert.ok(fuerzaBaja < fuerzaAlta && fuerzaAlta <= 15); // sutil pero creciente
});

test('croma: rgbashift 1px (bajo) y 2px + chromashift U/V (alto)', () => {
  const bajo = buildChromaChain({ intensity: 3 });
  assert.match(bajo, /rgbashift=rh=1:rv=0:bh=-1:bv=0:edge=smear/);
  assert.ok(!bajo.includes('chromashift'));
  const alto = buildChromaChain({ intensity: 9 });
  assert.match(alto, /rgbashift=rh=2:rv=1:bh=-2:bv=-1:edge=smear/);
  assert.match(alto, /chromashift=cbh=1:cbv=-1:crh=-1:crv=1:edge=smear/); // cbh/cbv/crh/crv, no cbx
});

test('minterpolate: aobmc + bidir + mci (no «aob»), vsbmc solo en intensidad alta', () => {
  const bajo = buildTemporalChain({ intensity: 4 });
  assert.match(bajo, /minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=0/);
  const alto = buildTemporalChain({ intensity: 9 });
  assert.match(alto, /fps=29/); // desincronía del contenedor
  assert.match(alto, /vsbmc=1/);
});

test('cadena combinada y descripción legible', () => {
  const chain = buildAdvancedChain(['dct', 'espacial'], { intensity: 5 });
  assert.equal(chain.split(',').length, 2);
  assert.throws(() => buildAdvancedChain(['quantum']), /no soportado/);
  assert.match(describeAdvancedRequest({ modes: ['dct', 'croma'] }), /DCT\/frecuencia \+ aberración cromática/);
});

test('argumentos FFmpeg completos: un pase, metadatos borrados y nuevos aplicados', () => {
  const args = buildAdvancedObfuscationArgs({
    input: 'in.mp4', output: 'out.mp4', modes: ['espacial', 'croma'], intensity: 7,
    start: 10, seconds: 6, metadata: { title: 'Prueba' },
  });
  assert.equal(args[3], '-ss');
  assert.equal(args[6], 'in.mp4');
  const chainIndex = args.indexOf('-filter_complex');
  assert.equal(args[chainIndex + 1], '[0:v]noise=alls=11:allf=t,rgbashift=rh=1:rv=0:bh=-1:bv=0:edge=smear,chromashift=cbh=1:cbv=-1:crh=-1:crv=1:edge=smear[v]');
  assert.equal(args[args.indexOf('-map_metadata') + 1], '-1');
  const metaIndex = args.indexOf('-metadata');
  assert.equal(args[metaIndex + 1], 'title=Prueba');
  assert.ok(args.includes('-c:a', 'copy') || args.includes('copy'));
  assert.equal(args[args.length - 1], 'out.mp4');
});

test('validación dura del request', () => {
  assert.throws(() => validateAdvancedRequest({ input: 'a', output: 'b', modes: [] }), /al menos un modo/);
  assert.throws(() => validateAdvancedRequest({ input: 'a', output: 'b', modes: ['dct'], intensity: 99 }), /intensidad/);
  assert.throws(() => validateAdvancedRequest({ input: 'a', output: 'b', modes: ['dct'], fps: 0 }), /FPS/);
  assert.equal(validateAdvancedRequest({ input: 'a', output: 'b', modes: ['dct', 'temporal'], intensity: 5, fps: 30 }), true);
});

test('normalización: filtros inversos por nivel y geometría normalizada', () => {
  const nivel1 = buildNormalizationChain({ level: 1, normalizeGeometry: false });
  assert.match(nivel1, /hqdn3d/);
  assert.ok(!nivel1.includes('atadenoise'));
  const nivel2 = buildNormalizationChain({ level: 2, normalizeGeometry: false });
  assert.match(nivel2, /atadenoise/);
  assert.match(nivel2, /dctdnoiz=sigma=1\.5/);
  const nivel3 = buildNormalizationChain({ level: 3 });
  assert.match(nivel3, /deband/);
  assert.match(nivel3, /scale=256:-2:flags=lanczos$/);
  const args = buildNormalizationArgs({ input: 'a.mp4', output: 'b.mp4', level: 2 });
  assert.equal(args[args.indexOf('-map_metadata') + 1], '-1');
  assert.ok(args.includes('-an'));
});

test('variantes de ataque para la prueba de robustez', () => {
  const variants = buildAttackVariants({ intensity: 5, segmentSeconds: 6 });
  assert.equal(variants.length, 6);
  assert.ok(variants.every(v => v.seconds === 6 && v.chain.length > 5));
  assert.deepEqual(variants.map(v => v.id), ['cromatica', 'dct', 'ruidoTemporal', 'geometrico', 'velocidad', 'minterpolate']);
  assert.equal(buildAttackVariants({ intensity: MAX_INTENSITY }).length, 6);
  assert.equal(MIN_INTENSITY, 1);
  assert.ok(ADVANCED_MODES.length === 4);
});
