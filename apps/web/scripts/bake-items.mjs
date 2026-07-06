import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const OUT = '/Users/marvy/Documents/HACK/Valor/apps/web/public/items';
mkdirSync(OUT, { recursive: true });

const ASSETS = [
  'gun_sidearm', 'gun_smg', 'gun_assault_rifle', 'gun_marksman', 'gun_legendary',
  'shield', 'ammo_standard', 'ammo_incendiary', 'optic', 'barrel', 'grip', 'magazine', 'booster',
];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

for (const asset of ASSETS) {
  await page.goto(`http://localhost:3100/dev/bake-items?asset=${asset}`, { waitUntil: 'domcontentloaded' });
  const canvas = await page.waitForSelector('canvas', { timeout: 60000 });
  await page.waitForTimeout(1400); // let lighting/first frames settle
  await canvas.screenshot({ path: `${OUT}/${asset}.png`, omitBackground: true });
  console.log('baked', asset);
}

await browser.close();
console.log('DONE');
