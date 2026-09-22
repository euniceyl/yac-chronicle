import type { PcxBundle } from '../core';
import { buildStoryline } from '../core';
import { deriveTrack } from './states';
import { buildCourseBands, type CourseKind } from './courses';

export interface Dist {
  id: string;
  label: string;
  unit: string;
  values: number[];
}

export interface CohortStats {
  radiationDose: Dist;
  regimenDuration: Dist;
  timeToFirstRelapse: Dist;
  survivalFromDx: Dist;
  courseDuration: Record<CourseKind, Dist>;
  resectionExtent: { value: string; n: number }[];
  protocols: { value: string; n: number }[];
  patientsScanned: number;
  multiSitePatients: number;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

const KIND_DIST_LABEL: Record<CourseKind, string> = {
  initial: 'initial presentation → first relapse',
  recurrence: 'a recurrence course, start → next event',
  progression: 'a progression course, start → next event',
  second: 'a second-malignancy course, start → next event',
  other: 'an unnamed course',
};

export function computeCohort(bundle: PcxBundle): CohortStats {
  const doses: number[] = [];
  const regimens: number[] = [];
  const ttp: number[] = [];
  const os: number[] = [];
  const courseDur: Record<CourseKind, number[]> = {
    initial: [],
    recurrence: [],
    progression: [],
    second: [],
    other: [],
  };
  const extent = new Map<string, number>();
  const protocol = new Map<string, number>();

  let patientsScanned = 0;
  let multiSitePatients = 0;

  for (const [id, events] of bundle.eventsByPatient) {
    const patient = bundle.patients.get(id);
    if (!patient) continue;
    patientsScanned++;
    const sites = new Set(events.map((e) => e.source.organization).filter(Boolean));
    if (sites.size > 1) multiSitePatients++;

    for (const e of events) {
      if (e.category === 'radiation') {
        const d = num(e.context['Total dose']);
        if (d != null && d > 0) doses.push(d);
      }
      if (e.category === 'chemotherapy') {
        if (e.time.startDay != null && e.time.endDay != null && e.time.endDay >= e.time.startDay)
          regimens.push(e.time.endDay - e.time.startDay);
        const p = e.context['Protocol / arm'];
        if (typeof p === 'string' && p) protocol.set(p, (protocol.get(p) ?? 0) + 1);
      }
      if (e.category === 'surgery') {
        const x = e.context['Extent of resection'];
        if (typeof x === 'string' && x) extent.set(x, (extent.get(x) ?? 0) + 1);
      }
    }

    const story = buildStoryline(patient, events);
    if (!story.events.some((e) => e.time.startDay != null)) continue;
    const track = deriveTrack(story);
    const dxDay = story.anchors.diagnosis.day;
    if (dxDay == null) continue;

    const firstRelapse = story.events.find(
      (e) =>
        e.time.startDay != null &&
        (e.eventType === 'progression' || e.eventType === 'recurrence' || e.eventType === 'second_malignancy'),
    );
    if (firstRelapse && (firstRelapse.time.startDay as number) >= dxDay)
      ttp.push((firstRelapse.time.startDay as number) - dxDay);

    if (track.terminalKind === 'death' && track.terminalDay > dxDay) os.push(track.terminalDay - dxDay);

    for (const b of buildCourseBands(story, track)) {
      if (b.openEnd) continue;
      const d = b.endDay - b.startDay;
      if (d > 0) courseDur[b.kind].push(d);
    }
  }

  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()]
      .map(([value, count]) => ({ value, n: count }))
      .sort((a, b) => b.n - a.n)
      .slice(0, n);

  const dist = (kind: CourseKind): Dist => ({
    id: `course-${kind}`,
    label: KIND_DIST_LABEL[kind],
    unit: 'days',
    values: courseDur[kind],
  });

  return {
    radiationDose: { id: 'dose', label: 'total radiation dose', unit: 'cGy', values: doses },
    regimenDuration: { id: 'regimen', label: 'regimen window length', unit: 'days', values: regimens },
    timeToFirstRelapse: { id: 'ttp', label: 'diagnosis → first relapse', unit: 'days', values: ttp },
    survivalFromDx: { id: 'os', label: 'diagnosis → death', unit: 'days', values: os },
    courseDuration: {
      initial: dist('initial'),
      recurrence: dist('recurrence'),
      progression: dist('progression'),
      second: dist('second'),
      other: dist('other'),
    },
    resectionExtent: top(extent, 6),
    protocols: top(protocol, 6),
    patientsScanned,
    multiSitePatients,
  };
}

export function percentile(values: number[], v: number): number | null {
  if (!values.length) return null;
  const below = values.reduce((n, x) => n + (x < v ? 1 : 0), 0);
  return Math.round((below / values.length) * 100);
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
