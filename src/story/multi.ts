import type { ClinicalEvent, EventType, PatientStoryline } from '../core';
import { buildStoryline } from '../core';
import type { PcxBundle } from '../core';
import { buildCourseBands, type CourseBand } from './courses';
import { deriveTrack, human } from './states';

/**
 * Cohort layer: multi-patient view
 */

//  anchors

export type AnchorId =
  | 'diagnosis'
  | 'first_surgery'
  | 'first_radiation'
  | 'first_progression'
  | 'first_relapse'
  | 'terminal';

export interface AnchorDef {
  id: AnchorId;
  label: string;
  question: string;
}

export const ANCHORS: AnchorDef[] = [
  { id: 'diagnosis', label: 'diagnosis', question: 'how variable is what happens after presentation?' },
  { id: 'first_surgery', label: 'first surgery', question: 'what followed the first operation?' },
  { id: 'first_radiation', label: 'start of radiation', question: 'what was radiation given alongside, and when?' },
  { id: 'first_progression', label: 'first progression', question: 'what was done when the disease progressed?' },
  { id: 'first_relapse', label: 'first relapse of any kind', question: 'progression, recurrence or second malignancy — whichever came first' },
  { id: 'terminal', label: 'end of the record', question: 'what did the last months of follow-up look like?' },
];

export const anchorLabel = (id: AnchorId) => ANCHORS.find((a) => a.id === id)?.label ?? id;

const RELAPSE_TYPES = new Set<EventType>(['progression', 'recurrence', 'second_malignancy']);

// per-patient profile, computed once and reused across anchors

export interface RowSpan {
  start: number;
  end: number;
  open: boolean;
  kind: 'chemotherapy' | 'radiation';
  eventId: string;
}

export interface RowPoint {
  day: number;
  type: EventType;
  eventId: string;
}

export type MetricId =
  | 'dx_to_anchor'
  | 'time_to_relapse'
  | 'followup'
  | 'gap_after_anchor'
  | 'treatment_days'
  | 'n_courses';

export interface MetricDef {
  id: MetricId;
  label: string;
  short: string;
  unit: 'days' | 'count';
}

export const METRICS: MetricDef[] = [
  { id: 'gap_after_anchor', label: 'anchor → next therapy recorded', short: 'anchor→tx', unit: 'days' },
  { id: 'dx_to_anchor', label: 'diagnosis → anchor', short: 'dx→anchor', unit: 'days' },
  { id: 'time_to_relapse', label: 'diagnosis → first relapse', short: 'dx→relapse', unit: 'days' },
  { id: 'followup', label: 'diagnosis → end of record', short: 'follow-up', unit: 'days' },
  { id: 'treatment_days', label: 'days inside a therapy window', short: 'tx days', unit: 'days' },
  { id: 'n_courses', label: 'number of courses', short: 'courses', unit: 'count' },
];

export const metricDef = (id: MetricId) => METRICS.find((m) => m.id === id) as MetricDef;

export function formatMetric(id: MetricId, v: number | null): string {
  if (v == null) return '—';
  return metricDef(id).unit === 'count' ? String(v) : human(v);
}

export interface PatientProfile {
  id: string;
  diagnosisCohort: string | null;
  dataCohort: string | null;
  dxDay: number | null;
  terminalDay: number;
  terminalKind: 'death' | 'last_contact' | 'last_event';
  courses: CourseBand[];
  spans: RowSpan[];
  points: RowPoint[];
  counts: { surgeries: number; regimens: number; radiations: number; relapses: number };
  anchorDays: Record<AnchorId, number | null>;
}

const firstDatedOfType = (events: ClinicalEvent[], pred: (e: ClinicalEvent) => boolean): ClinicalEvent | null => {
  let best: ClinicalEvent | null = null;
  for (const e of events) {
    if (e.time.startDay == null || !pred(e)) continue;
    if (!best || (e.time.startDay as number) < (best.time.startDay as number)) best = e;
  }
  return best;
};

export function buildProfile(story: PatientStoryline): PatientProfile {
  const track = deriveTrack(story);
  const courses = buildCourseBands(story, track);
  const dated = story.events.filter((e) => e.time.startDay != null);

  const typed: RowSpan[] = [];
  for (const e of story.events) {
    const s = e.time.startDay;
    if (s == null) continue;
    if (e.category !== 'chemotherapy' && e.category !== 'radiation') continue;
    const hasEnd = e.time.endDay != null && (e.time.endDay as number) >= s;
    typed.push({
      start: s,
      end: hasEnd ? (e.time.endDay as number) : s + 21,
      open: !hasEnd,
      kind: e.category,
      eventId: e.id,
    });
  }
  typed.sort((a, b) => a.start - b.start);

  const points: RowPoint[] = dated
    .filter((e) => e.category === 'surgery' || e.category === 'disease' || e.category === 'status')
    .map((e) => ({ day: e.time.startDay as number, type: e.eventType, eventId: e.id }));

  const dx = firstDatedOfType(dated, (e) => e.eventType === 'diagnosis');
  const surg = firstDatedOfType(dated, (e) => e.eventType === 'surgery');
  const rad = firstDatedOfType(dated, (e) => e.eventType === 'radiation');
  const prog = firstDatedOfType(dated, (e) => e.eventType === 'progression');
  const relapse = firstDatedOfType(dated, (e) => RELAPSE_TYPES.has(e.eventType));

  const anchorDays: Record<AnchorId, number | null> = {
    diagnosis: dx ? (dx.time.startDay as number) : null,
    first_surgery: surg ? (surg.time.startDay as number) : null,
    first_radiation: rad ? (rad.time.startDay as number) : null,
    first_progression: prog ? (prog.time.startDay as number) : null,
    first_relapse: relapse ? (relapse.time.startDay as number) : null,
    terminal: track.terminalDay,
  };

  return {
    id: story.patient.id,
    diagnosisCohort: story.patient.diagnosisCohort,
    dataCohort: story.patient.dataCohort,
    dxDay: dx ? (dx.time.startDay as number) : null,
    terminalDay: track.terminalDay,
    terminalKind: track.terminalKind,
    courses,
    spans: typed,
    points,
    counts: {
      surgeries: dated.filter((e) => e.eventType === 'surgery').length,
      regimens: dated.filter((e) => e.eventType === 'chemotherapy').length,
      radiations: dated.filter((e) => e.eventType === 'radiation').length,
      relapses: dated.filter((e) => RELAPSE_TYPES.has(e.eventType)).length,
    },
    anchorDays,
  };
}

export function buildProfiles(bundle: PcxBundle): PatientProfile[] {
  const out: PatientProfile[] = [];
  for (const patient of bundle.patients.values()) {
    const events = bundle.eventsByPatient.get(patient.id) ?? [];
    if (!events.length) continue;
    out.push(buildProfile(buildStoryline(patient, events)));
  }
  return out;
}

// metrics, relative to chosen clinical anchor

export function metricsFor(p: PatientProfile, anchor: AnchorId): Record<MetricId, number | null> {
  const a = p.anchorDays[anchor];
  const relapse = p.points
    .filter((pt) => RELAPSE_TYPES.has(pt.type))
    .sort((x, y) => x.day - y.day)[0];

  let gap: number | null = null;
  if (a != null) {
    const next = p.spans.filter((s) => s.start >= a).sort((x, y) => x.start - y.start)[0];
    gap = next ? next.start - a : null;
  }

  let txDays = 0;
  let cs: number | null = null;
  let ce = 0;
  for (const s of [...p.spans].sort((x, y) => x.start - y.start)) {
    if (cs == null) {
      cs = s.start;
      ce = s.end;
    } else if (s.start <= ce) ce = Math.max(ce, s.end);
    else {
      txDays += ce - cs;
      cs = s.start;
      ce = s.end;
    }
  }
  if (cs != null) txDays += ce - cs;

  return {
    dx_to_anchor: a != null && p.dxDay != null ? a - p.dxDay : null,
    time_to_relapse: relapse && p.dxDay != null ? relapse.day - p.dxDay : null,
    followup: p.dxDay != null ? p.terminalDay - p.dxDay : null,
    gap_after_anchor: gap,
    treatment_days: txDays,
    n_courses: p.courses.length,
  };
}

// roster: filter → rank → top-k -> user's pins and removals

export interface CohortFilter {
  diagnosis: string | 'all';
  dataCohort: string | 'all';
}

export type SelectBy = 'spread' | 'nearest';

export interface RosterInput {
  profiles: PatientProfile[];
  focalId: string;
  anchor: AnchorId;
  filter: CohortFilter;
  rankBy: MetricId;
  selectBy: SelectBy;
  k: number;
  pinned: string[];
  removed: string[];
}

export type Provenance = 'focal' | 'neighbour' | 'spread' | 'pinned' | 'off-filter' | 'no-anchor';

export interface RosterRow {
  profile: PatientProfile;
  anchorDay: number | null;
  metrics: Record<MetricId, number | null>;
  provenance: Provenance;
  centile: number | null;
}

export interface MetricStats {
  n: number;
  missing: number;
  p25: number | null;
  median: number | null;
  p75: number | null;
}

export interface Roster {
  rows: RosterRow[];
  matching: number;
  eligible: number;
  focalMissingAnchor: boolean;
  stats: MetricStats;
}

const passes = (p: PatientProfile, f: CohortFilter) =>
  (f.diagnosis === 'all' || p.diagnosisCohort === f.diagnosis) &&
  (f.dataCohort === 'all' || p.dataCohort === f.dataCohort);

export function buildRoster(input: RosterInput): Roster {
  const { profiles, focalId, anchor, filter, rankBy, selectBy, k, pinned, removed } = input;
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const focal = byId.get(focalId);

  const matchingList = profiles.filter((p) => passes(p, filter));
  const eligibleList = matchingList.filter((p) => p.anchorDays[anchor] != null);

  const values = eligibleList
    .map((p) => metricsFor(p, anchor)[rankBy])
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  const at = (q: number) => (values.length ? values[Math.min(values.length - 1, Math.floor(values.length * q))] : null);
  const stats: MetricStats = {
    n: values.length,
    missing: eligibleList.length - values.length,
    p25: at(0.25),
    median: at(0.5),
    p75: at(0.75),
  };
  const centileOf = (v: number | null) =>
    v == null || !values.length ? null : Math.round((values.filter((x) => x <= v).length / values.length) * 100);

  const mk = (p: PatientProfile, provenance: Provenance): RosterRow => {
    const metrics = metricsFor(p, anchor);
    return { profile: p, anchorDay: p.anchorDays[anchor], metrics, provenance, centile: centileOf(metrics[rankBy]) };
  };

  const rows: RosterRow[] = [];
  const taken = new Set<string>();

  if (focal) {
    rows.push(mk(focal, 'focal'));
    taken.add(focal.id);
  }

  for (const id of pinned) {
    if (taken.has(id)) continue;
    const p = byId.get(id);
    if (!p) continue;
    const prov: Provenance =
      p.anchorDays[anchor] == null ? 'no-anchor' : passes(p, filter) ? 'pinned' : 'off-filter';
    rows.push(mk(p, prov));
    taken.add(id);
  }

  const focalMetric = focal ? metricsFor(focal, anchor)[rankBy] : null;
  const pool = eligibleList
    .filter((p) => !taken.has(p.id) && !removed.includes(p.id))
    .map((p) => ({ p, v: metricsFor(p, anchor)[rankBy] }))
    .filter((r): r is { p: PatientProfile; v: number } => r.v != null);

  const slots = Math.max(0, k);
  if (selectBy === 'nearest' && focalMetric != null) {
    pool.sort((a, b) => Math.abs(a.v - focalMetric) - Math.abs(b.v - focalMetric) || a.p.id.localeCompare(b.p.id));
    for (const r of pool.slice(0, slots)) rows.push(mk(r.p, 'neighbour'));
  } else {
    pool.sort((a, b) => a.v - b.v || a.p.id.localeCompare(b.p.id));
    const picked = new Set<number>();
    for (let i = 0; i < slots && pool.length; i++) {
      const q = slots === 1 ? 0.5 : i / (slots - 1);
      let idx = Math.round(q * (pool.length - 1));
      while (picked.has(idx) && idx < pool.length - 1) idx++;
      while (picked.has(idx) && idx > 0) idx--;
      if (picked.has(idx)) break;
      picked.add(idx);
      const r = pool[idx];
      rows.push(mk(r.p, 'spread'));
    }
  }

  const rest = rows.filter((r) => r.provenance !== 'focal');
  rest.sort((a, b) => {
    const av = a.metrics[rankBy];
    const bv = b.metrics[rankBy];
    if (av == null) return 1;
    if (bv == null) return -1;
    return av - bv;
  });

  return {
    rows: [...rows.filter((r) => r.provenance === 'focal'), ...rest],
    matching: matchingList.length,
    eligible: eligibleList.length,
    focalMissingAnchor: !!focal && focal.anchorDays[anchor] == null,
    stats,
  };
}
