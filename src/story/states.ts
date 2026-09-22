import type { ClinicalEvent, PatientStoryline } from '../core';
import { DAYS_PER_YEAR } from '../core';

/**
 * Axis spine
 */

export interface Measure {
  id: string;
  label: string;
  days: number;
  fromDay: number;
  toDay: number;
  bracket: boolean;
}

export interface Track {
  anchorDay: number;
  terminalDay: number;
  terminalKind: 'death' | 'last_contact' | 'last_event';
  terminalEventId: string | null;
  measures: Measure[];
  treatmentDays: number;
  assumptions: string[];
}

/** how far an interval with no recorded stop date is drawn before it is cut off */
export const OPEN_TAIL_DAYS = 21;

const start = (e: ClinicalEvent) => e.time.startDay;

interface Span {
  start: number;
  end: number;
  open: boolean;
}

/** recorded treatment windows only: regimens & radiation courses */
export function treatmentSpans(events: ClinicalEvent[]): Span[] {
  const spans: Span[] = [];
  for (const e of events) {
    const s = start(e);
    if (s == null) continue;
    if (e.category !== 'chemotherapy' && e.category !== 'radiation') continue;
    const hasEnd = e.time.endDay != null && (e.time.endDay as number) >= s;
    spans.push({ start: s, end: hasEnd ? (e.time.endDay as number) : s + OPEN_TAIL_DAYS, open: !hasEnd });
  }
  return spans.sort((a, b) => a.start - b.start);
}

function unionLength(spans: Span[]): number {
  let total = 0;
  let cs: number | null = null;
  let ce = 0;
  for (const s of spans) {
    if (cs == null) {
      cs = s.start;
      ce = s.end;
    } else if (s.start <= ce) ce = Math.max(ce, s.end);
    else {
      total += ce - cs;
      cs = s.start;
      ce = s.end;
    }
  }
  return cs == null ? 0 : total + (ce - cs);
}

/** longest stretch between anchor and terminal covered by no recorded treatment */
function longestUntreatedGap(spans: Span[], from: number, to: number): { days: number; at: [number, number] } {
  let best = { days: 0, at: [from, from] as [number, number] };
  let cursor = from;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start > cursor) {
      const d = Math.min(s.start, to) - cursor;
      if (d > best.days) best = { days: d, at: [cursor, Math.min(s.start, to)] };
    }
    cursor = Math.max(cursor, s.end);
    if (cursor >= to) break;
  }
  if (to > cursor && to - cursor > best.days) best = { days: to - cursor, at: [cursor, to] };
  return best;
}

export function deriveTrack(story: PatientStoryline): Track {
  const dated = story.events.filter((e) => start(e) != null);
  const assumptions: string[] = [];

  const dx = dated.find((e) => e.eventType === 'diagnosis');
  const anchorDay = dx ? (start(dx) as number) : story.domain[0];
  if (!dx) assumptions.push('no Initial CNS Tumor row; the axis is anchored on the earliest dated event');

  const death = dated.find((e) => e.eventType === 'death');
  const lastContact = dated.find((e) => e.eventType === 'last_contact');
  const lastAnything = dated.length
    ? Math.max(...dated.map((e) => e.time.endDay ?? (start(e) as number)))
    : anchorDay;

  let terminalDay = lastAnything;
  let terminalKind: Track['terminalKind'] = 'last_event';
  let terminalEventId: string | null = null;
  if (death) {
    terminalDay = Math.max(start(death) as number, anchorDay);
    terminalKind = 'death';
    terminalEventId = death.id;
  } else if (lastContact) {
    terminalDay = Math.max(start(lastContact) as number, lastAnything);
    terminalKind = 'last_contact';
    terminalEventId = lastContact.id;
  } else {
    assumptions.push('no vital-status row; follow-up ends at the last dated event, which is not the same thing');
  }

  const spans = treatmentSpans(story.events);
  const openCount = spans.filter((s) => s.open).length;
  if (openCount)
    assumptions.push(
      `${openCount} therapy record${openCount > 1 ? 's have' : ' has'} no stop date; ` +
        `each is drawn ${OPEN_TAIL_DAYS} days long and marked open`,
    );
  if (spans.length)
    assumptions.push(
      'a regimen bar spans protocol start → stop, not continuous exposure; cycle-level dates are not abstracted yet',
    );

  const treatmentDays = unionLength(spans);

  // numbers that user reads off this picture
  const measures: Measure[] = [];
  const relapse = dated.find(
    (e) => e.eventType === 'progression' || e.eventType === 'recurrence' || e.eventType === 'second_malignancy',
  );
  if (relapse)
    measures.push({
      id: 'ttp',
      label: 'diagnosis → first relapse',
      days: (start(relapse) as number) - anchorDay,
      fromDay: anchorDay,
      toDay: start(relapse) as number,
      bracket: true,
    });
  measures.push({
    id: 'followup',
    label:
      terminalKind === 'death'
        ? 'diagnosis → death'
        : terminalKind === 'last_contact'
          ? 'diagnosis → last known alive'
          : 'diagnosis → last recorded event',
    days: terminalDay - anchorDay,
    fromDay: anchorDay,
    toDay: terminalDay,
    bracket: true,
  });
  if (treatmentDays > 0)
    measures.push({
      id: 'under-treatment',
      label: 'within a treatment course',
      days: treatmentDays,
      fromDay: anchorDay,
      toDay: terminalDay,
      bracket: false,
    });
  const gap = longestUntreatedGap(spans, anchorDay, terminalDay);
  if (gap.days > 0)
    measures.push({
      id: 'longest-gap',
      label: 'longest stretch with no treatment recorded',
      days: gap.days,
      fromDay: gap.at[0],
      toDay: gap.at[1],
      bracket: false,
    });

  return { anchorDay, terminalDay, terminalKind, terminalEventId, measures, treatmentDays, assumptions };
}

/** durations */
export function human(days: number): string {
  const a = Math.abs(days);
  if (a < 45) return `${Math.round(days)} d`;
  if (a < 730) return `${(days / 30.44).toFixed(a < 120 ? 1 : 0)} mo`;
  return `${(days / DAYS_PER_YEAR).toFixed(1)} y`;
}

/** signed offset from diagnosis */
export function fromDx(day: number | null, anchorDay: number): string {
  if (day == null) return '—';
  const d = day - anchorDay;
  if (Math.abs(d) < 1) return 'day 0';
  return `${d < 0 ? '−' : '+'}${human(Math.abs(d))}`;
}
