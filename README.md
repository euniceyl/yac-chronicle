# YAC Chronicle

A clinical storyline over a normalized event layer: one patient's course of disease drawn on a real time axis, and a cohort of multiple patients aligned on a selected clinical anchor.

Chronicle is the storyline component of [YAC](https://github.com/hms-dbmi/udi-yac), currently extracted as an independent package. (No YAC dependency)

- **single patient** — every event the child has (disease, surgery, medical
  therapy, radiation, vital status) normalized on one timeline, with derived
  clinical state course bands.
- **multi patient** — same composition applied across a cohort of children, 
  aligned on a selected clinical anchor (birth, diagnosis, first surgery, first progression).

This is a prototype sketch for ARPA-H PCX.

## CLI

Locally add PCX deidentified data in `data/`. The directory is gitignored, and dev server reads files from there.

```bash
pnpm install
cp /path/to/PCX_30_deid_tables/pcx_30_*.csv data/
pnpm dev
```

Looks for 6 tables listed in [`src/core/schema.ts`](src/core/schema.ts).

`pnpm build` typechecks and bundles the app but deliberately copies no data
into `dist/`: a `dist/` is a static site, and one built from the real tables
would put patient-level rows on whatever server it lands on.

## Layout

```
src/core          Event layer
  types.ts          ClinicalEvent: normalized "chronon" for every view
  schema.ts         PCX column names
  normalize.ts      age-in-days parsing, missingness, dose units, list splitting
  adapters.ts       one PCX row -> ClinicalEvent (one adapter per table)
  parse.ts          table text -> patients, events, data-health report
  storyline.ts      composition: events -> COURSE > EPISODE > EVENT + clinical anchors

src/data/fetchTables.ts   browser adapter, I/O
src/story/        derived state, course bands, lanes, cohort stats, alignment
src/components/   SketchTimeline, MultiPatient, Inspector, Legend
src/rough/pen.ts  hand-drawn stroke helpers
data/             gitignored
```

## License

MIT — see [LICENSE](LICENSE).
