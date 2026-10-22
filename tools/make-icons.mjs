// Renders the app icon (SVG below) to the PNG sizes the manifest and iOS need. Run: node tools/make-icons.mjs
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const OUT = fileURLToPath(new URL('../icons/', import.meta.url));

// Crosshair over a face silhouette, green on black. Full-bleed square; iOS rounds the corners itself.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#000"/>
  <circle cx="256" cy="226" r="62" fill="#1f2937"/>
  <path d="M146 392c14-58 58-92 110-92s96 34 110 92" fill="#1f2937"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="#22c55e" stroke-width="26"/>
  <g stroke="#22c55e" stroke-width="26" stroke-linecap="round">
    <line x1="256" y1="60" x2="256" y2="150"/><line x1="256" y1="362" x2="256" y2="452"/>
    <line x1="60" y1="256" x2="150" y2="256"/><line x1="362" y1="256" x2="452" y2="256"/>
  </g>
  <circle cx="256" cy="256" r="14" fill="#22c55e"/>
</svg>`;

const browser = await chromium.launch();
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: OUT + name });
  await page.close();
}
await browser.close();
console.log('icons written to', OUT);
