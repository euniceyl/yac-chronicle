/**
 * Value-level normalization for PCX tables.
 *
 * PCX encodes every time as "age in days at event", as a string, with several
 * flavours of missingness ("Not Available", "Not Reported", "Not Applicable", "").
 * Birth date is a year only, so absolute calendar time is unrecoverable by design
 * — the storyline is therefore always drawn on an age / anchor-relative axis.
 */

export const DAYS_PER_YEAR = 365.25;

/** Upper bound on a believable age-in-days value for this cohort (~40y). */
const PLAUSIBLE_MAX_DAYS = 15000;
/** Values above this are almost certainly Excel date serials, not ages (44025 -> 2020-07-13). */
const EXCEL_SERIAL_MIN = 20000;

export const MISSING_TOKENS = new Set([
  '',
  'na',
  'n/a',
  'not applicable',
  'not available',
  'not availale', // typo present in the radiation table
  'not reported',
  'unavailable',
  'unknown',
]);

export function isMissing(value: string | undefined | null): boolean {
  return value == null || MISSING_TOKENS.has(value.trim().toLowerCase());
}

export interface DayValue {
  day: number | null;
  quality: 'ok' | 'missing' | 'implausible';
  flags: string[];
  raw: string;
}

/** Parse an age-in-days cell, keeping the reason when it fails. */
export function parseDay(raw: string | undefined | null): DayValue {
  const value = (raw ?? '').trim();
  if (isMissing(value)) return { day: null, quality: 'missing', flags: [], raw: value };
  if (!/^-?\d+(\.\d+)?$/.test(value))
    return { day: null, quality: 'missing', flags: [`unparsed time value "${value}"`], raw: value };

  const n = Number(value);
  const flags: string[] = [];
  if (n >= EXCEL_SERIAL_MIN) {
    flags.push(
      `age-in-days value ${n} is out of range (~${(n / DAYS_PER_YEAR).toFixed(0)}y) and looks like an Excel date serial; excluded from the timeline`,
    );
    return { day: null, quality: 'implausible', flags, raw: value };
  }
  if (n > PLAUSIBLE_MAX_DAYS)
    flags.push(`unusually late for a pediatric cohort (${(n / DAYS_PER_YEAR).toFixed(1)}y)`);
  if (n < 0) flags.push(`negative age in days (${n}); treated as day 0 for layout`);
  return { day: n, quality: 'ok', flags, raw: value };
}

export function cleanText(raw: string | undefined | null): string | null {
  const v = (raw ?? '').trim().replace(/\s+/g, ' ');
  return isMissing(v) ? null : v;
}

/** Agent lists use ";" in some sites and "," in others. */
export function splitList(raw: string | undefined | null): string[] {
  const v = cleanText(raw);
  if (!v) return [];
  return v
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface Dose {
  cGy: number | null;
  display: string | null;
  flags: string[];
}

/**
 * Radiation dose is recorded in cGy, Gy and CGE, and the magnitude does not always
 * agree with the unit (both "54 CGE" and "5400 CGE" occur). Normalize to cGy and
 * flag rows where the unit had to be overridden by magnitude.
 */
export function parseDose(rawValue: string | undefined | null, rawUnit: string | undefined | null): Dose {
  const value = cleanText(rawValue);
  const unit = cleanText(rawUnit);
  if (!value) return { cGy: null, display: null, flags: [] };
  const n = Number(value.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return { cGy: null, display: value, flags: [`unparsed dose "${value}"`] };

  const flags: string[] = [];
  const u = (unit ?? '').toLowerCase();
  let cGy: number;
  if (u === 'gy') cGy = n * 100;
  else if (u === 'cge' || u === 'cgy' || u === '') cGy = n < 200 ? n * 100 : n;
  else cGy = n < 200 ? n * 100 : n;
  if (n < 200 && (u === 'cgy' || u === 'cge'))
    flags.push(`dose "${value} ${unit}" read as ${cGy} cGy (magnitude implies Gy-scale units)`);
  if (!unit) flags.push('dose unit missing; inferred from magnitude');
  return { cGy, display: `${cGy.toLocaleString()} cGy${unit ? ` (source: ${value} ${unit})` : ''}`, flags };
}

export function formatDays(day: number | null): string {
  if (day == null) return '—';
  const years = day / DAYS_PER_YEAR;
  if (Math.abs(years) < 1) return `${day} d (${(day / 30.44).toFixed(1)} mo)`;
  return `${day} d (${years.toFixed(1)} y)`;
}
