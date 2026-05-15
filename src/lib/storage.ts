// Simple localStorage helpers for product data. No backend, no analytics.

import type { IsoDate, Percent } from "./productModel";

export type ProductType =
  | "פנסיה"
  | "גמל"
  | "השתלמות"
  | "גמל להשקעה"
  | "ביטוח מנהלים";

export function displayProductType(type: ProductType): string {
  if (type === "ביטוח מנהלים") return "ביטוח מנהלים / פוליסות חיסכון";
  return type;
}

/**
 * A user-saved product. Shape matches `ProductRecord` (the real-data
 * contract) so the dashboard can compute totals without a translation
 * layer. Catalog fields (exposures, returns, public fee, source) are
 * copied from the chosen `CatalogTrack` at the moment the user saves.
 */
export interface SavedProduct {
  id: string;

  productType: ProductType;
  issuerName: string;
  trackName: string;
  trackId?: string;

  /** ILS. */
  userBalance: number;
  /**
   * Management fee (%) the user actually entered. `undefined` means the user
   * did not provide a fee — it is NOT a 0% fee.
   */
  userManagementFee?: Percent;

  // Copied from the catalog row at save time.
  equityExposure?: Percent;
  foreignExposure?: Percent;
  fxExposure?: Percent;
  liquidAssetsExposure?: Percent;

  monthlyReturn?: Percent;
  ytdReturn?: Percent;
  threeYearReturn?: Percent;
  avgAnnualYield3yrs?: Percent;
  fiveYearReturn?: Percent;
  avgAnnualYield5yrs?: Percent;

  managementFeeFromPublicData?: Percent;

  /** "YYYYMM" or "YYYY-MM" — period the return figures refer to. */
  reportPeriod?: string;

  sourceName?: string;
  sourceDate?: IsoDate;

  /** True while the chosen track came from the demo catalog. */
  isDemo?: boolean;
}

const KEY = "savings-exposure-products-v2";

export function loadProducts(): SavedProduct[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedProduct[]) : [];
  } catch {
    return [];
  }
}

export function saveProducts(products: SavedProduct[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(products));
}

export function clearAll() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
