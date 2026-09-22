# Chronicle

A clinical storyline over a normalized event layer: one child's course of
disease drawn on a real time axis, and a cohort of them aligned on a chosen
clinical anchor.

Chronicle is the storyline component of [YAC](https://github.com/hms-dbmi/udi-yac),
extracted so it can be worked on and shared without the rest of the framework.
It carries no YAC dependency — the only packages it needs are React, papaparse
and roughjs.

- **single patient** — every event the child has (disease, surgery, medical
  therapy, radiation, vital status) on one rail, drawn rough, with a derived
  clinical-state ribbon above it and course bands read out of the data.
- **multi patient** — the same composition applied across a cohort: pick an
  anchor (birth, diagnosis, first surgery, first progression), subtract, stack
  patients as rows.

This is a prototype for those two views, meant to be cloned and played with
locally.

## Running it

**This repository contains no patient data, and ships none.** Put a PCX 3.0
deidentified delivery in `data/` — the whole directory is gitignored — and the
dev server reads it from there.

```bash
pnpm install
cp /path/to/PCX_30_deid_tables/pcx_30_*.csv data/
pnpm dev            # http://localhost:5184
```

The six tables it looks for are listed in [`src/core/schema.ts`](src/core/schema.ts);
any that are absent are reported in the data-health output rather than failing
the load. The app opens on the patient with the richest trajectory in whatever
is loaded — there is no research id in source, since a hardcoded one is a
pointer to one real child.

`pnpm build` typechecks and bundles the app but deliberately copies no data
into `dist/`: a `dist/` is a static site, and one built from the real tables
would put patient-level rows on whatever server it lands on.

## Layout

```
src/core          the event layer. No React, no DOM, no bundler.
  types.ts          ClinicalEvent — the normalized "chronon" every view consumes
  schema.ts         PCX column names as alias lists — the only place they appear
  normalize.ts      age-in-days parsing, missingness, dose units, list splitting
  adapters.ts       one PCX row -> ClinicalEvent (one adapter per table)
  parse.ts          table text -> patients, events, data-health report
  storyline.ts      composition: events -> COURSE > EPISODE > EVENT + anchors

src/data/fetchTables.ts   the browser adapter, and all the I/O there is
src/story/        derived state, course bands, lanes, cohort stats, alignment
src/components/   SketchTimeline, MultiPatient, Inspector, Legend
src/rough/pen.ts  the hand-drawn stroke helpers
data/             gitignored — drop a delivery here
```

**The rule that keeps this extensible: a view never reads a CSV row, only a
`ClinicalEvent`.** Adding imaging, pathology, labs, genomics or cycle-level
therapy means writing one adapter in `src/core/` and leaving every view
untouched. That is also what makes multi-patient alignment a pure function over
the same objects — choose an anchor, subtract, stack.

`src/core` does no I/O on purpose. The parser takes table *text*, so the same
code runs in the browser, in node, and inside a host application's own loader.

Column names drift between drops, so every logical field in `schema.ts` lists
candidate column names and the loader reports whatever it could not resolve. To
adopt a new drop, add the new name to the candidate list.

## License

MIT — see [LICENSE](LICENSE).
