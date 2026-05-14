// Data model for a single pension / savings product.
//
// This is the shape the app will consume once real data from the Israeli
// Capital Market Authority (CMA) public datasets is wired in.
//
// NOTE: Nothing here is connected to real data yet, and the dashboard
// calculations are not implemented yet. This file only defines the contract
// so future work (data adapter + calculations) has a stable target.

import type { ProductType } from "./storage";

/**
 * A percentage value in the range 0–100 (e.g. 42.5 means 42.5%).
 * Used for both exposures and returns.
 */
export type Percent = number;

/** ISO date string, e.g. "2025-04-30". */
export type IsoDate = string;

export interface ProductRecord {
  // ---- Identity --------------------------------------------------------
  /** Local id for this entry in the user's list (uuid / nanoid). */
  id: string;

  // ---- What the user picked / typed -----------------------------------
  productType: ProductType;
  issuerName: string;
  trackName: string;
  /** Stable track id from the source dataset, when available. */
  trackId?: string;

  // ---- User-entered values --------------------------------------------
  /** Current balance the user reported, in ILS. */
  userBalance: number;
  /** Management fee (%) the user entered, if they chose to enter one. */
  userManagementFee?: Percent;

  // ---- Public-data exposures (from CMA), all in % ---------------------
  /** Share of the track invested in equities. */
  equityExposure?: Percent;
  /** Share of the track invested outside Israel. */
  foreignExposure?: Percent;
  /** Share of the track exposed to foreign currency. */
  fxExposure?: Percent;
  /** Share held in liquid / cash-like assets, when published. */
  liquidAssetsExposure?: Percent;

  // ---- Public-data returns, all in % ----------------------------------
  monthlyReturn?: Percent;
  ytdReturn?: Percent;
  threeYearReturn?: Percent;

  // ---- Public-data fees ------------------------------------------------
  /** Management fee published for the track itself. */
  managementFeeFromPublicData?: Percent;

  // ---- Provenance ------------------------------------------------------
  /** Human-readable source name, e.g. "רשות שוק ההון - גמל-נט". */
  sourceName?: string;
  /** Date the source data refers to. */
  sourceDate?: IsoDate;
}

// ---------------------------------------------------------------------------
// Example product (demo data only — not real CMA data).
// ---------------------------------------------------------------------------

export const EXAMPLE_PRODUCT: ProductRecord = {
  id: "demo-1",
  productType: "השתלמות",
  issuerName: "אלטשולר שחם",
  trackName: "מסלול מחקה S&P 500",
  trackId: "ALT-KH-SP500",

  userBalance: 162000,
  userManagementFee: 0.7,

  equityExposure: 98,
  foreignExposure: 97,
  fxExposure: 95,
  liquidAssetsExposure: 2,

  monthlyReturn: 1.8,
  ytdReturn: 11.4,
  threeYearReturn: 32.6,

  managementFeeFromPublicData: 0.72,

  sourceName: "רשות שוק ההון - גמל-נט",
  sourceDate: "2025-04-30",
};

// ---------------------------------------------------------------------------
// Weighted-exposure calculation (planned shape — not used by the UI yet).
//
// Idea: each exposure (equities / abroad / FX / liquid) is weighted by the
// product's userBalance, so a large product affects the total more than a
// small one. The same formula is used for the average management fee.
// ---------------------------------------------------------------------------

export interface WeightedTotals {
  totalBalance: number;
  equityExposure: Percent;
  foreignExposure: Percent;
  fxExposure: Percent;
  liquidAssetsExposure: Percent;
  avgManagementFee: Percent;
}

/**
 * Reference implementation for the weighted average. Kept here for the data
 * model spec; the dashboard will start using it in a later step.
 *
 *   weighted(field) = Σ (product.userBalance * product[field])
 *                     ─────────────────────────────────────────
 *                              Σ product.userBalance
 *
 * Products missing a given field are ignored for that field only (the
 * denominator excludes their balance for that specific field).
 */
export function computeWeightedTotals(products: ProductRecord[]): WeightedTotals {
  const totalBalance = products.reduce((s, p) => s + (p.userBalance || 0), 0);

  const weightedAvg = (pick: (p: ProductRecord) => number | undefined): Percent => {
    let num = 0;
    let den = 0;
    for (const p of products) {
      const v = pick(p);
      if (v == null || !p.userBalance) continue;
      num += p.userBalance * v;
      den += p.userBalance;
    }
    return den > 0 ? +(num / den).toFixed(2) : 0;
  };

  return {
    totalBalance,
    equityExposure: weightedAvg((p) => p.equityExposure),
    foreignExposure: weightedAvg((p) => p.foreignExposure),
    fxExposure: weightedAvg((p) => p.fxExposure),
    liquidAssetsExposure: weightedAvg((p) => p.liquidAssetsExposure),
    avgManagementFee: weightedAvg(
      (p) => p.userManagementFee ?? p.managementFeeFromPublicData,
    ),
  };
}
