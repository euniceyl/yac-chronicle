import type { ClinicalEvent, EventCategory, PatientStoryline } from '../core';

/**
 * Lanes
 */

export interface Lane {
  id: string;
  label: string;
  sub: string;
  group: 'category' | 'site';
  events: ClinicalEvent[];
}

export interface LaneGroup {
  id: 'category' | 'site';
  label: string;
  lanes: Lane[];
}

const CATEGORY_ORDER: { id: EventCategory; label: string }[] = [
  { id: 'disease', label: 'disease course' },
  { id: 'surgery', label: 'surgery' },
  { id: 'chemotherapy', label: 'medical therapy' },
  { id: 'radiation', label: 'radiation' },
  { id: 'status', label: 'vital status' },
];

function shortSite(name: string): string {
  const trimmed = name
    .replace(/\b(Hospital|Medical Center|Children's|Center|Centre|University|of|the)\b/gi, (m) =>
      m.toLowerCase() === "children's" ? "Children's" : '',
    )
    .replace(/\s+/g, ' ')
    .trim();
  const out = trimmed || name;
  return out.length > 22 ? out.slice(0, 21) + '…' : out;
}

export function buildLanes(story: PatientStoryline): LaneGroup[] {
  const dated = story.events.filter((e) => e.time.startDay != null);

  const category: Lane[] = CATEGORY_ORDER.map(({ id, label }) => {
    const events = dated.filter((e) => e.category === id);
    return { id: `cat:${id}`, label, sub: `${events.length}`, group: 'category' as const, events };
  }).filter((l) => l.events.length > 0);

  const bySite = new Map<string, ClinicalEvent[]>();
  for (const e of dated) {
    const key = e.source.organization ?? '— site not recorded —';
    const list = bySite.get(key) ?? [];
    list.push(e);
    bySite.set(key, list);
  }
  const site: Lane[] = [...bySite.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([name, events]) => ({
      id: `site:${name}`,
      label: name.startsWith('—') ? name : shortSite(name),
      sub: `${events.length}`,
      group: 'site' as const,
      events,
    }));

  const groups: LaneGroup[] = [{ id: 'category', label: 'clinical record', lanes: category }];
  if (site.length > 1) groups.push({ id: 'site', label: 'where it happened', lanes: site });
  return groups;
}
