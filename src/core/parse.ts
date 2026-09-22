import Papa from 'papaparse';
import type { ClinicalEvent, DataHealth, Patient } from './types';
import { TABLES, resolveColumns } from './schema';
import {
  adaptEventRow,
  adaptPatientLevelRow,
  adaptRadiationRow,
  adaptSurgeryRow,
  adaptTherapyRow,
} from './adapters';
import { cleanText, parseDay } from './normalize';

export interface PcxBundle {
  patients: Map<string, Patient>;
  eventsByPatient: Map<string, ClinicalEvent[]>;
  health: DataHealth;
}

type Row = Record<string, string>;

/**
 * Raw table text, keyed by the filenames in TABLES. Absent or empty entries are
 * reported as missing tables rather than failing the whole parse.
 *
 * This layer does no I/O on purpose: it has to run in a browser, in node, and
 * inside a host application's own loader, and each of those fetches bytes
 * differently. See `fetchTables` for the fifteen-line browser adapter.
 */
export type TableTexts = Record<string, string | undefined>;

/** Filenames the core knows how to read, in load order. */
export const TABLE_FILES: string[] = TABLES.map((t) => t.file);

function parseCsv(text: string): { rows: Row[]; headers: string[] } {
  const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
  return { rows: parsed.data, headers: parsed.meta.fields ?? [] };
}

const ADAPTERS: Record<string, (row: Row, cols: Record<string, string | null>, i: number) => ClinicalEvent | null> = {
  event: adaptEventRow,
  surgery: adaptSurgeryRow,
  medicalTherapy: adaptTherapyRow,
  radiation: adaptRadiationRow,
  patientLevel: adaptPatientLevelRow,
};

export function parseTables(texts: TableTexts): PcxBundle {
  const patients = new Map<string, Patient>();
  const eventsByPatient = new Map<string, ClinicalEvent[]>();
  const health: DataHealth = {
    columnMap: {},
    unresolved: [],
    rowCounts: {},
    droppedRows: [],
    missingTables: [],
  };

  // A delivery can be missing a table entirely (the July drop had no
  // demographics). Handle each one independently and report what was absent
  // rather than failing the whole view.
  const loaded = TABLES.map((spec) => {
    const text = texts[spec.file];
    // A missing file does not always arrive as an error: a dev server's SPA
    // fallback answers 200 with index.html, which would otherwise parse into a
    // table of nonsense.
    if (!text || !text.trim() || text.trimStart().startsWith('<')) {
      health.missingTables.push(spec.file);
      health.rowCounts[spec.id] = 0;
      return { spec, rows: [] as Row[], map: {} as Record<string, string | null> };
    }
    const { rows, headers } = parseCsv(text);
    const { map, missingRequired } = resolveColumns(headers, spec);
    health.columnMap[spec.id] = map;
    health.rowCounts[spec.id] = rows.length;
    for (const f of missingRequired) health.unresolved.push(`${spec.id}.${f}`);
    return { spec, rows, map };
  });

  if (health.missingTables.length === TABLES.length)
    throw new Error(
      'No PCX tables found. Copy a deidentified delivery into data/ at the repo root — ' +
        `the app reads ${TABLE_FILES.join(', ')} from there — and restart the dev server.`,
    );

  const byId = new Map(loaded.map((l) => [l.spec.id, l]));

  // ── patients from demographics ─────────────────────────────────────────
  const demo = byId.get('demographics');
  if (demo) {
    demo.rows.forEach((row) => {
      const id = (row[demo.map.patientId ?? ''] ?? '').trim();
      if (!id) return;
      const birthYearRaw = cleanText(row[demo.map.birthYear ?? '']);
      const birthYear = birthYearRaw && /^\d{4}$/.test(birthYearRaw) ? Number(birthYearRaw) : null;
      patients.set(id, {
        id,
        // 1900 is used as an unknown-birth-year sentinel in this drop
        birthYear: birthYear && birthYear > 1901 ? birthYear : null,
        sex: normalizeSex(cleanText(row[demo.map.sex ?? ''])),
        race: cleanText(row[demo.map.race ?? '']),
        ethnicity: cleanText(row[demo.map.ethnicity ?? '']),
        diagnosisCohort: cleanText(row[demo.map.diagnosisCohort ?? '']),
        dataCohort: cleanText(row[demo.map.dataCohort ?? '']),
        organization: cleanText(row[demo.map.organization ?? '']),
        vitalStatus: null,
        vitalStatusDay: null,
        integratedDiagnosis: null,
        tumorLocations: null,
      });
    });
  }

  // ── vital status onto the patient record ───────────────────────────────
  const pl = byId.get('patientLevel');
  if (pl) {
    let dupes = 0;
    const seen = new Set<string>();
    pl.rows.forEach((row) => {
      const id = (row[pl.map.patientId ?? ''] ?? '').trim();
      const p = patients.get(id);
      if (!p) return;
      if (seen.has(id)) dupes++;
      seen.add(id);
      p.vitalStatus = cleanText(row[pl.map.vitalStatus ?? '']);
      p.vitalStatusDay = parseDay(row[pl.map.vitalStatusDay ?? '']).day;
    });
    if (dupes)
      health.droppedRows.push({
        table: 'patientLevel',
        reason: 'duplicate patient rows (last one wins)',
        count: dupes,
      });
  }

  // ── events from every table with an adapter ────────────────────────────
  for (const { spec, rows, map } of loaded) {
    const adapt = ADAPTERS[spec.id];
    if (!adapt) continue;
    let skipped = 0;
    rows.forEach((row, i) => {
      const event = adapt(row, map, i);
      if (!event) {
        skipped++;
        return;
      }
      const list = eventsByPatient.get(event.patientId) ?? [];
      list.push(event);
      eventsByPatient.set(event.patientId, list);
      // enrich the patient record from the initial diagnosis event
      if (event.eventType === 'diagnosis') {
        const p = patients.get(event.patientId);
        if (p && !p.integratedDiagnosis) {
          p.integratedDiagnosis = (event.context['Integrated diagnosis'] as string) ?? null;
          p.tumorLocations = (event.context['Tumor locations'] as string) ?? null;
        }
      }
    });
    if (skipped)
      health.droppedRows.push({ table: spec.id, reason: 'no usable patient id / value', count: skipped });
  }

  // patients that appear in event tables but not in demographics
  for (const id of eventsByPatient.keys()) {
    if (!patients.has(id))
      patients.set(id, {
        id,
        birthYear: null,
        sex: null,
        race: null,
        ethnicity: null,
        diagnosisCohort: null,
        dataCohort: null,
        organization: null,
        vitalStatus: null,
        vitalStatusDay: null,
        integratedDiagnosis: null,
        tumorLocations: null,
      });
  }

  return { patients, eventsByPatient, health };
}

function normalizeSex(v: string | null): string | null {
  if (!v) return null;
  const s = v.toLowerCase();
  if (s === 'male' || s === 'female') return s[0].toUpperCase() + s.slice(1);
  return v;
}

