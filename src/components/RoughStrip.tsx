import { useLayoutEffect, useRef } from 'react';
import { INK_SOFT, MARKER, base, rough } from '../rough/pen';

/**
 * The crudest honest picture of a distribution: one tick per record along a
 * line, and a taller tick where this patient sits. It is not the YAC view — it
 * is a hand-drawn stand-in showing what the YAC view would be given.
 */
export function RoughStrip({
  values,
  mark,
  width = 300,
  height = 34,
}: {
  values: number[];
  mark: number | null;
  width?: number;
  height?: number;
}) {
  const layer = useRef<SVGGElement>(null);

  useLayoutEffect(() => {
    const g = layer.current;
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    const svg = g.ownerSVGElement;
    if (!svg || !values.length) return;
    const pen = rough.svg(svg);

    // Clinical durations and doses are long-tailed: one 12-year interval would
    // squash everything else against the left edge. Clip the drawn range to the
    // 1st–97th centile and pin anything beyond it to the edge.
    const sortedAll = [...values].sort((a, b) => a - b);
    const q = (p: number) => sortedAll[Math.min(sortedAll.length - 1, Math.max(0, Math.round(p * (sortedAll.length - 1))))];
    const lo = q(0.01);
    const hi = Math.max(q(0.97), lo + 1);
    const span = hi - lo;
    const pad = 10;
    const x = (v: number) => pad + ((Math.min(Math.max(v, lo), hi) - lo) / span) * (width - pad * 2);
    const y = height - 11;

    g.appendChild(pen.line(pad - 4, y, width - pad + 4, y, base('strip', { stroke: INK_SOFT, strokeWidth: 1, roughness: 1 })));

    // subsample so a 1,700-value distribution does not become a solid block
    const step = Math.max(1, Math.floor(values.length / 140));
    for (let i = 0; i < sortedAll.length; i += step) {
      const px = x(sortedAll[i]);
      g.appendChild(
        pen.line(px, y - 6, px, y, base('t' + i, { stroke: INK_SOFT, strokeWidth: 0.6, roughness: 0.7 })),
      );
    }
    if (mark != null && Number.isFinite(mark)) {
      const px = x(mark);
      g.appendChild(pen.line(px, y - 15, px, y + 4, base('mark', { stroke: MARKER, strokeWidth: 1.8, roughness: 0.9 })));
    }
  }, [values, mark, width, height]);

  if (!values.length) return null;
  return (
    <svg className="strip" width={width} height={height} aria-hidden="true">
      <g ref={layer} />
    </svg>
  );
}
