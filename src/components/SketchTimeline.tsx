import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ClinicalEvent, PatientStoryline } from '../core';
import { DAYS_PER_YEAR } from '../core';
import { human, type Track } from '../story/states';
import { COURSE_STYLE, courseAt, type CourseBand } from '../story/courses';
import { buildLanes, type Lane } from '../story/lanes';
import { INK, INK_SOFT, MARKER, PD, RT, SURG, TX, base, bracket, cross, diamond, rough, triangle } from '../rough/pen';
import type { Selection } from '../selection';

interface Props {
  story: PatientStoryline;
  track: Track;
  bands: CourseBand[];
  selection: Selection;
  onSelect: (s: Selection) => void;
}

const GUTTER = 152;
const PAD_R = 18;
const COURSE_Y = 16;
const COURSE_H = 34;
const TICK_Y = COURSE_Y + COURSE_H + 4;
const DETAIL_TOP = COURSE_Y + COURSE_H + 34;
const TIER_H = 15;
const CAP_H = 11;
const ROW_H = 16;
const LANE_H = 25;
const GROUP_H = 23;
const MIN_WINDOW_DAYS = 10;
const CLICK_SLOP = 4;

type Mode = 'single' | 'expanded';

interface PointMark {
  event: ClinicalEvent;
  x: number;
  lx: number;
  tier: number;
  label: string;
}
interface SpanMark {
  event: ClinicalEvent;
  x0: number;
  x1: number;
  lx: number;
  row: number;
  tier: number;
  label: string;
  openEnd: boolean;
}
interface LaneRow {
  kind: 'group' | 'lane';
  id: string;
  label: string;
  sub?: string;
  y: number;
  lane?: Lane;
}

const textWidth = (s: string, px = 12.5) => s.length * px * 0.55;
const MAX_TIERS = 4;

function assignTiers<T extends { x: number; w: number }>(items: T[]): number[] {
  const rightEdge: number[] = [];
  const order = items.map((_, i) => i).sort((a, b) => items[a].x - items[b].x);
  const tiers = new Array<number>(items.length).fill(0);
  for (const i of order) {
    const it = items[i];
    const left = it.x - it.w / 2;
    let chosen = -1;
    for (let t = 0; t < MAX_TIERS; t++) {
      if (rightEdge[t] == null || left > rightEdge[t] + 6) {
        chosen = t;
        break;
      }
    }
    if (chosen === -1) {
      chosen = 0;
      for (let t = 1; t < MAX_TIERS; t++) if ((rightEdge[t] ?? 0) < (rightEdge[chosen] ?? 0)) chosen = t;
    }
    rightEdge[chosen] = it.x + it.w / 2;
    tiers[i] = chosen;
  }
  return tiers;
}

const clampLabel = (x: number, w: number, width: number) =>
  Math.min(Math.max(x, GUTTER + w / 2), width - PAD_R - w / 2);

function axisTicks(d0: number, d1: number, anchor: number): { day: number; label: string }[] {
  const spanYears = (d1 - d0) / DAYS_PER_YEAR;
  const stepY =
    spanYears <= 0.2 ? 1 / 52
    : spanYears <= 0.6 ? 1 / 12
    : spanYears <= 1.5 ? 0.25
    : spanYears <= 3 ? 0.5
    : spanYears <= 8 ? 1
    : spanYears <= 18 ? 2
    : 5;
  const out: { day: number; label: string }[] = [];
  const firstK = Math.ceil((d0 - anchor) / DAYS_PER_YEAR / stepY);
  const lastK = Math.floor((d1 - anchor) / DAYS_PER_YEAR / stepY);
  if (lastK - firstK > 40) return out;
  for (let k = firstK; k <= lastK; k++) {
    const years = k * stepY;
    const day = anchor + years * DAYS_PER_YEAR;
    const sign = years > 0 ? '+' : '';
    const label =
      Math.abs(years) < 1e-9 ? 'dx'
      : stepY < 1 / 11 ? `${sign}${Math.round(years * 52)}w`
      : stepY < 1 ? `${sign}${Math.round(years * 12)}mo`
      : `${sign}${years}y`;
    out.push({ day, label });
  }
  return out;
}

function glyph(
  pen: ReturnType<typeof rough.svg>,
  e: ClinicalEvent,
  cx: number,
  cy: number,
  r: number,
  on: boolean,
  keySuffix = '',
) {
  const key = e.id + keySuffix;
  const sw = on ? 2 : 1.15;
  switch (e.eventType) {
    case 'diagnosis':
      return pen.circle(cx, cy, r * 2, base(key, { fill: INK, fillStyle: 'solid', stroke: INK, strokeWidth: sw, roughness: 0.85 }));
    case 'progression':
    case 'recurrence':
    case 'second_malignancy':
      return diamond(pen, cx, cy, r + 1.5, key, { fill: PD, fillStyle: 'cross-hatch', hachureGap: 3.5, stroke: PD, strokeWidth: sw });
    case 'surgery':
      return triangle(pen, cx, cy, r + 1.5, key, { fill: SURG, fillStyle: 'hachure', hachureGap: 3.5, stroke: SURG, strokeWidth: sw });
    case 'death':
      return cross(pen, cx, cy, r, key, { stroke: INK, strokeWidth: sw + 0.4 });
    default:
      return pen.circle(cx, cy, r * 1.6, base(key, { stroke: INK_SOFT, strokeWidth: sw }));
  }
}

export function SketchTimeline({ story, track, bands, selection, onSelect }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const courseLayer = useRef<SVGGElement>(null);
  const plotLayer = useRef<SVGGElement>(null);
  const [width, setWidth] = useState(1080);
  const [mode, setMode] = useState<Mode>('single');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ category: true, site: true });
  const [win, setWin] = useState<[number, number] | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(760, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const full = useMemo<[number, number]>(() => {
    const dated = story.events.filter((e) => e.time.startDay != null);
    const lo = Math.min(track.anchorDay, ...dated.map((e) => e.time.startDay as number));
    const hi = Math.max(track.terminalDay, ...dated.map((e) => e.time.endDay ?? (e.time.startDay as number)));
    const pad = Math.max((hi - lo) * 0.03, 15);
    return [lo - pad, hi + pad];
  }, [story, track]);

  useEffect(() => setWin(null), [story]);

  const view = win ?? full;
  const groups = useMemo(() => buildLanes(story), [story]);

  const clampWin = useCallback(
    (a: number, b: number): [number, number] => {
      const span = Math.min(Math.max(b - a, MIN_WINDOW_DAYS), full[1] - full[0]);
      let lo = a;
      let hi = a + span;
      if (hi > full[1]) {
        hi = full[1];
        lo = hi - span;
      }
      if (lo < full[0]) {
        lo = full[0];
        hi = lo + span;
      }
      return [lo, hi];
    },
    [full],
  );

  const viewRef = useRef(view);
  viewRef.current = view;
  const clampRef = useRef(clampWin);
  clampRef.current = clampWin;
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;
      if (px < GUTTER || py < DETAIL_TOP - 14) return;
      ev.preventDefault();
      const [a, b] = viewRef.current;
      const innerW = widthRef.current - GUTTER - PAD_R;
      const at = a + ((px - GUTTER) / innerW) * (b - a);
      const k = Math.exp(ev.deltaY * 0.0018);
      setWin(clampRef.current(at - (at - a) * k, at + (b - at) * k));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const innerW = width - GUTTER - PAD_R;
  const x = (d: number) => GUTTER + ((d - view[0]) / (view[1] - view[0] || 1)) * innerW;
  const xFull = (d: number) => GUTTER + ((d - full[0]) / (full[1] - full[0] || 1)) * innerW;
  const dayAtFull = (px: number) => full[0] + ((px - GUTTER) / innerW) * (full[1] - full[0]);

  // drag: brush across the course bands, pan inside the detail
  const drag = useRef<{
    kind: 'move' | 'left' | 'right' | 'new' | 'pan';
    px: number;
    win: [number, number];
    anchorDay: number;
    courseId: string | null;
    moved: boolean;
  } | null>(null);
  const raf = useRef(0);

  const startDrag =
    (kind: 'move' | 'left' | 'right' | 'new' | 'pan', courseId: string | null = null) =>
    (ev: React.PointerEvent) => {
      (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
      const rect = svgRef.current!.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      drag.current = { kind, px, win: view, anchorDay: dayAtFull(px), courseId, moved: false };
      ev.preventDefault();
    };

  const onMove = (ev: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    if (Math.abs(px - d.px) > CLICK_SLOP) d.moved = true;
    if (!d.moved || raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const perPxFull = (full[1] - full[0]) / innerW;
      const perPxView = (d.win[1] - d.win[0]) / innerW;
      const dx = px - d.px;
      if (d.kind === 'move') setWin(clampWin(d.win[0] + dx * perPxFull, d.win[1] + dx * perPxFull));
      else if (d.kind === 'left') setWin(clampWin(Math.min(d.win[0] + dx * perPxFull, d.win[1] - MIN_WINDOW_DAYS), d.win[1]));
      else if (d.kind === 'right') setWin(clampWin(d.win[0], Math.max(d.win[1] + dx * perPxFull, d.win[0] + MIN_WINDOW_DAYS)));
      else if (d.kind === 'new') {
        const here = dayAtFull(px);
        setWin(clampWin(Math.min(d.anchorDay, here), Math.max(d.anchorDay, here)));
      } else if (d.kind === 'pan') setWin(clampWin(d.win[0] - dx * perPxView, d.win[1] - dx * perPxView));
    });
  };

  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    // a press on a band that never moved is a click: select & frame
    if (d && !d.moved && d.courseId) {
      const band = bands.find((b) => b.id === d.courseId);
      onSelect({ kind: 'course', id: d.courseId });
      if (band) {
        const pad = Math.max((band.endDay - band.startDay) * 0.06, 8);
        setWin(clampWin(band.startDay - pad, band.endDay + pad));
      }
    }
  };

  // layout
  const L = useMemo(() => {
    const dated = story.events.filter((e) => e.time.startDay != null);
    const inView = (e: ClinicalEvent) => {
      const s = e.time.startDay as number;
      const en = e.time.endDay ?? s;
      return en >= view[0] && s <= view[1];
    };
    const left = GUTTER;
    const right = width - PAD_R;
    const contentTop = DETAIL_TOP + (mode === 'single' ? 0 : 26);

    let railY = contentTop;
    let pointMarks: PointMark[] = [];
    let spans: SpanMark[] = [];
    let lowerTop = contentTop;
    const laneRows: LaneRow[] = [];
    let contentBottom = contentTop;

    if (mode === 'single') {
      const pointMeta = dated
        .filter((e) => e.time.kind === 'point' && inView(e))
        .map((e) => {
          const label = e.label.length > 26 ? e.label.slice(0, 25) + '…' : e.label;
          return { e, label, x: x(e.time.startDay as number), w: textWidth(label) };
        });
      const pointTiers = assignTiers(pointMeta);
      pointMarks = pointMeta.map((m, i) => ({
        event: m.e,
        x: m.x,
        lx: clampLabel(m.x, m.w, width),
        tier: pointTiers[i],
        label: m.label,
      }));
      const upperTiers = Math.max(1, ...pointTiers.map((t) => t + 1));
      railY = contentTop + upperTiers * TIER_H + 10;

      const intervals = dated
        .filter((e) => e.time.kind === 'interval' && inView(e))
        .sort((a, b) => (a.time.startDay as number) - (b.time.startDay as number));
      const rowEnds: number[] = [];
      const spanMeta = intervals.map((e) => {
        const s = e.time.startDay as number;
        const hasEnd = e.time.endDay != null && (e.time.endDay as number) >= s;
        const eDay = hasEnd ? (e.time.endDay as number) : s + 21;
        let row = rowEnds.findIndex((r) => s > r + 2);
        if (row === -1) row = Math.min(rowEnds.length, 2);
        rowEnds[row] = eDay;
        const label = e.label.length > 30 ? e.label.slice(0, 29) + '…' : e.label;
        return { e, row, x0: Math.max(x(s), left), x1: Math.min(Math.max(x(eDay), x(s) + 7), right), label, openEnd: !hasEnd };
      });
      const rows = Math.max(1, ...spanMeta.map((s) => s.row + 1));
      const spanLabelMeta = spanMeta.map((s) => ({ ...s, x: (s.x0 + s.x1) / 2, w: textWidth(s.label) }));
      const spanTiers = assignTiers(spanLabelMeta);
      spans = spanLabelMeta.map((s, i) => ({
        event: s.e,
        x0: s.x0,
        x1: s.x1,
        lx: clampLabel(s.x, s.w, width),
        row: s.row,
        tier: spanTiers[i],
        label: s.label,
        openEnd: s.openEnd,
      }));
      const lowerTiers = Math.max(1, ...spanTiers.map((t) => t + 1));
      lowerTop = railY + (rows - 1) * ROW_H + CAP_H / 2 + 12;
      contentBottom = lowerTop + lowerTiers * TIER_H + 4;
    } else {
      let y = contentTop;
      for (const g of groups) {
        laneRows.push({ kind: 'group', id: g.id, label: g.label, y: y + 13 });
        y += GROUP_H;
        if (openGroups[g.id] !== false)
          for (const lane of g.lanes) {
            laneRows.push({ kind: 'lane', id: lane.id, label: lane.label, sub: lane.sub, y: y + LANE_H / 2, lane });
            y += LANE_H;
          }
        y += 10;
      }
      contentBottom = y;
    }

    const axisY = contentBottom + 20;
    const brackets = track.measures.filter((m) => m.bracket);
    const height = axisY + 46 + brackets.length * 24 + 10;
    return { pointMarks, spans, laneRows, railY, lowerTop, axisY, contentBottom, height, brackets, left, right, inView };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story, track, width, view[0], view[1], mode, groups, openGroups]);

  // the drawing
  useLayoutEffect(() => {
    const cg = courseLayer.current;
    const pg = plotLayer.current;
    const svg = svgRef.current;
    if (!cg || !pg || !svg) return;
    while (cg.firstChild) cg.removeChild(cg.firstChild);
    while (pg.firstChild) pg.removeChild(pg.firstChild);
    const pen = rough.svg(svg);

    // 1. course bands: whole
    for (const b of bands) {
      const x0 = xFull(b.startDay);
      const w = Math.max(xFull(b.endDay) - x0, 2);
      const st = COURSE_STYLE[b.kind];
      const on = selection?.kind === 'course' && selection.id === b.id;
      cg.appendChild(
        pen.rectangle(x0, COURSE_Y, w, COURSE_H, base(b.id, {
          fill: st.color,
          fillStyle: st.fillStyle,
          hachureAngle: st.hachureAngle,
          hachureGap: st.hachureGap,
          fillWeight: 0.7,
          roughness: 0.95,
          stroke: st.color,
          strokeWidth: on ? 2 : 1.1,
        })),
      );
      if (on)
        cg.appendChild(
          pen.rectangle(x0 - 4, COURSE_Y - 5, w + 8, COURSE_H + 10, base(b.id + ':sel', { stroke: MARKER, strokeWidth: 1.5, roughness: 2 })),
        );
      if (b.openEnd)
        cg.appendChild(
          pen.linearPath(
            [
              [x0 + w - 7, COURSE_Y + 5],
              [x0 + w - 1, COURSE_Y + COURSE_H / 2],
              [x0 + w - 7, COURSE_Y + COURSE_H - 5],
            ],
            base(b.id + ':open', { stroke: st.color, strokeWidth: 1 }),
          ),
        );
    }

    // event: faint tick
    for (const e of story.events) {
      if (e.time.startDay == null) continue;
      const px = xFull(e.time.startDay);
      cg.appendChild(pen.line(px, TICK_Y, px, TICK_Y + 9, base('t' + e.id, { stroke: INK_SOFT, strokeWidth: 0.8, roughness: 0.8 })));
    }

    // window
    cg.appendChild(
      pen.rectangle(xFull(view[0]), COURSE_Y - 5, Math.max(xFull(view[1]) - xFull(view[0]), 3), COURSE_H + 20, base('brush', {
        stroke: MARKER,
        strokeWidth: 1.4,
        roughness: 1.3,
      })),
    );

    if (mode === 'single') {
      // 2a. one rail
      pg.appendChild(pen.line(L.left, L.railY, L.right, L.railY, base('rail', { strokeWidth: 1.3 })));

      for (const s of L.spans) {
        const y = L.railY + s.row * ROW_H - CAP_H / 2;
        const isRt = s.event.category === 'radiation';
        const on = selection?.kind === 'event' && selection.id === s.event.id;
        pg.appendChild(
          pen.rectangle(s.x0, y, Math.max(s.x1 - s.x0, 7), CAP_H, base(s.event.id, {
            fill: isRt ? RT : TX,
            fillStyle: isRt ? 'zigzag' : 'hachure',
            hachureAngle: isRt ? 60 : -41,
            hachureGap: 4,
            fillWeight: 1.1,
            stroke: isRt ? RT : TX,
            strokeWidth: on ? 1.9 : 1.05,
          })),
        );
        if (s.openEnd && s.x1 < L.right - 8)
          pg.appendChild(
            pen.linearPath(
              [
                [s.x1 + 2, y + 1],
                [s.x1 + 7, y + CAP_H / 2],
                [s.x1 + 2, y + CAP_H - 1],
              ],
              base(s.event.id + ':open', { stroke: INK_SOFT, strokeWidth: 0.9 }),
            ),
          );
        pg.appendChild(
          pen.line((s.x0 + s.x1) / 2, y + CAP_H + 1, s.lx, L.lowerTop + s.tier * TIER_H - 9, base(s.event.id + ':lead', {
            stroke: INK_SOFT,
            strokeWidth: 0.7,
            roughness: 0.8,
          })),
        );
        if (on)
          pg.appendChild(
            pen.rectangle(s.x0 - 4, y - 4, Math.max(s.x1 - s.x0, 7) + 8, CAP_H + 8, base(s.event.id + ':sel', { stroke: MARKER, strokeWidth: 1.5, roughness: 2 })),
          );
      }

      for (const p of L.pointMarks) {
        const on = selection?.kind === 'event' && selection.id === p.event.id;
        pg.appendChild(glyph(pen, p.event, p.x, L.railY, 7.5, on));
        pg.appendChild(
          pen.line(p.lx, DETAIL_TOP + 5 + p.tier * TIER_H, p.x, L.railY - 10, base(p.event.id + ':lead', {
            stroke: INK_SOFT,
            strokeWidth: 0.7,
            roughness: 0.8,
          })),
        );
        if (on) pg.appendChild(pen.circle(p.x, L.railY, 30, base(p.event.id + ':sel', { stroke: MARKER, strokeWidth: 1.5, roughness: 2.2 })));
      }
    } else {
      // 2b. lanes
      for (const row of L.laneRows) {
        if (row.kind !== 'lane' || !row.lane) continue;
        pg.appendChild(pen.line(L.left, row.y, L.right, row.y, base('lane' + row.id, { stroke: INK_SOFT, strokeWidth: 0.55, roughness: 0.9 })));
        for (const e of row.lane.events) {
          if (!L.inView(e)) continue;
          const on = selection?.kind === 'event' && selection.id === e.id;
          const s = e.time.startDay as number;
          if (e.time.kind === 'interval') {
            const hasEnd = e.time.endDay != null && (e.time.endDay as number) >= s;
            const eDay = hasEnd ? (e.time.endDay as number) : s + 21;
            const x0 = Math.max(x(s), L.left);
            const x1 = Math.min(Math.max(x(eDay), x(s) + 6), L.right);
            const isRt = e.category === 'radiation';
            pg.appendChild(
              pen.rectangle(x0, row.y - 5, Math.max(x1 - x0, 6), 10, base(e.id + row.id, {
                fill: isRt ? RT : TX,
                fillStyle: isRt ? 'zigzag' : 'hachure',
                hachureAngle: isRt ? 60 : -41,
                hachureGap: 4,
                fillWeight: 1,
                stroke: isRt ? RT : TX,
                strokeWidth: on ? 1.9 : 1,
              })),
            );
            if (on)
              pg.appendChild(
                pen.rectangle(x0 - 3, row.y - 9, Math.max(x1 - x0, 6) + 6, 18, base(e.id + row.id + ':sel', { stroke: MARKER, strokeWidth: 1.4, roughness: 2 })),
              );
          } else {
            pg.appendChild(glyph(pen, e, x(s), row.y, 6, on, row.id));
            if (on) pg.appendChild(pen.circle(x(s), row.y, 24, base(e.id + row.id + ':sel', { stroke: MARKER, strokeWidth: 1.4, roughness: 2.2 })));
          }
        }
      }
    }

    // 3. axis and measured spans
    pg.appendChild(pen.line(L.left, L.axisY, L.right, L.axisY, base('axis', { stroke: INK_SOFT, strokeWidth: 1 })));
    for (const t of axisTicks(view[0], view[1], track.anchorDay))
      pg.appendChild(pen.line(x(t.day), L.axisY - 4, x(t.day), L.axisY + 4, base('tick' + t.label, { stroke: INK_SOFT, strokeWidth: 0.9, roughness: 0.8 })));

    L.brackets.forEach((m, i) => {
      if (m.toDay < view[0] || m.fromDay > view[1]) return;
      pg.appendChild(bracket(pen, Math.max(x(m.fromDay), L.left), Math.min(x(m.toDay), L.right), L.axisY + 50 + i * 24, 'br' + m.id));
    });
  }, [L, track, story, bands, selection, view[0], view[1], mode, width]);

  const zoomed = win != null && view[1] - view[0] < full[1] - full[0] - 1;
  const ticks = axisTicks(view[0], view[1], track.anchorDay);
  const here = zoomed ? courseAt(bands, (view[0] + view[1]) / 2) : null;

  return (
    <div ref={wrap} className="chart-wrap">
      <svg
        ref={svgRef}
        width={width}
        height={L.height}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="img"
        aria-label="clinical storyline"
      >
        <defs>
          <clipPath id="plot-clip">
            <rect x={GUTTER - 2} y={DETAIL_TOP - 16} width={width - GUTTER - PAD_R + 4} height={L.height} />
          </clipPath>
          <clipPath id="course-clip">
            <rect x={GUTTER - 2} y={0} width={width - GUTTER - PAD_R + 4} height={DETAIL_TOP - 18} />
          </clipPath>
        </defs>

        {/* empty strip: drag here for a new window */}
        <rect className="ctx-bg" x={GUTTER} y={COURSE_Y - 6} width={innerW} height={COURSE_H + 24} onPointerDown={startDrag('new')} onDoubleClick={() => setWin(null)} />

        <g ref={courseLayer} clipPath="url(#course-clip)" />

        {/* course labels */}
        <g clipPath="url(#course-clip)">
          {bands.map((b) => {
            const x0 = xFull(b.startDay);
            const x1 = xFull(b.endDay);
            const w = x1 - x0;
            const dur = human(b.endDay - b.startDay);
            const long = `${b.label} · ${dur}`;
            const text = w > textWidth(long) + 12 ? long : w > textWidth(b.short) + 8 ? b.short : '';
            if (!text) return null;
            return (
              <text key={b.id} className="course-lbl" x={(x0 + x1) / 2} y={COURSE_Y + COURSE_H / 2 + 4} textAnchor="middle">
                {text}
              </text>
            );
          })}
        </g>

        {/* course hit targets: click selects and frames, drag brushes */}
        <g clipPath="url(#course-clip)">
          {bands.map((b) => (
            <rect
              key={b.id}
              className="course-hit"
              x={xFull(b.startDay)}
              y={COURSE_Y}
              width={Math.max(xFull(b.endDay) - xFull(b.startDay), 3)}
              height={COURSE_H}
              onPointerDown={startDrag('new', b.id)}
              onDoubleClick={() => setWin(null)}
            >
              <title>{`${b.label} — ${human(b.endDay - b.startDay)}${b.openEnd ? ' (open at end of record)' : ''}`}</title>
            </rect>
          ))}
        </g>

        {zoomed && (
          <>
            <rect className="brush-handle" x={xFull(view[0]) - 4} y={COURSE_Y - 5} width={8} height={COURSE_H + 20} onPointerDown={startDrag('left')} />
            <rect className="brush-handle" x={xFull(view[1]) - 4} y={COURSE_Y - 5} width={8} height={COURSE_H + 20} onPointerDown={startDrag('right')} />
          </>
        )}

        {/* pan surface for the detail region */}
        <rect className="pan-bg" x={GUTTER} y={DETAIL_TOP - 14} width={innerW} height={L.axisY - DETAIL_TOP + 30} onPointerDown={startDrag('pan')} />

        <g ref={plotLayer} clipPath="url(#plot-clip)" />

        {/* gutter */}
        <g>
          <text className="gut-eyebrow" x={12} y={COURSE_Y + 12}>
            whole course
          </text>
          <text className="gut-sub" x={12} y={COURSE_Y + 26}>
            {bands.length} course{bands.length === 1 ? '' : 's'}
          </text>
          <text className="gut-sub" x={12} y={COURSE_Y + 40}>
            {zoomed ? `window ${human(view[1] - view[0])}` : 'click one, or drag'}
          </text>
          {zoomed && (
            <text className="gut-reset" x={12} y={COURSE_Y + 54} onClick={() => setWin(null)}>
              reset
            </text>
          )}

          {mode === 'single' ? (
            <>
              <text className="gut-toggle" x={12} y={L.railY + 4} onClick={() => setMode('expanded')}>
                ▸ every event
              </text>
              {here && (
                <text className="gut-sub" x={12} y={L.railY + 20}>
                  in {here.short}
                </text>
              )}
            </>
          ) : (
            <>
              <text className="gut-toggle" x={12} y={DETAIL_TOP + 6} onClick={() => setMode('single')}>
                ▾ back to one rail
              </text>
              {L.laneRows.map((r) =>
                r.kind === 'group' ? (
                  <text key={r.id} className="gut-group" x={12} y={r.y} onClick={() => setOpenGroups((o) => ({ ...o, [r.id]: o[r.id] === false }))}>
                    {openGroups[r.id] === false ? '▸' : '▾'} {r.label}
                  </text>
                ) : (
                  <text key={r.id} className="gut-lane" x={24} y={r.y + 4}>
                    {r.label} <tspan className="gut-n">{r.sub}</tspan>
                  </text>
                ),
              )}
            </>
          )}
        </g>

        {/* labels inside the detail */}
        <g clipPath="url(#plot-clip)">
          {mode === 'single' && (
            <>
              {L.pointMarks.map((p) => (
                <text
                  key={p.event.id}
                  className={`ev-lbl ${selection?.kind === 'event' && selection.id === p.event.id ? 'on' : ''}`}
                  x={p.lx}
                  y={DETAIL_TOP + 5 + p.tier * TIER_H}
                  textAnchor="middle"
                  onClick={() => onSelect({ kind: 'event', id: p.event.id })}
                >
                  {p.label}
                </text>
              ))}
              {L.spans.map((s) => (
                <text
                  key={s.event.id}
                  className={`ev-lbl ${selection?.kind === 'event' && selection.id === s.event.id ? 'on' : ''}`}
                  x={s.lx}
                  y={L.lowerTop + s.tier * TIER_H}
                  textAnchor="middle"
                  onClick={() => onSelect({ kind: 'event', id: s.event.id })}
                >
                  {s.label}
                </text>
              ))}
            </>
          )}

          {ticks.map((t) => (
            <text key={t.label} className="ax-lbl" x={x(t.day)} y={L.axisY + 16} textAnchor="middle">
              {t.label}
            </text>
          ))}
          <text className="ax-unit" x={width - PAD_R} y={L.axisY - 8} textAnchor="end">
            time from diagnosis →
          </text>

          {L.brackets.map((m, i) => {
            if (m.toDay < view[0] || m.fromDay > view[1]) return null;
            const text = `${m.label} — ${human(m.days)}`;
            const cx = (Math.max(x(m.fromDay), L.left) + Math.min(x(m.toDay), L.right)) / 2;
            return (
              <text key={m.id} className="br-lbl" x={clampLabel(cx, textWidth(text), width)} y={L.axisY + 46 + i * 24} textAnchor="middle">
                {text}
              </text>
            );
          })}
        </g>

        {/* detail hit targets */}
        <g clipPath="url(#plot-clip)">
          {mode === 'single' &&
            L.pointMarks.map((p) => (
              <circle key={p.event.id} className="hit" cx={p.x} cy={L.railY} r={11} onClick={() => onSelect({ kind: 'event', id: p.event.id })}>
                <title>{`${p.event.label} — ${p.event.detail}`}</title>
              </circle>
            ))}
          {mode === 'single' &&
            L.spans.map((s) => (
              <rect
                key={s.event.id}
                className="hit"
                x={s.x0 - 2}
                y={L.railY + s.row * ROW_H - CAP_H / 2 - 3}
                width={Math.max(s.x1 - s.x0, 7) + 4}
                height={CAP_H + 6}
                onClick={() => onSelect({ kind: 'event', id: s.event.id })}
              >
                <title>{`${s.event.label} — ${s.event.detail}`}</title>
              </rect>
            ))}
          {mode === 'expanded' &&
            L.laneRows.flatMap((row) =>
              row.kind !== 'lane' || !row.lane
                ? []
                : row.lane.events.filter(L.inView).map((e) => {
                    const s = e.time.startDay as number;
                    const isInterval = e.time.kind === 'interval';
                    const eDay = isInterval ? (e.time.endDay ?? s + 21) : s;
                    const x0 = Math.max(x(s), L.left);
                    const x1 = Math.min(Math.max(x(Math.max(eDay, s)), x(s) + 6), L.right);
                    return (
                      <rect
                        key={row.id + e.id}
                        className="hit"
                        x={isInterval ? x0 - 2 : x0 - 9}
                        y={row.y - 10}
                        width={isInterval ? Math.max(x1 - x0, 6) + 4 : 18}
                        height={20}
                        onClick={() => onSelect({ kind: 'event', id: e.id })}
                      >
                        <title>{`${e.label} — ${e.detail}`}</title>
                      </rect>
                    );
                  }),
            )}
        </g>
      </svg>

      <div className="hint">
        click a course band to frame it · drag across the bands for any window · scroll to zoom, drag to pan
        {zoomed ? ' · double-click to reset' : ''}
      </div>
    </div>
  );
}
