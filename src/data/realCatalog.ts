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

interface UnifiedFile {
  meta?: unknown;
  funds?: UnifiedFundRow[];
}

const file = unifiedJson as unknown as UnifiedFile;
export const realCatalog: CatalogTrack[] = mapUnifiedFunds(file.funds ?? []);
