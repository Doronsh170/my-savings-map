// Catalog adapter.
//
// The wizard ALWAYS calls findTracks / findIssuersFor from this module.
// The actual source of rows is selected by CATALOG_CONFIG.useDemoData:
//
//   true  → demoCatalog       (prototype mode, isDemo: true on every row)
//   false → realCatalog       (real product data, isDemo: false on every row)
//
// To switch between modes, change ONE flag below. No other file needs to
// change. Demo badges and demo banners in the UI are driven by per-row
// `isDemo`, so they automatically disappear once real-mode rows are served.

import type { ProductType } from "./storage";
import type { IsoDate, Percent } from "./productModel";

// ---- Shared types ---------------------------------------------------------

export interface CatalogTrack {
  productType: ProductType;
  issuerName: string;
  trackName: string;
  /** Stable id from the source dataset. Required for real rows. */
  trackId: string;

  equityExposure?: Percent;
  foreignExposure?: Percent;
  fxExposure?: Percent;
  liquidAssetsExposure?: Percent;

  monthlyReturn?: Percent;
  ytdReturn?: Percent;
  threeYearReturn?: Percent;

  managementFeeFromPublicData?: Percent;

  sourceName: string;
  sourceDate: IsoDate;

  /** True for prototype rows. Real rows from the CMA dataset must set false. */
  isDemo: boolean;
}

export interface TrackQuery {
  productType: ProductType;
  /** When omitted, returns rows for the product type across all issuers. */
  issuerName?: string;
  /** Optional case-insensitive substring match on trackName / trackId. */
  search?: string;
}

// ---- Single configuration switch -----------------------------------------

export const CATALOG_CONFIG = {
  /**
   * true  → serve from src/data/demoCatalog.ts (prototype mode)
   * false → serve from src/data/realCatalog.ts (real product mode)
   *
   * No other code needs to change. UI demo badges/warnings are driven by
   * per-row `isDemo`, so flipping this flag also turns them off.
   */
  useDemoData: true as boolean,
};

// ---- Source selection -----------------------------------------------------

import { demoCatalog } from "@/data/demoCatalog";
import { realCatalog } from "@/data/realCatalog";

function activeCatalog(): CatalogTrack[] {
  return CATALOG_CONFIG.useDemoData ? demoCatalog : realCatalog;
}

// ---- Query API ------------------------------------------------------------

export function findTracks(query: TrackQuery): CatalogTrack[] {
  const search = query.search?.trim().toLowerCase();
  return activeCatalog().filter((t) => {
    if (t.productType !== query.productType) return false;
    if (query.issuerName && t.issuerName !== query.issuerName) return false;
    if (search) {
      const hay = `${t.trackName} ${t.trackId}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

export function findIssuersFor(productType: ProductType): string[] {
  const set = new Set<string>();
  for (const t of activeCatalog()) {
    if (t.productType === productType) set.add(t.issuerName);
  }
  return [...set];
}
