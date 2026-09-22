import type { ClinicalEvent, EventType, EventCategory, ViewSpec } from './types';
import { cleanText, parseDay, parseDose, splitList } from './normalize';

type Row = Record<string, string>;
type ColMap = Record<string, string | null>;

const get = (row: Row, cols: ColMap, field: string): string => {
  const col = cols[field];
  return col ? (row[col] ?? '') : '';
};

/** PCX event_type -> normalized eventType */
const EVENT_TYPE_MAP: Record<string, EventType> = {
  'initial cns tumor': 'diagnosis',
  progressive: 'progression',
  recurrence: 'recurrence',
  'second malignancy': 'second_malignancy',
  'second primary': 'second_malignancy',
  deceased: 'death',
};

/** labels matching the RADIANT wireframe */
export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  diagnosis: 'Diagnosis',
  progression: 'Progression',
  recurrence: 'Recurrence',
  second_malignancy: 'Second malignancy',
  surgery: 'Surgery',
  chemotherapy: 'Medical therapy',
  radiation: 'Radiation',
  death: 'Deceased',
  last_contact: 'Last known status',
  other: 'Event',
};

export const CATEGORY_OF: Record<EventType, EventCategory> = {
  diagnosis: 'disease',
  progression: 'disease',
  recurrence: 'disease',
  second_malignancy: 'disease',
  surgery: 'surgery',
  chemotherapy: 'chemotherapy',
  radiation: 'radiation',
  death: 'status',
  last_contact: 'status',
  other: 'disease',
};

/**
 * placeholder view bindings
 */
function viewSpecsFor(eventType: EventType): ViewSpec[] {
  switch (eventType) {
    case 'diagnosis':
    case 'progression':
    case 'recurrence':
    case 'second_malignancy':
      return [
        { renderer: 'imaging', status: 'planned', label: 'Diagnostic MRI' },
        { renderer: 'pathology', status: 'planned', label: 'Pathology + molecular' },
        { renderer: 'vitessce', status: 'planned', label: 'Vitessce view' },
      ];
    case 'surgery':
      return [{ renderer: 'imaging', status: 'planned', label: 'Operative imaging' }];
    case 'radiation':
      return [{ renderer: 'yac', status: 'planned', label: 'YAC: dose across cohort' }];
    case 'chemotherapy':
      return [{ renderer: 'yac', status: 'planned', label: 'YAC: regimen across cohort' }];
    default:
      return [];
  }
}

function base(
  table: string,
  rowIndex: number,
  patientId: string,
  row: Row,
  cols: ColMap,
): Pick<ClinicalEvent, 'patientId' | 'source' | 'raw'> {
  return {
    patientId,
    source: { table, rowIndex, organization: cleanText(get(row, cols, 'organization')) },
    raw: row,
  };
}

export function adaptEventRow(row: Row, cols: ColMap, i: number): ClinicalEvent | null {
  const patientId = get(row, cols, 'patientId').trim();
  if (!patientId) return null;
  const rawType = cleanText(get(row, cols, 'eventType'));
  const eventType = EVENT_TYPE_MAP[(rawType ?? '').toLowerCase()] ?? 'other';
  const t = parseDay(get(row, cols, 'eventDay'));
  const integrated = cleanText(get(row, cols, 'integratedDiagnosis'));
  const category = cleanText(get(row, cols, 'diagnosisCategory'));
  const mets = cleanText(get(row, cols, 'metastasis'));
  const metsLoc = cleanText(get(row, cols, 'metastasisLocation'));

  const detailParts = [integrated ?? category ?? ''];
  if (mets === 'Yes') detailParts.push(`M+ ${metsLoc ?? ''}`.trim());

  return {
    ...base('event', i, patientId, row, cols),
    id: `event:${i}`,
    eventType,
    category: CATEGORY_OF[eventType],
    label: rawType ?? EVENT_TYPE_LABEL[eventType],
    detail: detailParts.filter(Boolean).join(' · '),
    time: { startDay: t.day, endDay: null, kind: 'point', quality: t.quality, raw: { start: t.raw } },
    context: {
      'Event type': rawType,
      'Diagnosis category': category,
      'Integrated diagnosis': integrated,
      'Tumor locations': cleanText(get(row, cols, 'tumorLocations')),
      'Tumor location (other)': cleanText(get(row, cols, 'tumorLocationOther')),
      Metastasis: mets,
      'Metastasis location': metsLoc,
      'Chang M-stage': cleanText(get(row, cols, 'changMStage')),
      'Staging method': cleanText(get(row, cols, 'stagingMethod')),
      'Medical conditions at event': cleanText(get(row, cols, 'medicalConditions')),
    },
    viewSpecs: viewSpecsFor(eventType),
    flags: t.flags,
  };
}

export function adaptSurgeryRow(row: Row, cols: ColMap, i: number): ClinicalEvent | null {
  const patientId = get(row, cols, 'patientId').trim();
  if (!patientId) return null;
  const t = parseDay(get(row, cols, 'surgeryDay'));
  const extent = cleanText(get(row, cols, 'extentOfResection'));
  const type = cleanText(get(row, cols, 'surgeryType'));
  return {
    ...base('surgery', i, patientId, row, cols),
    id: `surgery:${i}`,
    eventType: 'surgery',
    category: 'surgery',
    label: type ?? 'Surgery',
    detail: extent ?? 'Extent not reported',
    time: { startDay: t.day, endDay: null, kind: 'point', quality: t.quality, raw: { start: t.raw } },
    context: {
      'Extent of resection': extent,
      'Surgery type': type,
    },
    viewSpecs: viewSpecsFor('surgery'),
    flags: t.flags,
  };
}

export function adaptTherapyRow(row: Row, cols: ColMap, i: number): ClinicalEvent | null {
  const patientId = get(row, cols, 'patientId').trim();
  if (!patientId) return null;
  const start = parseDay(get(row, cols, 'startDay'));
  const stop = parseDay(get(row, cols, 'stopDay'));
  const agents = splitList(get(row, cols, 'agents'));
  const protocol = cleanText(get(row, cols, 'protocol'));
  const flags = [...start.flags, ...stop.flags];
  let quality: ClinicalEvent['time']['quality'] = start.quality;
  if (start.quality === 'ok' && stop.day == null) {
    quality = 'open_interval';
    flags.push('regimen stop date not reported; drawn as an open interval');
  }
  if (start.day != null && stop.day != null && stop.day < start.day)
    flags.push(`regimen stop (${stop.day}d) precedes start (${start.day}d)`);

  return {
    ...base('medicalTherapy', i, patientId, row, cols),
    id: `therapy:${i}`,
    eventType: 'chemotherapy',
    category: 'chemotherapy',
    label: protocol && protocol !== 'Not Applicable' ? protocol : 'Medical therapy',
    detail: agents.length ? agents.join(', ') : 'Agents not reported',
    time: {
      startDay: start.day,
      endDay: stop.day,
      kind: 'interval',
      quality,
      raw: { start: start.raw, end: stop.raw },
    },
    context: {
      'Protocol / arm': protocol,
      'Therapy type': cleanText(get(row, cols, 'therapyType')),
      Agents: agents.length ? agents.join(', ') : null,
      'Agent count': agents.length || null,
    },
    viewSpecs: viewSpecsFor('chemotherapy'),
    flags,
  };
}

export function adaptRadiationRow(row: Row, cols: ColMap, i: number): ClinicalEvent | null {
  const patientId = get(row, cols, 'patientId').trim();
  if (!patientId) return null;
  const start = parseDay(get(row, cols, 'startDay'));
  const stop = parseDay(get(row, cols, 'stopDay'));
  const total = parseDose(get(row, cols, 'totalDose'), get(row, cols, 'totalDoseUnit'));
  const focal = parseDose(get(row, cols, 'focalDose'), get(row, cols, 'focalDoseUnit'));
  const site = cleanText(get(row, cols, 'site'));
  const type = cleanText(get(row, cols, 'type'));
  const flags = [...start.flags, ...stop.flags, ...total.flags, ...focal.flags];
  let quality: ClinicalEvent['time']['quality'] = start.quality;
  if (start.quality === 'ok' && stop.day == null) {
    quality = 'open_interval';
    flags.push('radiation stop date not reported; drawn as an open interval');
  }

  return {
    ...base('radiation', i, patientId, row, cols),
    id: `radiation:${i}`,
    eventType: 'radiation',
    category: 'radiation',
    label: site ?? 'Radiation',
    detail: [type, focal.cGy != null ? `${focal.cGy.toLocaleString()} cGy focal` : null]
      .filter(Boolean)
      .join(' · '),
    time: {
      startDay: start.day,
      endDay: stop.day,
      kind: 'interval',
      quality,
      raw: { start: start.raw, end: stop.raw },
    },
    context: {
      Site: site,
      'Site (other)': cleanText(get(row, cols, 'siteOther')),
      Modality: type,
      'Modality (other)': cleanText(get(row, cols, 'typeOther')),
      'Total dose': total.display,
      'Focal dose': focal.display,
      'Anatomic site': cleanText(get(row, cols, 'anatomicSite')),
      'Fractions (days)':
        start.day != null && stop.day != null ? stop.day - start.day + 1 : null,
    },
    viewSpecs: viewSpecsFor('radiation'),
    flags,
  };
}

/** patient-level row -> terminal status event (death or last known contact) */
export function adaptPatientLevelRow(row: Row, cols: ColMap, i: number): ClinicalEvent | null {
  const patientId = get(row, cols, 'patientId').trim();
  if (!patientId) return null;
  const status = (cleanText(get(row, cols, 'vitalStatus')) ?? '').toLowerCase();
  const t = parseDay(get(row, cols, 'vitalStatusDay'));
  if (t.day == null && t.quality !== 'implausible') return null;
  const deceased = status.startsWith('deceased');
  return {
    ...base('patientLevel', i, patientId, row, cols),
    id: `status:${i}`,
    eventType: deceased ? 'death' : 'last_contact',
    category: 'status',
    label: deceased ? 'Deceased' : 'Last known alive',
    detail: 'Vital status',
    time: { startDay: t.day, endDay: null, kind: 'point', quality: t.quality, raw: { start: t.raw } },
    context: {
      'Vital status': cleanText(get(row, cols, 'vitalStatus')),
      'Earliest tumor MRI': cleanText(get(row, cols, 'earliestMriDay')),
      'Cancer predisposition': cleanText(get(row, cols, 'cancerPredisposition')),
    },
    viewSpecs: [],
    flags: t.flags,
  };
}
