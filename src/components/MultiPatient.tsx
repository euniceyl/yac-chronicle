import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import rough from 'roughjs';
import type { EventType } from '../core';
import { DAYS_PER_YEAR } from '../core';
import { COURSE_STYLE } from '../story/courses';
import { INK, INK_SOFT, MARKER, PD, RT, SURG, TX, base, diamond, triangle } from '../rough/pen';
import { Legend } from './Legend';
import {
  ANCHORS,
  METRICS,
  anchorLabel,
  buildRoster,
  formatMetric,
  metricDef,
  type AnchorId,
  type CohortFilter,
  type MetricId,
  type PatientProfile,
  type RosterRow,
  type SelectBy,
} from '../story/multi';

interface Props {
  profiles: PatientProfile[];
  focalId: string;
  onFocus: (id: string) => void;
  anchor: AnchorId;
  onAnchor: (a: AnchorId) => void;
  onOpenSingle: () => void;
}

const GUTTER = 232;
const PAD_R = 104;
const ROW_H = 38;
const FOCAL_H = 72;
const AXIS_H = 48;
const TOP = 26;

type WindowId = 'p3m' | 'p6m' | 'p1y' | 'p2y' | 'p5y' | 'fit';
const WINDOWS: { id: WindowId; label: string; days: number | null }[] = [
  { id: 'p3m', label: '±3mo', days: 91 },
  { id: 'p6m', label: '±6mo', days: 183 },
  { id: 'p1y', label: '±1y', days: 365 },
  { id: 'p2y', label: '±2y', days: 730 },
  { id: 'p5y', label: '±5y', days: 1826 },
  { id: 'fit', label: 'fit', days: null },
];

const PROV_LABEL: Record<RosterRow['provenance'], string> = {
  focal: 'focal patient',
  spread: 'spread of cohort',
  neighbour: 'nearest on sort',
  pinned: 'pinned',
  'off-filter': 'pinned · off-filter',
  'no-anchor': 'pinned · no anchor event',
};

const POINT_COLOR: Partial<Record<EventType, string>> = {
  surgery: SURG,
  diagnosis: COURSE_STYLE.initial.color,
  progression: PD,
  recurrence: COURSE_STYLE.recurrence.color,
  second_malignancy: COURSE_STYLE.second.color,
};

function ticksFor(d0: number, d1: number): { day: number; label: string }[] {
  const years = (d1 - d0) / DAYS_PER_YEAR;
  const step =
    years <= 0.7 ? 30.44
    : years <= 1.6 ? 91.31
    : years <= 4 ? 182.6
    : years <= 9 ? DAYS_PER_YEAR
    : DAYS_PER_YEAR * 2;
  const out: { day: number; label: string }[] = [];
  const from = Math.ceil(d0 / step) * step;
  for (let d = from; d <= d1 + 1; d += step) {
    const absDays = Math.abs(d);
    const label =
      absDays < 1 ? '0'
      : absDays < 45 ? `${d > 0 ? '+' : '−'}${Math.round(absDays / 30.44)}mo`
      : absDays < DAYS_PER_YEAR * 1.5 ? `${d > 0 ? '+' : '−'}${Math.round(absDays / 30.44)}mo`
      : `${d > 0 ? '+' : '−'}${(absDays / DAYS_PER_YEAR).toFixed(1)}y`;
    out.push({ day: d, label });
  }
  return out;
}

export function MultiPatient({ profiles, focalId, onFocus, anchor, onAnchor, onOpenSingle }: Props) {
  const [filter, setFilter] = useState<CohortFilter>({ diagnosis: 'all', dataCohort: 'all' });
  const [rankBy, setRankBy] = useState<MetricId>('gap_after_anchor');
  const [selectBy, setSelectBy] = useState<SelectBy>('spread');
  const [k, setK] = useState(4);
  const [pinned, setPinned] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [windowId, setWindowId] = useState<WindowId>('p1y');
  const [compare, setCompare] = useState(90);
  const [addId, setAddId] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(focalId);
  const [viewRange, setViewRange] = useState<[number, number] | null>(null);

  const holder = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const roughLayerRef = useRef<SVGGElement | null>(null);
  const dragRef = useRef<{ x: number; range: [number, number] } | null>(null);
  const [width, setWidth] = useState(1100);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(760, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const diagnoses = useMemo(
    () => [...new Set(profiles.map((p) => p.diagnosisCohort).filter(Boolean))] as string[],
    [profiles],
  );
  const dataCohorts = useMemo(
    () => [...new Set(profiles.map((p) => p.dataCohort).filter(Boolean))] as string[],
    [profiles],
  );

  const roster = useMemo(
    () => buildRoster({ profiles, focalId, anchor, filter, rankBy, selectBy, k, pinned, removed }),
    [profiles, focalId, anchor, filter, rankBy, selectBy, k, pinned, removed],
  );

  const rows = roster.rows;
  useEffect(() => setSelectedId(focalId), [focalId]);

  // scale
  const extent = useMemo(() => {
    let lo = 0;
    let hi = 0;
    for (const r of rows) {
      if (r.anchorDay == null) continue;
      const a = r.anchorDay;
      lo = Math.min(lo, (r.profile.dxDay ?? a) - a);
      hi = Math.max(hi, r.profile.terminalDay - a);
    }
    return [Math.min(lo, -30), Math.max(hi, 30)] as [number, number];
  }, [rows]);

  const win = WINDOWS.find((w) => w.id === windowId) as (typeof WINDOWS)[number];
  const [d0, d1] = win.days == null ? extent : [-win.days, win.days];
  const plotW = Math.max(200, width - GUTTER - PAD_R);
  const view = viewRange ?? [d0, d1];
  const xOf = (day: number) => GUTTER + ((day - view[0]) / (view[1] - view[0] || 1)) * plotW;
  const clampX = (x: number) => Math.min(Math.max(x, GUTTER), GUTTER + plotW);

  const clampRange = (lo: number, hi: number): [number, number] => {
    const full = extent[1] - extent[0] || 365;
    const span = Math.min(Math.max(hi - lo, 30), full);
    let a = lo;
    let b = hi;
    if (b > extent[1]) {
      b = extent[1];
      a = Math.max(extent[0], b - span);
    }
    if (a < extent[0]) {
      a = extent[0];
      b = Math.min(extent[1], a + span);
    }
    return [a, b];
  };

  const handleWheel = (ev: React.WheelEvent<SVGSVGElement>) => {
    ev.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ev.clientX - rect.left;
    const day = view[0] + ((px - GUTTER) / plotW) * (view[1] - view[0]);
    const nextSpan = (view[1] - view[0]) * Math.exp(-ev.deltaY * 0.0014);
    const lo = clampRange(day - ((day - view[0]) / (view[1] - view[0] || 1)) * nextSpan, day + ((view[1] - day) / (view[1] - view[0] || 1)) * nextSpan)[0];
    const hi = clampRange(day - ((day - view[0]) / (view[1] - view[0] || 1)) * nextSpan, day + ((view[1] - day) / (view[1] - view[0] || 1)) * nextSpan)[1];
    setViewRange([lo, hi]);
  };

  const handlePanStart = (ev: React.PointerEvent<SVGSVGElement>) => {
    if ((ev.target as Element).closest('[data-row-id]')) return;
    dragRef.current = { x: ev.clientX, range: view };
  };

  const handlePanMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    const pxDelta = ev.clientX - dragRef.current.x;
    const span = dragRef.current.range[1] - dragRef.current.range[0];
    const daysPerPx = span / plotW;
    setViewRange(clampRange(dragRef.current.range[0] - pxDelta * daysPerPx, dragRef.current.range[1] - pxDelta * daysPerPx));
  };

  const handlePanEnd = () => { dragRef.current = null; };

  const heights = rows.map((r) => (r.provenance === 'focal' ? FOCAL_H : ROW_H));
  const yOf = (i: number) => TOP + heights.slice(0, i).reduce((a, b) => a + b, 0);
  const stackH = heights.reduce((a, b) => a + b, 0);
  const svgH = TOP + stackH + AXIS_H;

  const addPatient = () => {
    const id = addId.trim();
    if (!id) return;
    if (!profiles.some((p) => p.id === id)) {
      setAddError(`no patient ${id} in this drop`);
      return;
    }
    setAddError(null);
    setRemoved((r) => r.filter((x) => x !== id));
    setPinned((p) => (p.includes(id) ? p : [...p, id]));
    setAddId('');
  };

  const togglePin = (id: string) =>
    setPinned((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const drop = (id: string) => {
    setPinned((p) => p.filter((x) => x !== id));
    setRemoved((r) => (r.includes(id) ? r : [...r, id]));
  };

  const anchorDef = ANCHORS.find((a) => a.id === anchor);

  useLayoutEffect(() => {
    const layer = roughLayerRef.current;
    const svg = svgRef.current;
    if (!layer || !svg) return;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    const pen = rough.svg(svg);

    const selectedRow = rows.find((r) => r.profile.id === selectedId);
    if (selectedRow) {
      const selectedIdx = rows.findIndex((r) => r.profile.id === selectedId);
      const y = yOf(selectedIdx);
      const h = heights[selectedIdx] ?? ROW_H;
      layer.appendChild(
        pen.rectangle(GUTTER - 10, y - 3, plotW + 20, h + 6, base(`multi-row-select:${selectedRow.profile.id}`, {
          fill: 'rgba(29, 78, 216, 0.02)',
          stroke: MARKER,
          strokeWidth: 1.5,
          roughness: 1.6,
          bowing: 1.2,
        })),
      );
    }

    rows.forEach((r, i) => {
      const y = yOf(i);
      const p = r.profile;
      const a = r.anchorDay ?? r.profile.dxDay ?? 0;
      const rel = (day: number) => day - a;
      const bandY = r.provenance === 'focal' ? y + 10 : y + 6;
      const bandH = r.provenance === 'focal' ? 18 : 14;

      const rowGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      rowGroup.setAttribute('data-row-id', p.id);
      rowGroup.style.cursor = 'pointer';
      rowGroup.onclick = () => {
        setSelectedId(p.id);
        onFocus(p.id);
      };

      p.courses.forEach((c) => {
        const x0 = clampX(xOf(rel(c.startDay)));
        const x1 = clampX(xOf(rel(c.endDay)));
        const w = Math.max(1, x1 - x0);
        const st = COURSE_STYLE[c.kind];
        rowGroup.appendChild(
          pen.rectangle(x0, bandY, w, bandH, base(`rough-course:${p.id}:${c.id}`, {
            fill: st.color,
            fillStyle: st.fillStyle,
            hachureAngle: st.hachureAngle,
            hachureGap: st.hachureGap,
            stroke: st.color,
            strokeWidth: 1.1,
            roughness: 1.1,
          })),
        );
      });

      p.spans.forEach((s, si) => {
        const x0 = clampX(xOf(rel(s.start)));
        const x1 = clampX(xOf(rel(s.end)));
        const yy = s.kind === 'radiation' ? (r.provenance === 'focal' ? y + 48 : y + 30) : (r.provenance === 'focal' ? y + 36 : y + 23);
        rowGroup.appendChild(
          pen.rectangle(x0, yy, Math.max(1.5, x1 - x0), r.provenance === 'focal' ? 7 : 5.5, base(`rough-span:${p.id}:${si}`, {
            fill: s.kind === 'radiation' ? RT : TX,
            fillStyle: s.kind === 'radiation' ? 'zigzag' : 'hachure',
            hachureAngle: s.kind === 'radiation' ? 60 : -41,
            hachureGap: 4,
            stroke: s.kind === 'radiation' ? RT : TX,
            strokeWidth: 1,
            roughness: 1.2,
          })),
        );
      });

      p.points.forEach((pt, pi) => {
        if (pt.type === 'death' || pt.type === 'last_contact') return;
        const x = xOf(rel(pt.day));
        if (x < GUTTER || x > GUTTER + plotW) return;
        const col = POINT_COLOR[pt.type] ?? INK_SOFT;
        const cy = bandY + bandH / 2;
        if (pt.type === 'surgery') {
          rowGroup.appendChild(
            triangle(pen, x, cy, 4.5, `rough-point:${p.id}:${pi}`, { fill: col, stroke: '#fbfaf6', strokeWidth: 0.8, fillStyle: 'solid' }),
          );
        } else {
          rowGroup.appendChild(
            diamond(pen, x, cy, 4.5, `rough-point:${p.id}:${pi}`, { fill: col, stroke: '#fbfaf6', strokeWidth: 0.8, fillStyle: 'solid' }),
          );
        }
      });

      const terminalX = xOf(rel(p.terminalDay));
      if (terminalX >= GUTTER && terminalX <= GUTTER + plotW) {
        if (p.terminalKind === 'death') {
          rowGroup.appendChild(
            pen.line(terminalX, bandY - 3, terminalX, bandY + bandH + 3, base(`rough-end:${p.id}`, { stroke: INK, strokeWidth: 2.4 })),
          );
        } else {
          rowGroup.appendChild(
            pen.line(terminalX, bandY + bandH / 2, terminalX + 10, bandY + bandH / 2, base(`rough-end:${p.id}`, { stroke: INK_SOFT, strokeWidth: 1.1 })),
          );
          rowGroup.appendChild(
            pen.line(terminalX + 10, bandY + bandH / 2 - 3.4, terminalX + 10, bandY + bandH / 2 + 3.4, base(`rough-end-arrow:${p.id}`, { stroke: INK_SOFT, strokeWidth: 1.1 })),
          );
        }
      }

      if (r.anchorDay != null) {
        rowGroup.appendChild(
          pen.circle(xOf(0), bandY + bandH / 2, 3.6, base(`rough-anchor:${p.id}`, { fill: '#fbfaf6', stroke: PD, strokeWidth: 1.8 })),
        );
      }

      layer.appendChild(rowGroup);
    });
  }, [rows, selectedId, xOf, clampX, plotW, width, onFocus]);

  return (
    <div className="mp" ref={holder}>
      <div className="mp-controls">
        <label>
          anchor
          <select value={anchor} onChange={(e) => onAnchor(e.target.value as AnchorId)}>
            {ANCHORS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          sort &amp; nearest by
          <select value={rankBy} onChange={(e) => setRankBy(e.target.value as MetricId)}>
            {METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          rows are
          <select value={selectBy} onChange={(e) => setSelectBy(e.target.value as SelectBy)}>
            <option value="spread">a spread across the cohort</option>
            <option value="nearest">nearest to this patient</option>
          </select>
        </label>
        <label>
          diagnosis
          <select
            value={filter.diagnosis}
            onChange={(e) => setFilter((f) => ({ ...f, diagnosis: e.target.value }))}
          >
            <option value="all">all</option>
            {diagnoses.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          cohort
          <select
            value={filter.dataCohort}
            onChange={(e) => setFilter((f) => ({ ...f, dataCohort: e.target.value }))}
          >
            <option value="all">all</option>
            {dataCohorts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          rows
          <input
            type="number"
            min={1}
            max={4}
            value={k}
            onChange={(e) => setK(Math.max(1, Math.min(4, Number(e.target.value) || 1)))}
          />
        </label>
        <span className="mp-range">
          {WINDOWS.map((w) => (
            <button
              key={w.id}
              className={w.id === windowId ? 'on' : ''}
              onClick={() => {
                setWindowId(w.id);
                setViewRange(null);
              }}
            >
              {w.label}
            </button>
          ))}
        </span>
        <label>
          compare ±
          <select value={compare} onChange={(e) => setCompare(Number(e.target.value))}>
            {[30, 90, 180, 365].map((d) => (
              <option key={d} value={d}>
                {d}d
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mp-roster">
        <span className="eyebrow">roster</span>
        <span>
          showing <b>{rows.length}</b> · <b>{roster.eligible.toLocaleString()}</b> of{' '}
          {roster.matching.toLocaleString()} matching patients have a <em>{anchorLabel(anchor)}</em> to line up on
        </span>
        <span>
          {metricDef(rankBy).label}: median <b>{formatMetric(rankBy, roster.stats.median)}</b> (IQR{' '}
          {formatMetric(rankBy, roster.stats.p25)}–{formatMetric(rankBy, roster.stats.p75)}) over{' '}
          <b>{roster.stats.n}</b>
          {roster.stats.missing > 0 && <>, none recorded for <b>{roster.stats.missing}</b></>}
        </span>
        <span className="mp-add">
          <input
            value={addId}
            placeholder="add by research_id"
            onChange={(e) => setAddId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPatient()}
          />
          <button onClick={addPatient}>add</button>
        </span>
        {removed.length > 0 && (
          <button className="link" onClick={() => setRemoved([])}>
            restore {removed.length} removed
          </button>
        )}
        {addError && <span className="mp-err">{addError}</span>}
      </div>

      <p className="mp-question">
        Click any row to make it the focal patient; the shared timeline is zoomable with the mouse wheel and pannable by dragging the plot.
      </p>
      {anchorDef && <p className="mp-question">{anchorDef.question}</p>}
      {roster.focalMissingAnchor && (
        <p className="mp-warn">
          {focalId} has no {anchorLabel(anchor)} in the record, so it cannot be aligned on this anchor — its row is
          drawn on the diagnosis axis and marked.
        </p>
      )}

      <svg
        ref={svgRef}
        className="mp-svg"
        width={width}
        height={svgH}
        role="img"
        onWheel={handleWheel}
        onPointerDown={handlePanStart}
        onPointerMove={handlePanMove}
        onPointerUp={handlePanEnd}
        onPointerLeave={handlePanEnd}
      >
        <g ref={roughLayerRef} />

        {rows.map((r, i) => {
          const y = yOf(i);
          const h = heights[i];
          const focal = r.provenance === 'focal';
          const p = r.profile;

          return (
            <g key={p.id}>
              {(r.provenance === 'off-filter' || r.provenance === 'no-anchor') && (
                <rect
                  x={4}
                  y={y + 1}
                  width={width - 8}
                  height={h - 2}
                  fill={PD}
                  opacity={0.035}
                  stroke={PD}
                  strokeOpacity={0.35}
                  strokeDasharray="4 3"
                />
              )}
              {focal && <rect x={4} y={y + 1} width={width - 8} height={h - 2} fill={INK} opacity={0.035} />}

              {/* gutter */}
              <text
                x={30}
                y={y + (focal ? 20 : 17)}
                fontSize={focal ? 13 : 12}
                fontWeight={focal ? 700 : 600}
                fill={INK}
                className="mp-id"
                onClick={() => onFocus(p.id)}
              >
                {p.id}
              </text>
              <text x={30} y={y + (focal ? 34 : 29)} fontSize={9.5} fill={INK_SOFT}>
                {p.counts.surgeries} surg · {p.counts.regimens} reg ·{' '}
                {p.counts.radiations ? `${p.counts.radiations} RT` : 'no RT'} · {p.counts.relapses} rel
              </text>
              <text x={GUTTER - 14} y={y + (focal ? 20 : 17)} fontSize={11.5} fill={INK} textAnchor="end">
                {r.metrics[rankBy] == null ? 'none recorded' : formatMetric(rankBy, r.metrics[rankBy])}
                {r.centile != null && <tspan fill={INK_SOFT} fontSize={9}>{`  ${r.centile}c`}</tspan>}
              </text>
              <text
                x={GUTTER - 14}
                y={y + (focal ? 34 : 29)}
                fontSize={9}
                fill={r.provenance === 'pinned' || r.provenance === 'off-filter' || r.provenance === 'no-anchor' ? PD : INK_SOFT}
                textAnchor="end"
              >
                {PROV_LABEL[r.provenance]}
              </text>
              <g className="mp-rowbtns">
                <text x={10} y={y + (focal ? 20 : 17)} fontSize={11} fill={pinned.includes(p.id) ? PD : INK_SOFT} onClick={() => togglePin(p.id)}>
                  {pinned.includes(p.id) ? '◆' : '◇'}
                </text>
                {!focal && (
                  <text x={10} y={y + (focal ? 34 : 29)} fontSize={10} fill={INK_SOFT} onClick={() => drop(p.id)}>
                    ✕
                  </text>
                )}
              </g>

            </g>
          );
        })}

        {/* the anchor line */}
        <line x1={xOf(0)} x2={xOf(0)} y1={TOP - 8} y2={TOP + stackH + 6} stroke={PD} strokeWidth={1.8} />

        {/* axis */}
        <line x1={GUTTER} x2={GUTTER + plotW} y1={TOP + stackH + 14} y2={TOP + stackH + 14} stroke={INK_SOFT} />
        {ticksFor(d0, d1).map((t) => (
          <g key={t.day}>
            <line x1={xOf(t.day)} x2={xOf(t.day)} y1={TOP + stackH + 14} y2={TOP + stackH + 18} stroke={INK_SOFT} />
            <text
              x={xOf(t.day)}
              y={TOP + stackH + 30}
              fontSize={10}
              fill={Math.abs(t.day) < 1 ? PD : INK_SOFT}
              textAnchor="middle"
              fontWeight={Math.abs(t.day) < 1 ? 700 : 400}
            >
              {t.label}
            </text>
          </g>
        ))}
        <text x={GUTTER} y={TOP + stackH + 44} fontSize={9.5} fill={INK_SOFT}>
          time from {anchorLabel(anchor)} in days; each row is translated so its own {anchorLabel(anchor)} sits on the line
        </text>
      </svg>

      <div className="mp-legend-exact">
        <Legend />
        <button className="link" onClick={onOpenSingle}>
          open {focalId} in the single-patient view →
        </button>
      </div>

      <p className="mp-note">
        row has the same composition as the single-patient view (drawn shorter);
        rows stop where the record stops;
        arrow means child was alive at last contact
      </p>
    </div>
  );
}
