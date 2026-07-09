// Renders the brand SVGs into the PNG icon set WXT picks up automatically
// from src/public/icon/{size}.png. Run: npm run icons
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src', 'public', 'icon');

// The small mark keeps detail legible at toolbar sizes; the full logo is used
// for management pages and the web store.
const PLAN = [
  { size: 16, source: 'logo-small.svg' },
  { size: 32, source: 'logo-small.svg' },
  { size: 48, source: 'logo.svg' },
  { size: 96, source: 'logo.svg' },
  { size: 128, source: 'logo.svg' },
];

await mkdir(outDir, { recursive: true });

for (const { size, source } of PLAN) {
  const svg = await readFile(join(root, 'src', 'brand', source), 'utf8');
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  const file = join(outDir, `${size}.png`);
  await writeFile(file, png);
  console.log(`icon/${size}.png  (${png.length} bytes, from ${source})`);
}

console.log('Done.');
