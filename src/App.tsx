import { useEffect, useMemo, useState } from 'react';
import { buildStoryline, formatDays, type PcxBundle } from './core';
import { fetchTables } from './data/fetchTables';
import { SketchTimeline } from './components/SketchTimeline';
import { Inspector } from './components/Inspector';
import { Legend } from './components/Legend';
import { computeCohort } from './story/cohort';
import { deriveTrack, human } from './story/states';
import { buildCourseBands } from './story/courses';
import { MultiPatient } from './components/MultiPatient';
import { buildProfiles, type AnchorId } from './story/multi';
import type { Selection } from './selection';

type ViewMode = 'single' | 'multi';

export default function App() {
  const [bundle, setBundle] = useState<PcxBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [patientId, setPatientId] = useState<string>('');
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState<ViewMode>('single');
  const [anchor, setAnchor] = useState<AnchorId>('first_progression');

  useEffect(() => {
    fetchTables().then(setBundle).catch((e) => setError(String(e)));
  }, []);

  const roster = useMemo(() => {
    if (!bundle) return [];
    return [...bundle.patients.values()]
      .map((p) => {
        const events = bundle.eventsByPatient.get(p.id) ?? [];
        return { id: p.id, n: events.length, breadth: new Set(events.map((e) => e.category)).size, p };
      })
      .filter((r) => r.n > 0)
      .sort((a, b) => b.breadth - a.breadth || b.n - a.n || a.id.localeCompare(b.id));
  }, [bundle]);

  const cohort = useMemo(() => (bundle ? computeCohort(bundle) : null), [bundle]);

  const profiles = useMemo(() => (bundle ? buildProfiles(bundle) : []), [bundle]);

  const story = useMemo(() => {
    if (!bundle) return null;
    const patient = bundle.patients.get(patientId) ?? bundle.patients.get(roster[0]?.id ?? '');
    if (!patient) return null;
    return buildStoryline(patient, bundle.eventsByPatient.get(patient.id) ?? []);
  }, [bundle, patientId, roster]);

  const track = useMemo(() => (story ? deriveTrack(story) : null), [story]);
  const bands = useMemo(() => (story && track ? buildCourseBands(story, track) : []), [story, track]);

  useEffect(() => {
    if (!roster.length) return;
    if (!patientId || !roster.some((r) => r.id === patientId)) setPatientId(roster[0].id);
  }, [roster, patientId]);

  useEffect(() => setSelection(null), [patientId]);

  if (error)
    return (
      <div className="page">
        <p className="err">{error}</p>
      </div>
    );
  if (!bundle || !story || !track || !cohort)
    return (
      <div className="page">
        <p className="loading">reading the PCX tables…</p>
      </div>
    );

  const p = story.patient;
  const relapses = story.events.filter(
    (e) => e.eventType === 'progression' || e.eventType === 'recurrence' || e.eventType === 'second_malignancy',
  ).length;
  const surgeries = story.events.filter((e) => e.eventType === 'surgery').length;
  const regimens = story.events.filter((e) => e.eventType === 'chemotherapy').length;
  const rt = story.events.filter((e) => e.eventType === 'radiation').length;
  const undated = story.events.filter((e) => e.time.startDay == null);

  const readout = [
    `diagnosed at ${formatDays(track.anchorDay)}`,
    `${surgeries} operation${surgeries === 1 ? '' : 's'}`,
    `${regimens} regimen${regimens === 1 ? '' : 's'}`,
    rt ? `${rt} radiation course${rt === 1 ? '' : 's'}` : null,
    `${relapses} relapse${relapses === 1 ? '' : 's'}`,
    `${bands.length} course${bands.length === 1 ? '' : 's'}`,
    ...track.measures.map((m) => `${m.label} ${human(m.days)}`),
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <div className="page">
      <header>
        <h1>Chronicle</h1>
        <span className="tag">sketch</span>
        <nav className="viewswitch" role="tablist" aria-label="view">
          <button role="tab" aria-selected={view === 'single'} className={view === 'single' ? 'on' : ''} onClick={() => setView('single')}>
            single patient
          </button>
          <button role="tab" aria-selected={view === 'multi'} className={view === 'multi' ? 'on' : ''} onClick={() => setView('multi')}>
            multi patient
          </button>
        </nav>
      </header>

      <section className="who">
        <div>
          <span className="pid">{p.id}</span>
          <span className="dx">{p.integratedDiagnosis ?? p.diagnosisCohort ?? 'diagnosis not reported'}</span>
          <span className="meta">
            {[p.sex, p.birthYear ? `b. ${p.birthYear}` : null, p.organization, p.tumorLocations]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <label className="picker">
          another patient
          <select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            {roster.slice(0, 400).map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} — {r.n} events
              </option>
            ))}
          </select>
        </label>
      </section>

      {view === 'multi' ? (
        <MultiPatient
          profiles={profiles}
          focalId={p.id}
          onFocus={setPatientId}
          anchor={anchor}
          onAnchor={setAnchor}
          onOpenSingle={() => setView('single')}
        />
      ) : (
        <>
          <p className="readout">{readout}</p>

          <div className="sheet">
            <SketchTimeline story={story} track={track} bands={bands} selection={selection} onSelect={setSelection} />
            <Legend />
          </div>

          <Inspector story={story} track={track} bands={bands} cohort={cohort} selection={selection} />
        </>
      )}

      {view === 'single' && (
      <footer>
        <div className="col">
          <div className="eyebrow">what the drawing assumes</div>
          <ul>
            <li>
              a course runs from one index event to the next; both edges are abstracted dates
            </li>
            {track.assumptions.length === 0 && <li>nothing else beyond the recorded start and stop dates.</li>}
            {track.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
        <div className="col">
          <div className="eyebrow">not on the picture</div>
          <ul>
            {undated.length > 0 ? (
              undated.map((e) => (
                <li key={e.id}>
                  <button className="link" onClick={() => setSelection({ kind: 'event', id: e.id })}>
                    {e.label}
                  </button>{' '}
                  — no usable date (“{e.time.raw.start || 'empty'}”)
                </li>
              ))
            ) : (
              <li>every abstracted row for this patient landed on the axis.</li>
            )}
            <li>
              imaging, pathology, specimens, labs, CSF, performance status, trial enrollment, clinical notes
            </li>
            <li>
              the second lane group, <em>where it happened</em>, does not appear:{' '}
              {cohort.multiSitePatients === 0
                ? `all ${cohort.patientsScanned.toLocaleString()} patients in this drop carry a single organization_name, so no trajectory crosses institutions`
                : `only ${cohort.multiSitePatients.toLocaleString()} of ${cohort.patientsScanned.toLocaleString()} patients have rows from more than one institution`}
            </li>
          </ul>
        </div>
        <div className="col">
          <div className="eyebrow">where it comes from</div>
          <ul>
            <li>
              {bundle.patients.size.toLocaleString()} patients across {Object.keys(bundle.health.rowCounts).length}{' '}
              tables; cohort reference values computed over {cohort.patientsScanned.toLocaleString()} of them.
            </li>
            <li>
              event spec, adapters, and course composition come from <code>src/core</code>
            </li>
            <li>
              read from the tables in <code>data/</code>, which is gitignored and never bundled into a build
            </li>
            {bundle.health.unresolved.length > 0 && (
              <li>unresolved columns: {bundle.health.unresolved.join(', ')}</li>
            )}
          </ul>
        </div>
      </footer>
      )}
    </div>
  );
}
