// Internal demo catalog of CatalogTrack records.
//
// IMPORTANT: These rows are still demo data — they are NOT real products from
// the Israeli Capital Market Authority dataset. Every row carries
// `isDemo: true` and a `sourceName` of "דמו פנימי" so the UI can clearly mark
// them. When real data is wired in, only this file (and the function below)
// will be replaced; the wizard and dashboard already consume the final shape.

import type { ProductType } from "./storage";
import type { IsoDate, Percent } from "./productModel";

export interface CatalogTrack {
  productType: ProductType;
  issuerName: string;
  trackName: string;
  /** Stable id from the source dataset. Required for real rows. */
  trackId: string;

  equityExposure?: Percent;
  foreignExposure?: Percent;
  fxExposure?: Percent;

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

// ---------------------------------------------------------------------------
// Demo catalog (6 rows: 2 פנסיה, 2 גמל, 1 השתלמות, 1 ביטוח מנהלים)
// ---------------------------------------------------------------------------

const DEMO_CATALOG: CatalogTrack[] = [
  {
    productType: "פנסיה",
    issuerName: "מנורה מבטחים",
    trackName: "מסלול כללי",
    trackId: "DEMO-PEN-MEN-001",
    equityExposure: 42,
    foreignExposure: 35,
    fxExposure: 30,
    monthlyReturn: 0.8,
    ytdReturn: 6.4,
    threeYearReturn: 18.2,
    managementFeeFromPublicData: 0.22,
    sourceName: "דמו פנימי",
    sourceDate: "2025-04-30",
    isDemo: true,
  },
  {
    productType: "פנסיה",
    issuerName: "מגדל",
    trackName: "מסלול מנייתי",
    trackId: "DEMO-PEN-MGD-002",
    equityExposure: 92,
    foreignExposure: 70,
    fxExposure: 65,
    monthlyReturn: 1.6,
    ytdReturn: 11.1,
    threeYearReturn: 28.7,
    managementFeeFromPublicData: 0.28,
    sourceName: "דמו פנימי",
    sourceDate: "2025-04-30",
    isDemo: true,
  },
  {
    productType: "גמל",
    issuerName: "אלטשולר שחם",
    trackName: "מסלול מחקה S&P 500",
    trackId: "DEMO-GML-ALT-003",
    equityExposure: 98,
    foreignExposure: 97,
    fxExposure: 95,
    monthlyReturn: 1.9,
    ytdReturn: 12.3,
    threeYearReturn: 33.5,
    managementFeeFromPublicData: 0.72,
    sourceName: "דמו פנימי",
    sourceDate: "2025-04-30",
    isDemo: true,
  },
  {
    productType: "גמל",
    issuerName: "מיטב",
    trackName: "מסלול אג״ח כללי",
    trackId: "DEMO-GML-MTV-004",
    equityExposure: 8,
    foreignExposure: 12,
    fxExposure: 10,
    monthlyReturn: 0.4,
    ytdReturn: 3.1,
    threeYearReturn: 7.4,
    managementFeeFromPublicData: 0.55,
    sourceName: "דמו פנימי",
    sourceDate: "2025-04-30",
    isDemo: true,
  },
  {
    productType: "השתלמות",
    issuerName: "ילין לפידות",
    trackName: "מסלול מנייתי",
    trackId: "DEMO-HSH-YLN-005",
    equityExposure: 95,
    foreignExposure: 60,
    fxExposure: 55,
    monthlyReturn: 1.5,
    ytdReturn: 10.4,
    threeYearReturn: 26.8,
    managementFeeFromPublicData: 0.6,
    sourceName: "דמו פנימי",
    sourceDate: "2025-04-30",
    isDemo: true,
  },
  {
    productType: "ביטוח מנהלים",
    issuerName: "הראל",
    trackName: "מסלול כללי",
    trackId: "DEMO-BMN-HRL-006",
    equityExposure: 38,
    foreignExposure: 32,
    fxExposure: 28,
    monthlyReturn: 0.7,
    ytdReturn: 5.2,
    threeYearReturn: 14.6,
    managementFeeFromPublicData: 1.05,
    sourceName: "דמו פנימי",
    sourceDate: "2025-04-30",
    isDemo: true,
  },
];

// ---------------------------------------------------------------------------
// Query API. The wizard ALWAYS goes through findTracks / findIssuers.
// When real CMA data is connected, swap DEMO_CATALOG for the real source.
// ---------------------------------------------------------------------------

export function findTracks(query: TrackQuery): CatalogTrack[] {
  const search = query.search?.trim().toLowerCase();
  return DEMO_CATALOG.filter((t) => {
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
  for (const t of DEMO_CATALOG) {
    if (t.productType === productType) set.add(t.issuerName);
  }
  return [...set];
}
