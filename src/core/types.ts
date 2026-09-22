/**
 * The normalized "chronon" from the Clinical Event Spec (slide 1 of the mock-up):
 * multimodal clinical rows -> one shared grammar for temporal composition.
 *
 * Every adapter in src/data/adapters.ts must emit ClinicalEvent objects and
 * nothing else. The timeline never reads a CSV row directly.
 */

export type EventType =
  | 'diagnosis'
  | 'progression'
  | 'recurrence'
  | 'second_malignancy'
  | 'surgery'
  | 'chemotherapy'
  | 'radiation'
  | 'death'
  | 'last_contact'
  | 'other';

export type EventCategory = 'disease' | 'surgery' | 'chemotherapy' | 'radiation' | 'status';

/** How a time value was recovered from the source table. */
export type TimeQuality =
  | 'ok'
  | 'missing' // field present but not a number ("Not Available", "Not Reported", "")
  | 'implausible' // parsed, but outside the plausible pediatric-oncology range
  | 'open_interval'; // start known, stop missing

export interface EventTime {
  /** Age in days at event start. Null when the source value was not a number. */
  startDay: number | null;
  /** Age in days at event end (interval events only). */
  endDay: number | null;
  kind: 'point' | 'interval';
  quality: TimeQuality;
  /** Exactly what was in the CSV cell, kept for provenance / QC. */
  raw: { start: string; end?: string };
}

/**
 * Where a modality-specific renderer would be asked to draw this event.
 * Nothing is wired up yet: status 'planned' renders a disabled affordance,
 * which is the honest version of the "Vitessce view / YAC view" panel in the mock.
 */
export interface ViewSpec {
  renderer: 'yac' | 'vitessce' | 'imaging' | 'pathology';
  status: 'available' | 'planned';
  label: string;
  /** Renderer-specific payload; for YAC this will become a udi-grammar spec. */
  spec?: unknown;
}

export interface ClinicalEvent {
  id: string;
  patientId: string;
  eventType: EventType;
  category: EventCategory;
  /** Short label drawn on the timeline. */
  label: string;
  /** One-line secondary label, as in the mock ("Pathology + molecular"). */
  detail: string;
  time: EventTime;
  /** Normalized, display-ready fields (stage, dose, agents, extent...). */
  context: Record<string, string | number | null>;
  source: { table: string; rowIndex: number; organization: string | null };
  /** The untouched CSV row, so every pixel can be traced back to an abstraction. */
  raw: Record<string, string>;
  viewSpecs: ViewSpec[];
  /** Data-quality notes raised during normalization. */
  flags: string[];
}

export interface Patient {
  id: string;
  birthYear: number | null;
  sex: string | null;
  race: string | null;
  ethnicity: string | null;
  diagnosisCohort: string | null; // ATRT | Medulloblastoma
  dataCohort: string | null; // radiant | cbtn-non-radiant
  organization: string | null;
  vitalStatus: string | null;
  vitalStatusDay: number | null;
  /** Integrated diagnosis from the initial CNS tumor event, if present. */
  integratedDiagnosis: string | null;
  tumorLocations: string | null;
}

export type AnchorKind = 'birth' | 'diagnosis' | 'first_progression' | 'first_surgery';

export interface Anchor {
  kind: AnchorKind;
  label: string;
  /** Age in days the anchor resolves to; null when the patient has no such event. */
  day: number | null;
  eventId: string | null;
}


export interface Episode {
  id: string;
  category: EventCategory;
  label: string;
  startDay: number;
  endDay: number;
  eventIds: string[];
}

export interface Course {
  id: string;
  /** The index event that opens the course (diagnosis, progression, recurrence...). */
  indexEventId: string;
  label: string;
  startDay: number;
  endDay: number;
  episodes: Episode[];
  eventIds: string[];
}

export interface PatientStoryline {
  patient: Patient;
  events: ClinicalEvent[];
  courses: Course[];
  anchors: Record<AnchorKind, Anchor>;
  /** Overall day range covered by usable events. */
  domain: [number, number];
  flags: string[];
}

export interface DataHealth {
  /** Logical field -> resolved CSV column (or null when nothing matched). */
  columnMap: Record<string, Record<string, string | null>>;
  unresolved: string[];
  rowCounts: Record<string, number>;
  droppedRows: { table: string; reason: string; count: number }[];
  /** Tables absent from this delivery (file not served). */
  missingTables: string[];
}
