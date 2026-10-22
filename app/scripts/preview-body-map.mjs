#!/usr/bin/env node
/**
 * 开发用:把 body-geometry.ts 里的多边形画成 SVG + PNG,肉眼检查形状有没有解析坏。
 *   node scripts/preview-body-map.mjs
 * 产物写到 scripts/.preview/(不参与构建,勿提交)。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { Resvg } = require('@resvg/resvg-js');

const SRC = resolve(HERE, '../src/pkg-exercise/muscles/body-geometry.ts');
const text = readFileSync(SRC, 'utf8');
const json = text.slice(text.indexOf('= {') + 2).replace(/;\s*$/, '');
const geo = JSON.parse(json);

const COLORS = {
  chest: '#2f7d6b',
  back: '#8a6d3b',
  shoulder: '#8a5a7a',
  arm: '#3f6f9a',
  core: '#b07a2a',
  leg: '#7a5aa0',
  calf: '#4f8a57'
};

for (const side of ['front', 'back']) {
  const s = geo[side];
  const { x, y, w, h } = s.view;
  const parts = [];
  parts.push(`<g fill="#eee9dc" stroke="#fffefa" stroke-width="3" stroke-linejoin="round">`);
  for (const p of s.inert) parts.push(poly(p));
  parts.push(`</g>`);
  parts.push(`<g fill="#ddd6c6" stroke="#fffefa" stroke-width="3" stroke-linejoin="round">`);
  for (const polys of Object.values(s.groups)) for (const p of polys) parts.push(poly(p));
  parts.push(`</g>`);
  parts.push(`<g fill-opacity="0.38" stroke="#fffefa" stroke-width="3" stroke-linejoin="round">`);
  for (const [g, polys] of Object.entries(s.groups)) {
    for (const p of polys) parts.push(poly(p, COLORS[g]));
  }
  parts.push(`</g>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fffefa"/>${parts.join('')}</svg>`;
  mkdirSync(resolve(HERE, '.preview'), { recursive: true });
  writeFileSync(resolve(HERE, `.preview/${side}.svg`), svg);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng();
  writeFileSync(resolve(HERE, `.preview/${side}.png`), png);
  console.log(`${side}: ${(png.length / 1024).toFixed(1)} KB`);
}

function poly(p, fill) {
  const pts = [];
  for (let i = 0; i < p.length; i += 2) pts.push(`${p[i]},${p[i + 1]}`);
  return `<polygon points="${pts.join(' ')}"${fill ? ` fill="${fill}"` : ''}/>`;
}
