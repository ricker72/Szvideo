import test from 'node:test';
import assert from 'node:assert/strict';
import { localMediaUrl } from '../src/localMediaUrl.js';

test('las rutas locales pasan por el endpoint /local-media del servidor interno', () => {
  assert.equal(localMediaUrl('C:\\v\\dia.mp4'), '/local-media?path=C%3A%5Cv%5Cdia.mp4');
  assert.equal(localMediaUrl('/home/usuario/día.webm'), '/local-media?path=%2Fhome%2Fusuario%2Fd%C3%ADa.webm');
  assert.equal(localMediaUrl('C:\\v\\mi vídeo.mp4'), '/local-media?path=C%3A%5Cv%5Cmi%20v%C3%ADdeo.mp4');
});

test('las URLs que ya lo son se devuelven intactas', () => {
  assert.equal(localMediaUrl('blob:http://127.0.0.1/x'), 'blob:http://127.0.0.1/x');
  assert.equal(localMediaUrl('https://ejemplo.com/v.mp4'), 'https://ejemplo.com/v.mp4');
  assert.equal(localMediaUrl('http://127.0.0.1:5000/local-media?path=x'), 'http://127.0.0.1:5000/local-media?path=x');
  assert.equal(localMediaUrl('file:///C:/v/a.mp4'), 'file:///C:/v/a.mp4');
  assert.equal(localMediaUrl('data:video/mp4;base64,AAAA'), 'data:video/mp4;base64,AAAA');
  assert.equal(localMediaUrl(''), '');
  assert.equal(localMediaUrl(null), '');
});

test('la URL resultante sigue conteniendo el nombre del fichero (compatible con los tests de reproducción)', () => {
  assert.match(localMediaUrl('C:\\media\\sample.mp4'), /sample\.mp4/);
  assert.match(localMediaUrl('C:\\media\\original.mp4'), /original\.mp4/);
});
