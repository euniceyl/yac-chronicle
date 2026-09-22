import { TABLE_FILES, parseTables, type PcxBundle } from '../core';

export async function fetchTables(base: string = import.meta.env.BASE_URL): Promise<PcxBundle> {
  const entries = await Promise.all(
    TABLE_FILES.map(async (file) => {
      try {
        const res = await fetch(`${base}${file}`);
        if (!res.ok) return [file, undefined] as const;
        return [file, await res.text()] as const;
      } catch {
        // a table absent from this delivery is reported by the parser, not thrown
        return [file, undefined] as const;
      }
    }),
  );
  return parseTables(Object.fromEntries(entries));
}
