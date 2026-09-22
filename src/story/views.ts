import type { ClinicalEvent } from '../core';
import type { CohortStats, Dist } from './cohort';
import { median, percentile } from './cohort';
import { human } from './states';
import type { CourseBand } from './courses';
import { COURSE_KIND_LABEL } from './courses';

/**
 * Modality view
 */

export type Renderer = 'imaging' | 'pathology' | 'vitessce' | 'yac';

export interface CohortRef {
  dist: Dist;
  mark: number | null;
  markLabel: string | null;
}

export interface ViewSlot {
  renderer: Renderer;
  scope: 'moment' | 'cohort';
  title: string;
  receives: string;
  ready: boolean;
  blocker?: string;
  cohort?: CohortRef;
}

const RENDERER_LABEL: Record<Renderer, string> = {
  imaging: 'imaging viewer',
  pathology: 'pathology viewer',
  vitessce: 'Vitessce',
  yac: 'YAC',
};

export const rendererLabel = (r: Renderer) => RENDERER_LABEL[r];

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

function ref(dist: Dist, mark: number | null, markLabel: string | null): CohortRef {
  return { dist, mark, markLabel };
}

export function slotsForEvent(
  event: ClinicalEvent,
  anchorDay: number,
  cohort: CohortStats,
): ViewSlot[] {
  const day = event.time.startDay;
  const rel = day == null ? 'an undated point' : `day ${day} (age), ${day - anchorDay >= 0 ? '+' : '−'}${human(Math.abs(day - anchorDay))} from diagnosis`;
  const slots: ViewSlot[] = [];

  const isDisease =
    event.eventType === 'diagnosis' ||
    event.eventType === 'progression' ||
    event.eventType === 'recurrence' ||
    event.eventType === 'second_malignancy';

  if (isDisease) {
    slots.push({
      renderer: 'imaging',
      scope: 'moment',
      title: 'the scan this call was made on',
      receives: `patient ${event.patientId}, the study nearest ${rel}`,
      ready: false,
      blocker:
        'PCX 3.0 carries no study identifier and no imaging date. `earliest_tumor_mri_date` is declared in the schema and empty; a per-study accession is what actually unlocks this.',
    });
    slots.push({
      renderer: 'pathology',
      scope: 'moment',
      title: 'the slide and the molecular call',
      receives: `integrated diagnosis "${event.context['Integrated diagnosis'] ?? '—'}" at ${rel}`,
      ready: false,
      blocker:
        'the integrated diagnosis is abstracted at event level, but there is no specimen row behind it — no block, no slide, no assay.',
    });
  }

  if (event.eventType === 'surgery') {
    slots.push({
      renderer: 'vitessce',
      scope: 'moment',
      title: 'the tissue this operation produced',
      receives: `the specimen resected at ${rel} — spatial / single-cell assays on that block`,
      ready: false,
      blocker:
        'surgery_level has no specimen identifier, so nothing joins an operation to an assay. One biospecimen table with (research_id, surgery_date, specimen_id) is the whole bridge; a Vitessce config is then a pure function of specimen_id.',
    });
    slots.push({
      renderer: 'imaging',
      scope: 'moment',
      title: 'pre- and post-operative MRI',
      receives: `the studies bracketing ${rel} — the pair the extent of resection was judged from`,
      ready: false,
      blocker: 'same missing study identifier as above.',
    });
  }

  // cohort context: real numbers, already in the drop
  if (event.eventType === 'radiation') {
    const dose = num(event.context['Total dose']);
    slots.push({
      renderer: 'yac',
      scope: 'cohort',
      title: 'is this dose usual?',
      receives:
        'a udi-grammar spec over radiation_level: total dose binned across the cohort, this course marked',
      ready: true,
      cohort: ref(cohort.radiationDose, dose, dose != null ? `${dose.toLocaleString()} cGy` : null),
    });
  }

  if (event.eventType === 'chemotherapy') {
    const dur =
      event.time.startDay != null && event.time.endDay != null ? event.time.endDay - event.time.startDay : null;
    slots.push({
      renderer: 'yac',
      scope: 'cohort',
      title: 'is this regimen unusually long?',
      receives:
        'a udi-grammar spec over medical_therapy_level: regimen length across the cohort, this regimen marked',
      ready: true,
      cohort: ref(cohort.regimenDuration, dur, dur != null ? `${dur} d` : 'no stop date recorded'),
    });
  }

  if (event.eventType === 'surgery') {
    slots.push({
      renderer: 'yac',
      scope: 'cohort',
      title: 'how this resection compares',
      receives: `extent of resection across ${cohort.resectionExtent.reduce((n, r) => n + r.n, 0).toLocaleString()} operations, this one highlighted`,
      ready: true,
    });
  }

  if (event.eventType === 'progression' || event.eventType === 'recurrence') {
    const d = day == null ? null : day - anchorDay;
    slots.push({
      renderer: 'yac',
      scope: 'cohort',
      title: 'early or late, for this diagnosis?',
      receives: 'a udi-grammar spec over event_level: time from diagnosis to first relapse, this patient marked',
      ready: true,
      cohort: ref(cohort.timeToFirstRelapse, d, d != null ? human(d) : null),
    });
  }

  if (event.eventType === 'death') {
    const d = day == null ? null : day - anchorDay;
    slots.push({
      renderer: 'yac',
      scope: 'cohort',
      title: 'against the cohort’s survival',
      receives: 'a udi-grammar spec over event_level + patient_level: survival from diagnosis, this patient marked',
      ready: true,
      cohort: ref(cohort.survivalFromDx, d, d != null ? human(d) : null),
    });
  }

  return slots;
}

/** slots for a selected course band */
export function slotsForCourse(band: CourseBand, cohort: CohortStats): ViewSlot[] {
  const dur = band.endDay - band.startDay;
  const dist = cohort.courseDuration[band.kind];
  const question =
    band.kind === 'initial'
      ? 'how long do others stay in first remission?'
      : `how long does a ${COURSE_KIND_LABEL[band.kind]} course usually run before the next event?`;

  const slots: ViewSlot[] = [
    {
      renderer: 'yac',
      scope: 'cohort',
      title: question,
      receives: `a udi-grammar spec over event_level: the interval between consecutive index events, ${COURSE_KIND_LABEL[band.kind]} courses only, across ${cohort.patientsScanned.toLocaleString()} patients, this one marked`,
      ready: dist.values.length > 0,
      blocker: dist.values.length ? undefined : 'no other patient in this drop has a closed course of this kind.',
      cohort: dist.values.length ? ref(dist, band.openEnd ? null : dur, band.openEnd ? 'still open at the end of the record' : human(dur)) : undefined,
    },
  ];
  return slots;
}

export function summarize(ref: CohortRef): string | null {
  const { dist, mark } = ref;
  if (!dist.values.length) return null;
  const med = median(dist.values);
  const pct = mark == null ? null : percentile(dist.values, mark);
  const medText = med == null ? '' : `median ${dist.unit === 'days' ? human(med) : `${Math.round(med).toLocaleString()} ${dist.unit}`}`;
  const pctText = pct == null ? '' : `, this one at the ${pct}${pct % 10 === 1 && pct !== 11 ? 'st' : pct % 10 === 2 && pct !== 12 ? 'nd' : pct % 10 === 3 && pct !== 13 ? 'rd' : 'th'} centile`;
  return `n = ${dist.values.length.toLocaleString()}, ${medText}${pctText}`;
}
