/** Convierte una ruta local en una URL reproducible desde la página (mismo origen).
 *  En Electron la UI se sirve por HTTP local: Chromium bloquea cargar `file:///`
 *  desde un origen `http://`, así que las rutas pasan por el endpoint
 *  `/local-media` del servidor interno de la app. */

const ABSOLUTE_URL = /^(blob|data|https?|file):/i;

export function localMediaUrl(source) {
  const value = String(source ?? '');
  if (!value || ABSOLUTE_URL.test(value)) return value;
  return `/local-media?path=${encodeURIComponent(value)}`;
}
