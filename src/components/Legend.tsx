import { useLayoutEffect, useRef } from 'react';
import { INK, INK_SOFT, PD, RT, SURG, TX, base, cross, diamond, rough, triangle } from '../rough/pen';
import { COURSE_STYLE, type CourseKind } from '../story/courses';

type Item =
  | { kind: 'course'; course: CourseKind; label: string; w: number }
  | { kind: 'glyph'; glyph: 'dx' | 'relapse' | 'surgery' | 'regimen' | 'radiation' | 'died'; label: string; w: number };

const ROW1: Item[] = [
  { kind: 'course', course: 'initial', label: 'initial presentation', w: 30 },
  { kind: 'course', course: 'recurrence', label: 'recurrence', w: 30 },
  { kind: 'course', course: 'progression', label: 'progression', w: 30 },
  { kind: 'course', course: 'second', label: 'second malignancy', w: 30 },
];
const ROW2: Item[] = [
  { kind: 'glyph', glyph: 'dx', label: 'diagnosis', w: 18 },
  { kind: 'glyph', glyph: 'relapse', label: 'relapse event', w: 18 },
  { kind: 'glyph', glyph: 'surgery', label: 'surgery', w: 20 },
  { kind: 'glyph', glyph: 'regimen', label: 'regimen window', w: 26 },
  { kind: 'glyph', glyph: 'radiation', label: 'radiation course', w: 26 },
  { kind: 'glyph', glyph: 'died', label: 'died', w: 16 },
];

const GAP = 7;
const SEP = 22;
const CHAR = 6.7;

function place(items: Item[]) {
  let x = 6;
  return items.map((it) => {
    const at = x;
    x += it.w + GAP + it.label.length * CHAR + SEP;
    return { ...it, x: at, labelX: at + it.w + GAP };
  });
}
const R1 = place(ROW1);
const R2 = place(ROW2);
const WIDTH = Math.max(
  R1[R1.length - 1].labelX + R1[R1.length - 1].label.length * CHAR,
  R2[R2.length - 1].labelX + R2[R2.length - 1].label.length * CHAR,
) + 10;

export function Legend() {
  const layer = useRef<SVGGElement>(null);

  useLayoutEffect(() => {
    const g = layer.current;
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    const svg = g.ownerSVGElement;
    if (!svg) return;
    const pen = rough.svg(svg);

    const y1 = 4;
    for (const it of R1) {
      if (it.kind !== 'course') continue;
      const st = COURSE_STYLE[it.course];
      g.appendChild(
        pen.rectangle(it.x, y1, it.w, 15, base('lg-' + it.course, {
          fill: st.color,
          fillStyle: st.fillStyle,
          hachureAngle: st.hachureAngle,
          hachureGap: Math.max(5, st.hachureGap * 0.6),
          fillWeight: 0.8,
          stroke: st.color,
          strokeWidth: 1,
        })),
      );
    }

    const y2 = 30;
    const cy = y2 + 7;
    for (const it of R2) {
      if (it.kind !== 'glyph') continue;
      switch (it.glyph) {
        case 'dx':
          g.appendChild(pen.circle(it.x + 9, cy, 13, base('lg-dx', { fill: INK, fillStyle: 'solid', stroke: INK, roughness: 0.85 })));
          break;
        case 'relapse':
          g.appendChild(diamond(pen, it.x + 9, cy, 8, 'lg-rc', { fill: PD, fillStyle: 'cross-hatch', hachureGap: 3.5, stroke: PD }));
          break;
        case 'surgery':
          g.appendChild(triangle(pen, it.x + 10, cy, 8, 'lg-sx', { fill: SURG, fillStyle: 'hachure', hachureGap: 3.5, stroke: SURG }));
          break;
        case 'regimen':
          g.appendChild(pen.rectangle(it.x, cy - 5, it.w, 10, base('lg-rg', { fill: TX, fillStyle: 'hachure', hachureAngle: -41, hachureGap: 4, stroke: TX })));
          break;
        case 'radiation':
          g.appendChild(pen.rectangle(it.x, cy - 5, it.w, 10, base('lg-rt', { fill: RT, fillStyle: 'zigzag', hachureAngle: 60, hachureGap: 4, stroke: RT })));
          break;
        case 'died':
          g.appendChild(cross(pen, it.x + 8, cy, 6, 'lg-dc', { stroke: INK, strokeWidth: 1.4 }));
          break;
      }
    }
    g.appendChild(pen.line(6, 24, WIDTH - 10, 24, base('lg-rule', { stroke: INK_SOFT, strokeWidth: 0.4, roughness: 0.9 })));
  }, []);

  return (
    <svg className="legend" width={WIDTH} height={52} aria-hidden="true">
      <g ref={layer} />
      <g>
        {R1.map((it) => (
          <text key={it.label} className="lg-lbl" x={it.labelX} y={16}>
            {it.label}
          </text>
        ))}
        {R2.map((it) => (
          <text key={it.label} className="lg-lbl" x={it.labelX} y={42}>
            {it.label}
          </text>
        ))}
      </g>
    </svg>
  );
}
