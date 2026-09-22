import type { ClinicalEvent, EventType, PatientStoryline } from '../core';
import type { Track } from './states';

/**
 * COURSES
 */

export type CourseKind = 'initial' | 'recurrence' | 'progression' | 'second' | 'other';

export interface CourseBand {
  id: string;
  label: string;
  short: string;
  kind: CourseKind;
  startDay: number;
  endDay: number;
  indexEventId: string;
  eventIds: string[];
  openEnd: boolean;
}

const KIND_OF: Partial<Record<EventType, CourseKind>> = {
  diagnosis: 'initial',
  recurrence: 'recurrence',
  progression: 'progression',
  second_malignancy: 'second',
};

export const COURSE_STYLE: Record<
  CourseKind,
  { color: string; fillStyle: string; hachureAngle: number; hachureGap: number }
> = {
  initial: { color: '#35688f', fillStyle: 'hachure', hachureAngle: -41, hachureGap: 9 },
  recurrence: { color: '#8a6d1f', fillStyle: 'hachure', hachureAngle: 41, hachureGap: 11 },
  progression: { color: '#b3261e', fillStyle: 'cross-hatch', hachureAngle: -41, hachureGap: 18 },
  second: { color: '#6b2160', fillStyle: 'dashed', hachureAngle: 20, hachureGap: 10 },
  other: { color: '#8a8580', fillStyle: 'dots', hachureAngle: 0, hachureGap: 12 },
};

export const COURSE_KIND_LABEL: Record<CourseKind, string> = {
  initial: 'initial presentation',
  recurrence: 'recurrence',
  progression: 'progression',
  second: 'second malignancy',
  other: 'course',
};

const shorten = (label: string) =>
  label
    .replace('Initial presentation', 'Initial')
    .replace('Second malignancy', '2nd malig.')
    .replace('Recurrence', 'Rec')
    .replace('Progression', 'Prog');

export function buildCourseBands(story: PatientStoryline, track: Track): CourseBand[] {
  const byId = new Map(story.events.map((e) => [e.id, e]));
  const courses = [...story.courses].sort((a, b) => a.startDay - b.startDay);

  return courses.map((c, i) => {
    const index = byId.get(c.indexEventId) as ClinicalEvent | undefined;
    const kind = (index && KIND_OF[index.eventType]) ?? 'other';
    const last = i === courses.length - 1;
    const endDay = last ? Math.max(track.terminalDay, c.startDay) : courses[i + 1].startDay;
    return {
      id: c.id,
      label: c.label,
      short: shorten(c.label),
      kind,
      startDay: c.startDay,
      endDay,
      indexEventId: c.indexEventId,
      eventIds: c.eventIds,
      openEnd: last,
    };
  });
}

export function courseAt(bands: CourseBand[], day: number): CourseBand | null {
  return bands.find((b) => day >= b.startDay && day < b.endDay) ?? bands[bands.length - 1] ?? null;
}
