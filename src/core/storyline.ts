import type {
  Anchor,
  AnchorKind,
  ClinicalEvent,
  Course,
  Episode,
  Patient,
  PatientStoryline,
} from './types';

/**
 * composition layer: normalized events -> COURSE > EPISODE > EVENT
 */

const INDEX_TYPES = new Set(['diagnosis', 'progression', 'recurrence', 'second_malignancy']);

const EPISODE_GAP_DAYS = 45;

export function courseLabelFor(event: ClinicalEvent, counters: Record<string, number>): string {
  switch (event.eventType) {
    case 'diagnosis':
      counters.dx = (counters.dx ?? 0) + 1;
      return counters.dx > 1 ? `Initial presentation ${counters.dx}` : 'Initial presentation';
    case 'progression':
      counters.pd = (counters.pd ?? 0) + 1;
      return `Progression ${counters.pd}`;
    case 'recurrence':
      counters.rc = (counters.rc ?? 0) + 1;
      return `Recurrence ${counters.rc}`;
    case 'second_malignancy':
      counters.sm = (counters.sm ?? 0) + 1;
      return counters.sm > 1 ? `Second malignancy ${counters.sm}` : 'Second malignancy';
    default:
      return 'Course';
  }
}

function eventStart(e: ClinicalEvent): number | null {
  return e.time.startDay;
}

function eventEnd(e: ClinicalEvent): number | null {
  return e.time.endDay ?? e.time.startDay;
}

function buildEpisodes(courseId: string, events: ClinicalEvent[]): Episode[] {
  const episodes: Episode[] = [];
  const byCategory = new Map<string, ClinicalEvent[]>();
  for (const e of events) {
    if (eventStart(e) == null) continue;
    const list = byCategory.get(e.category) ?? [];
    list.push(e);
    byCategory.set(e.category, list);
  }

  for (const [category, list] of byCategory) {
    list.sort((a, b) => (eventStart(a) ?? 0) - (eventStart(b) ?? 0));
    let bucket: ClinicalEvent[] = [];
    const flush = () => {
      if (!bucket.length) return;
      const start = Math.min(...bucket.map((e) => eventStart(e) as number));
      const end = Math.max(...bucket.map((e) => eventEnd(e) ?? (eventStart(e) as number)));
      episodes.push({
        id: `${courseId}:${category}:${start}`,
        category: category as Episode['category'],
        label:
          bucket.length === 1
            ? bucket[0].label
            : `${bucket.length} × ${bucket[0].category === 'chemotherapy' ? 'regimen' : bucket[0].category}`,
        startDay: start,
        endDay: end,
        eventIds: bucket.map((e) => e.id),
      });
      bucket = [];
    };
    for (const e of list) {
      if (!bucket.length) {
        bucket.push(e);
        continue;
      }
      const prevEnd = Math.max(...bucket.map((b) => eventEnd(b) ?? 0));
      if ((eventStart(e) as number) - prevEnd <= EPISODE_GAP_DAYS) bucket.push(e);
      else {
        flush();
        bucket.push(e);
      }
    }
    flush();
  }
  return episodes.sort((a, b) => a.startDay - b.startDay);
}

function reconcileTerminalEvents(events: ClinicalEvent[]): ClinicalEvent[] {
  const deaths = events.filter((e) => e.eventType === 'death');
  if (deaths.length < 2) return events;
  const primary =
    deaths.find((e) => e.source.table === 'event') ?? deaths[0];
  const others = deaths.filter((e) => e !== primary);
  const merged: ClinicalEvent = {
    ...primary,
    context: {
      ...primary.context,
      'Corroborating sources': others
        .map((o) => `${o.source.table} (${o.time.raw.start || 'no date'})`)
        .join(', '),
    },
    flags: [
      ...primary.flags,
      ...others
        .filter((o) => o.time.startDay !== primary.time.startDay)
        .map(
          (o) =>
            `death date differs between event_level (${primary.time.raw.start}) and ${o.source.table} (${o.time.raw.start})`,
        ),
    ],
  };
  return events.filter((e) => !others.includes(e)).map((e) => (e === primary ? merged : e));
}

export function buildStoryline(patient: Patient, allEvents: ClinicalEvent[]): PatientStoryline {
  const events = reconcileTerminalEvents([...allEvents]).sort((a, b) => {
    const av = eventStart(a) ?? Number.POSITIVE_INFINITY;
    const bv = eventStart(b) ?? Number.POSITIVE_INFINITY;
    if (av !== bv) return av - bv;
    // disease events sort first at the same day, as in the RADIANT wireframe
    return (a.category === 'disease' ? 0 : 1) - (b.category === 'disease' ? 0 : 1);
  });

  const dated = events.filter((e) => eventStart(e) != null);
  const flags: string[] = [];
  const undatedCount = events.length - dated.length;
  if (undatedCount)
    flags.push(
      `${undatedCount} event${undatedCount > 1 ? 's' : ''} could not be placed in time and ${undatedCount > 1 ? 'are' : 'is'} listed as undated`,
    );

  // anchors
  const firstOf = (pred: (e: ClinicalEvent) => boolean) =>
    dated.find(pred) ?? null;
  const dx = firstOf((e) => e.eventType === 'diagnosis');
  const prog = firstOf((e) => e.eventType === 'progression' || e.eventType === 'recurrence');
  const surg = firstOf((e) => e.eventType === 'surgery');
  const anchors: Record<AnchorKind, Anchor> = {
    birth: { kind: 'birth', label: 'Birth', day: 0, eventId: null },
    diagnosis: {
      kind: 'diagnosis',
      label: 'Diagnosis',
      day: dx ? eventStart(dx) : null,
      eventId: dx?.id ?? null,
    },
    first_progression: {
      kind: 'first_progression',
      label: 'First progression',
      day: prog ? eventStart(prog) : null,
      eventId: prog?.id ?? null,
    },
    first_surgery: {
      kind: 'first_surgery',
      label: 'First surgery',
      day: surg ? eventStart(surg) : null,
      eventId: surg?.id ?? null,
    },
  };
  if (!dx) flags.push('no "Initial CNS Tumor" event; diagnosis anchor unavailable');

  // courses 
  const indexEvents = dated.filter((e) => INDEX_TYPES.has(e.eventType));
  const counters: Record<string, number> = {};
  const courses: Course[] = [];
  const domainEnd = dated.length
    ? Math.max(...dated.map((e) => eventEnd(e) ?? (eventStart(e) as number)))
    : 0;

  if (!indexEvents.length && dated.length) {
    const start = Math.min(...dated.map((e) => eventStart(e) as number));
    courses.push({
      id: 'course:0',
      indexEventId: dated[0].id,
      label: 'Course',
      startDay: start,
      endDay: domainEnd,
      episodes: [],
      eventIds: [],
    });
  }

  indexEvents.forEach((idx, i) => {
    const start = eventStart(idx) as number;
    const next = indexEvents[i + 1];
    const end = next ? (eventStart(next) as number) : domainEnd;
    courses.push({
      id: `course:${i}`,
      indexEventId: idx.id,
      label: courseLabelFor(idx, counters),
      startDay: start,
      endDay: Math.max(end, start),
      episodes: [],
      eventIds: [],
    });
  });

  for (const e of dated) {
    const s = eventStart(e) as number;
    let course = courses.find((c, i) => s >= c.startDay && (i === courses.length - 1 || s < courses[i + 1].startDay));
    if (!course && courses.length) course = s < courses[0].startDay ? courses[0] : courses[courses.length - 1];
    if (course) course.eventIds.push(e.id);
  }

  const byId = new Map(events.map((e) => [e.id, e]));
  for (const c of courses) {
    c.episodes = buildEpisodes(
      c.id,
      c.eventIds.map((id) => byId.get(id)!).filter(Boolean),
    );
  }

  const domain: [number, number] = dated.length
    ? [Math.min(...dated.map((e) => eventStart(e) as number)), Math.max(domainEnd, 1)]
    : [0, 1];

  // Per-event flags repeat a lot (nine regimens with no stop date); roll them up.
  const flagCounts = new Map<string, number>();
  for (const e of events)
    for (const f of e.flags) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
  for (const [f, n] of flagCounts) flags.push(n > 1 ? `${f} (${n} rows)` : f);

  return { patient, events, courses, anchors, domain, flags };
}
