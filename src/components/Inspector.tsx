import { useState } from 'react';
import type { ClinicalEvent, PatientStoryline } from '../core';
import { formatDays } from '../core';
import type { CohortStats } from '../story/cohort';
import { fromDx, human, type Track } from '../story/states';
import type { CourseBand } from '../story/courses';
import { COURSE_KIND_LABEL } from '../story/courses';
import { rendererLabel, slotsForCourse, slotsForEvent, summarize, type ViewSlot } from '../story/views';
import { RoughStrip } from './RoughStrip';
import type { Selection } from '../selection';

interface Props {
  story: PatientStoryline;
  track: Track;
  bands: CourseBand[];
  cohort: CohortStats;
  selection: Selection;
}

export function Inspector({ story, track, bands, cohort, selection }: Props) {
  if (!selection)
    return (
      <div className="panel empty">
        <p>
          click a node on the rail to open the moment; 
          click on a course band above it to ask how long that stretch ran compared with everyone else
        </p>
      </div>
    );

  if (selection.kind === 'course') {
    const band = bands.find((b) => b.id === selection.id);
    if (!band) return null;
    return <CoursePanel band={band} story={story} track={track} cohort={cohort} />;
  }

  const event = story.events.find((e) => e.id === selection.id);
  if (!event) return null;
  return <EventPanel event={event} track={track} cohort={cohort} />;
}

function EventPanel({ event, track, cohort }: { event: ClinicalEvent; track: Track; cohort: CohortStats }) {
  const slots = slotsForEvent(event, track.anchorDay, cohort);
  const fields = Object.entries(event.context).filter(([, v]) => v != null && v !== '');

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">event · {event.eventType.replace(/_/g, ' ')}</div>
          <h3>{event.label}</h3>
          <div className="sub">{event.detail || '—'}</div>
        </div>
        <div className="when">
          <div className="big">{fromDx(event.time.startDay, track.anchorDay)}</div>
          <div className="sub">
            {formatDays(event.time.startDay)}
            {event.time.kind === 'interval' &&
              (event.time.endDay != null
                ? ` → ${formatDays(event.time.endDay)} · ${human(event.time.endDay - (event.time.startDay ?? 0))}`
                : ' → stop date not recorded')}
          </div>
        </div>
      </div>

      {event.time.kind === 'interval' && (
        <p className="note">
          bar spans the recorded protocol window from start to stop
        </p>
      )}

      {fields.length > 0 && (
        <dl className="fields">
          {fields.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      {event.flags.length > 0 && (
        <ul className="flags">
          {event.flags.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}

      <Slots slots={slots} />
      <Provenance event={event} />
    </div>
  );
}

function CoursePanel({
  band,
  story,
  track,
  cohort,
}: {
  band: CourseBand;
  story: PatientStoryline;
  track: Track;
  cohort: CohortStats;
}) {
  const inside = story.events.filter((e) => band.eventIds.includes(e.id));
  const index = story.events.find((e) => e.id === band.indexEventId);

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">course · {COURSE_KIND_LABEL[band.kind]}</div>
          <h3>{band.label}</h3>
          <div className="sub">
            {fromDx(band.startDay, track.anchorDay)} → {fromDx(band.endDay, track.anchorDay)}
            {band.openEnd ? ' · closes where the record ends, not where the disease did' : ''}
          </div>
        </div>
        <div className="when">
          <div className="big">{human(band.endDay - band.startDay)}</div>
          <div className="sub">{Math.round(band.endDay - band.startDay)} days</div>
        </div>
      </div>

      <p className="note">
        Opened by {index ? <strong>{index.label}</strong> : 'an index event'} on day {Math.round(band.startDay)}{' '}
        {band.openEnd
          ? '— and still open at the last thing the record knows.'
          : '— and closed by the next index event. Both edges are abstracted dates; nothing here is inferred.'}
      </p>

      {inside.length > 0 && (
        <div className="within">
          <div className="eyebrow">what happened inside it — {inside.length} records</div>
          <ul>
            {inside.map((e) => (
              <li key={e.id}>
                <span className="mono">{fromDx(e.time.startDay, track.anchorDay)}</span> {e.label}
                {e.detail ? ` — ${e.detail}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Slots slots={slotsForCourse(band, cohort)} />
    </div>
  );
}

function Slots({ slots }: { slots: ViewSlot[] }) {
  if (!slots.length)
    return (
      <div className="slots">
        <div className="eyebrow">views</div>
        <p className="note">Nothing hangs off this kind of event yet.</p>
      </div>
    );

  const moments = slots.filter((s) => s.scope === 'moment');
  const cohortSlots = slots.filter((s) => s.scope === 'cohort');

  return (
    <div className="slots">
      {moments.length > 0 && (
        <>
          <div className="eyebrow">this moment, in this child — imaging · pathology · Vitessce</div>
          <div className="slot-row">
            {moments.map((s, i) => (
              <Slot key={i} slot={s} />
            ))}
          </div>
        </>
      )}
      {cohortSlots.length > 0 && (
        <>
          <div className="eyebrow">this value, against everyone else — YAC</div>
          <div className="slot-row">
            {cohortSlots.map((s, i) => (
              <Slot key={i} slot={s} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Slot({ slot }: { slot: ViewSlot }) {
  const stat = slot.cohort ? summarize(slot.cohort) : null;
  return (
    <div className={`slot ${slot.ready ? 'ready' : 'blocked'}`}>
      <div className="slot-top">
        <span className="renderer">{rendererLabel(slot.renderer)}</span>
        <span className="stamp">{slot.ready ? 'data here, renderer not wired' : 'no data yet'}</span>
      </div>
      <div className="slot-title">{slot.title}</div>
      <div className="slot-receives">{slot.receives}</div>
      {slot.cohort && slot.cohort.dist.values.length > 0 && (
        <div className="slot-strip">
          <RoughStrip values={slot.cohort.dist.values} mark={slot.cohort.mark} />
          <div className="slot-stat">
            {slot.cohort.dist.label} · {stat}
            {slot.cohort.markLabel ? ` · this one: ${slot.cohort.markLabel}` : ''}
          </div>
        </div>
      )}
      {slot.blocker && <div className="slot-blocker">{slot.blocker}</div>}
    </div>
  );
}

function Provenance({ event }: { event: ClinicalEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="prov">
      <button className="link" onClick={() => setOpen((o) => !o)}>
        {open ? '– hide' : '+ show'} the normalized event and the row it came from
      </button>
      <div className="prov-line">
        <span className="mono">
          {event.source.table} row {event.source.rowIndex}
        </span>
        {event.source.organization ? ` · ${event.source.organization}` : ''} · id <span className="mono">{event.id}</span>
      </div>
      {open && (
        <pre className="json">
          {JSON.stringify(
            {
              id: event.id,
              eventType: event.eventType,
              category: event.category,
              label: event.label,
              time: event.time,
              context: event.context,
              source: event.source,
              flags: event.flags,
            },
            null,
            2,
          )}
          {'\n\n/* untouched source row */\n'}
          {JSON.stringify(event.raw, null, 2)}
        </pre>
      )}
    </div>
  );
}
