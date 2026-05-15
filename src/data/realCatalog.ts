// Real catalog — loaded from src/data/funds_unified.json and mapped via
// the unified mapper. To populate it, replace funds_unified.json with the
// real export from the Israeli Capital Market Authority datasets.
//
// Activate by setting CATALOG_CONFIG.useDemoData = false in src/lib/catalog.ts.
// Filtering rules (see src/lib/unifiedMapper.ts):
//   - Only rows with is_active === true are included.
//   - Missing fields are omitted (never coerced to 0).
//   - All rows here have isDemo: false.

import type { CatalogTrack } from "@/lib/catalog";
import { mapUnifiedFunds, type UnifiedFundRow } from "@/lib/unifiedMapper";
import unifiedJson from "@/data/funds_unified.json";

interface UnifiedMeta {
  dataset_max_period?: number | string | null;
  [key: string]: unknown;
}

interface UnifiedFile {
  meta?: UnifiedMeta;
  funds?: UnifiedFundRow[];
}

const file = unifiedJson as unknown as UnifiedFile;
export const realCatalog: CatalogTrack[] = mapUnifiedFunds(file.funds ?? []);

/** Returns the dataset's max report period as "YYYY/MM", or null if unknown. */
export function getDatasetMaxPeriod(): string | null {
  const fromMeta = file.meta?.dataset_max_period;
  let raw: string | null = null;
  if (fromMeta != null) {
    raw = String(fromMeta);
  } else {
    let max = 0;
    for (const f of file.funds ?? []) {
      const p = typeof f.report_period === "number"
        ? f.report_period
        : Number(f.report_period);
      if (Number.isFinite(p) && p > max) max = p;
    }
    if (max > 0) raw = String(max);
  }
  if (!raw) return null;
  if (/^\d{6}$/.test(raw)) return `${raw.slice(0, 4)}/${raw.slice(4, 6)}`;
  if (/^\d{4}-\d{2}$/.test(raw)) return raw.replace("-", "/");
  return raw;
}
