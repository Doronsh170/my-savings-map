// Simple localStorage helpers for product data. No backend, no analytics.

export type ProductType = "פנסיה" | "גמל" | "השתלמות" | "גמל להשקעה" | "ביטוח מנהלים";

export type TrackTag = "מניות" | "כללי" | "אג״ח" | "חו״ל" | "מט״ח";

export interface SavedProduct {
  id: string;
  type: ProductType;
  issuer: string;
  /** Track name as displayed (kept for backward compatibility / UI). */
  track: string;
  /** Stable track id from the source dataset, when available. */
  trackId?: string;
  tags: TrackTag[];
  balance: number;
  /**
   * Management fee (%) the user actually entered. `undefined` means the user
   * did not provide a fee — it is NOT a 0% fee. The dashboard excludes such
   * products from the weighted-fee calculation.
   */
  fee?: number;
  /**
   * True while the app is in prototype mode and the chosen track is not a
   * verified record from a real product dataset. Surfaced in the UI as a
   * "דוגמה" label so the user is never shown fake data as if it were real.
   */
  isDemo?: boolean;
}

const KEY = "savings-exposure-products-v1";

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
