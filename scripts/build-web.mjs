/** Copia los módulos puros necesarios a web/ para el despliegue estático (Vercel / GitHub Pages).
 *  Regenerar: npm run build:web
 */
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const webDir = path.join(root, 'web');
const srcDir = path.join(root, 'src');

await mkdir(webDir, { recursive: true });

const modules = ['mp4Patch.js', 'publishReadiness.js'];

for (const mod of modules) {
  await copyFile(path.join(srcDir, mod), path.join(webDir, mod));
  console.log(`web/${mod} actualizado desde src/${mod}`);
}

console.log('Build web listo. Despliega la carpeta web/ en Vercel.');
