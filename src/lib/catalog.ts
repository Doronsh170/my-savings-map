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
  avgAnnualYield3yrs?: Percent;

  managementFeeFromPublicData?: Percent;

  totalAssets?: number;
  reportPeriod?: string;

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
  useDemoData: false as boolean,
};

// ---- Source selection -----------------------------------------------------

import { demoCatalog } from "@/data/demoCatalog";
import { realCatalog } from "@/data/realCatalog";

function activeCatalog(): CatalogTrack[] {
  return CATALOG_CONFIG.useDemoData ? demoCatalog : realCatalog;
}

// ---- Query API ------------------------------------------------------------

function assetsOf(t: CatalogTrack): number {
  return typeof t.totalAssets === "number" && Number.isFinite(t.totalAssets)
    ? t.totalAssets
    : 0;
}

function compareTracks(a: CatalogTrack, b: CatalogTrack): number {
  const da = assetsOf(b) - assetsOf(a);
  if (da !== 0) return da;
  const pa = a.reportPeriod ?? "";
  const pb = b.reportPeriod ?? "";
  if (pa !== pb) return pb.localeCompare(pa);
  return a.trackName.localeCompare(b.trackName, "he");
}

export function findTracks(query: TrackQuery): CatalogTrack[] {
  const search = query.search?.trim().toLowerCase();
  const rows = activeCatalog().filter((t) => {
    if (t.productType !== query.productType) return false;
    if (query.issuerName && t.issuerName !== query.issuerName) return false;
    if (search) {
      const hay = `${t.trackName} ${t.trackId}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
  return rows.sort(compareTracks);
}

export function findIssuersFor(productType: ProductType): string[] {
  const totals = new Map<string, number>();
  for (const t of activeCatalog()) {
    if (t.productType !== productType) continue;
    totals.set(t.issuerName, (totals.get(t.issuerName) ?? 0) + assetsOf(t));
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "he"))
    .map(([name]) => name);
}

export function getIssuerTotals(
  productType: ProductType,
): Array<{ issuerName: string; totalAssets: number }> {
  const totals = new Map<string, number>();
  for (const t of activeCatalog()) {
    if (t.productType !== productType) continue;
    totals.set(t.issuerName, (totals.get(t.issuerName) ?? 0) + assetsOf(t));
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "he"))
    .map(([issuerName, totalAssets]) => ({ issuerName, totalAssets }));
}

