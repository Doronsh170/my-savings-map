// Track data source abstraction.
//
// Today: returns demo tracks (placeholder) for prototype purposes.
// Tomorrow: will be replaced by a real data source backed by the Israeli
// Capital Market Authority public datasets, filtered by productType + issuer.
//
// The shape below is the final shape we want to consume in the UI, so the
// wizard does not need to change once real data is wired in.

import type { ProductType, TrackTag } from "./storage";

export interface Track {
  /** Stable id from the source dataset (e.g. CMA fund/track id). Optional for demo rows. */
  trackId?: string;
  /** Human-readable track name as published by the issuer. */
  trackName: string;
  /** Issuer / managing company. */
  issuer: string;
  /** Product type this track belongs to. */
  productType: ProductType;
  /** Neutral informational tags for the UI (no risk labels). */
  tags: TrackTag[];
  /** True when this row is placeholder/demo data, not real CMA data. */
  isDemo: boolean;
}

// ---- Demo dataset (prototype only) ----------------------------------------

const DEMO_TRACK_TEMPLATES: Array<{ name: string; tags: TrackTag[] }> = [
  { name: "מסלול כללי", tags: ["כללי"] },
  { name: "מסלול מנייתי", tags: ["מניות"] },
  { name: "מסלול מנייתי חו״ל", tags: ["מניות", "חו״ל", "מט״ח"] },
  { name: "מסלול אג״ח", tags: ["אג״ח"] },
  { name: "מסלול מחקה S&P 500", tags: ["מניות", "חו״ל", "מט״ח"] },
  { name: "מסלול מחקה ת״א 125", tags: ["מניות"] },
  { name: "מסלול הלכה", tags: ["כללי"] },
];

/**
 * Returns the list of tracks for a given product type + issuer.
 *
 * Currently returns demo tracks regardless of the inputs. The signature is
 * the final one — once a real adapter is plugged in, callers do not change.
 */
export function getTracksFor(
  productType: ProductType,
  issuer: string,
): Track[] {
  return DEMO_TRACK_TEMPLATES.map((t) => ({
    trackName: t.name,
    issuer,
    productType,
    tags: t.tags,
    isDemo: true,
  }));
}
