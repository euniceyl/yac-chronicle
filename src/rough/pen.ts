import rough from 'roughjs';
import type { Options } from 'roughjs/bin/core';

export type Pen = ReturnType<typeof rough.svg>;

export function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 100000;
}

export const INK = '#2f2b28';
export const INK_SOFT = '#8a8580';
export const TX = '#0f766e';
export const RT = '#7e22ce';
export const PD = '#b3261e';
export const SURG = '#b45309';
export const MARKER = '#1d4ed8';

export function base(key: string, extra: Options = {}): Options {
  return { seed: seedOf(key), roughness: 1.35, bowing: 1.1, stroke: INK, strokeWidth: 1.15, ...extra };
}

export function cross(pen: Pen, cx: number, cy: number, r: number, key: string, opts: Options = {}) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.appendChild(pen.line(cx - r, cy - r, cx + r, cy + r, base(key + ':a', opts)));
  g.appendChild(pen.line(cx + r, cy - r, cx - r, cy + r, base(key + ':b', opts)));
  return g;
}

export function diamond(pen: Pen, cx: number, cy: number, r: number, key: string, opts: Options = {}) {
  return pen.polygon(
    [
      [cx, cy - r],
      [cx + r, cy],
      [cx, cy + r],
      [cx - r, cy],
    ],
    base(key, opts),
  );
}

export function triangle(pen: Pen, cx: number, cy: number, r: number, key: string, opts: Options = {}) {
  return pen.polygon(
    [
      [cx, cy - r],
      [cx + r * 0.92, cy + r * 0.78],
      [cx - r * 0.92, cy + r * 0.78],
    ],
    base(key, opts),
  );
}

export function bracket(pen: Pen, x0: number, x1: number, y: number, key: string, opts: Options = {}) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const o = base(key, { stroke: INK_SOFT, strokeWidth: 1, ...opts });
  g.appendChild(pen.line(x0, y, x1, y, o));
  g.appendChild(pen.line(x0, y - 4, x0, y + 4, base(key + ':l', { stroke: INK_SOFT, strokeWidth: 1, ...opts })));
  g.appendChild(pen.line(x1, y - 4, x1, y + 4, base(key + ':r', { stroke: INK_SOFT, strokeWidth: 1, ...opts })));
  return g;
}

export { rough };
