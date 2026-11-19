/** Genera build/icon.png (256x256 RGBA) sin dependencias: logotipo SzVideo
 *  — cuadrado redondeado oscuro con triángulo de reproducción cian. */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 256;
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const inside = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

const pixels = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y += 1) {
  pixels[y * (SIZE * 4 + 1)] = 0; // filtro: none
  for (let x = 0; x < SIZE; x += 1) {
    const i = y * (SIZE * 4 + 1) + 1 + x * 4;
    // Borde redondeado: esquinas fuera de una super-elipse → transparentes.
    const margin = inside(x, y, 128, 128, 108, 108) && inside(Math.min(x, 255 - x), Math.min(y, 255 - y) * 4, 0, 0, 1, 1);
    const rounded = inside(x, y, 128, 128, 106, 106);
    // Recorte de esquinas: distancia a la caja redondeada (radio 56)
    const bx = Math.min(Math.max(x, 56), 200);
    const by = Math.min(Math.max(y, 56), 200);
    const dx = x - bx, dy = y - by;
    const corner = dx * dx + dy * dy <= 56 * 56 || (x >= 56 && x <= 200) || (y >= 56 && y <= 200);
    if (!rounded || !corner) { pixels[i + 3] = 0; continue; }
    // Fondo: degradado oscuro vertical (#0f172a → #1e293b)
    const t = y / SIZE;
    let r = Math.round(15 + t * 15), g = Math.round(23 + t * 18), b = Math.round(42 + t * 17);
    // Aro cian
    const ring = inside(x, y, 128, 128, 88, 88) && !inside(x, y, 128, 128, 76, 76);
    if (ring) { r = 6; g = 182; b = 212; }
    // Triángulo de reproducción (apunta a la derecha), centrado
    const tx = x - 112, ty = y - 128;
    const inTriangle = tx >= 0 && tx <= 64 && Math.abs(ty) <= 40 * (1 - tx / 64) && tx > 4;
    if (inTriangle) { r = 103; g = 232; b = 249; }
    pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(pixels)),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`Icono creado: ${out} (${png.length} bytes)`);
