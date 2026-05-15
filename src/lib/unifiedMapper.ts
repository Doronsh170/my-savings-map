// Mapper: unified funds JSON row → CatalogTrack.
//
// The unified file (src/data/funds_unified.json) is produced from the
// Israeli CMA public datasets (גמל-נט, פנסיה-נט, ביטוח-נט) and merged into
// a single shape. This module is the ONLY place that knows about that
// shape — the rest of the app only sees `CatalogTrack`.
//
// Rules:
//   - Skip rows where is_active !== true.
//   - Never invent values. null/undefined source fields → omitted target fields.
//   - 0 is a real value and is preserved.
//   - managementFeeFromPublicData stays reference-only (never used as the
//     user's actual fee in calculations).

import type { CatalogTrack } from "@/lib/catalog";
import type { ProductType } from "@/lib/storage";
import type { IsoDate, Percent } from "@/lib/productModel";

export interface UnifiedFundRow {
  uid?: string | null;
  source?: "gemelnet" | "pensia" | "bituach" | string | null;
  source_label?: string | null;
  fund_id?: string | number | null;
  fund_name?: string | null;
  managing_corp?: string | null;
  parent_company_name?: string | null;
  classification?: string | null;
  specialization?: string | null;
  sub_specialization?: string | null;
  report_period?: string | number | null;
  total_assets?: number | null;
  current_date?: string | null;

  avg_annual_management_fee?: number | null;
  monthly_yield?: number | null;
  ytd_yield?: number | null;
  yield_trailing_3yrs?: number | null;
  yield_trailing_5yrs?: number | null;
  avg_annual_yield_3yrs?: number | null;
  avg_annual_yield_5yrs?: number | null;

  stock_pct?: number | null;
  foreign_pct?: number | null;
  fx_pct?: number | null;
  liquid_pct?: number | null;

  is_active?: boolean | null;
  [key: string]: unknown;
}

function num(v: unknown): Percent | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return v;
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function mapProductType(row: UnifiedFundRow): ProductType | null {
  const source = row.source;
  const cls = row.classification ?? "";
  if (source === "pensia") return "פנסיה";
  if (source === "bituach") return "ביטוח מנהלים";
  if (source === "gemelnet") {
    if (cls.includes("קרנות השתלמות")) return "השתלמות";
    if (cls.includes("גמל להשקעה")) return "גמל להשקעה";
    return "גמל";
  }
  return null;
}

function mapSourceName(source: unknown): string | undefined {
  if (source === "gemelnet") return "גמל-נט";
  if (source === "pensia") return "פנסיה-נט";
  if (source === "bituach") return "ביטוח-נט";
  return undefined;
}

/**
 * Convert current_date / report_period to an ISO "YYYY-MM-DD" string.
 * Accepts:
 *   - "YYYY-MM-DD" → as-is
 *   - "YYYY-MM"    → first day of that month
 *   - "YYYYMM"     → first day of that month
 *   - "DD/MM/YYYY" → reformatted
 *   - anything Date can parse → ISO date
 * Returns undefined if nothing usable.
 */
function mapDate(current: unknown, period: unknown): IsoDate | undefined {
  for (const raw of [current, period]) {
    const s = str(raw);
    if (!s) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
    if (/^\d{6}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-01`;
    const dmy = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  return undefined;
}

export function mapUnifiedFundToCatalogTrack(
  row: UnifiedFundRow,
): CatalogTrack | null {
  if (row.is_active !== true) return null;

  const productType = mapProductType(row);
  if (!productType) return null;

  const issuerName = str(row.managing_corp) ?? str(row.parent_company_name);
  const trackName = str(row.fund_name);
  if (!issuerName || !trackName) return null;

  const trackId =
    str(row.uid) ??
    (row.source && row.fund_id != null
      ? `${row.source}:${row.fund_id}`
      : undefined);
  if (!trackId) return null;

  const sourceName = mapSourceName(row.source);
  const sourceDate = mapDate(row.current_date, row.report_period);
  if (!sourceName || !sourceDate) return null;

  const track: CatalogTrack = {
    productType,
    issuerName,
    trackName,
    trackId,
    sourceName,
    sourceDate,
    isDemo: false,
  };

  const eq = num(row.stock_pct);
  if (eq !== undefined) track.equityExposure = eq;
  const fo = num(row.foreign_pct);
  if (fo !== undefined) track.foreignExposure = fo;
  const fx = num(row.fx_pct);
  if (fx !== undefined) track.fxExposure = fx;
  const liq = num(row.liquid_pct);
  if (liq !== undefined) (track as CatalogTrack & { liquidAssetsExposure?: Percent }).liquidAssetsExposure = liq;

  const mo = num(row.monthly_yield);
  if (mo !== undefined) track.monthlyReturn = mo;
  const ytd = num(row.ytd_yield);
  if (ytd !== undefined) track.ytdReturn = ytd;
  const y3 = num(row.yield_trailing_3yrs);
  if (y3 !== undefined) track.threeYearReturn = y3;
  const ay3 = num(row.avg_annual_yield_3yrs);
  if (ay3 !== undefined) track.avgAnnualYield3yrs = ay3;
  const y5 = num(row.yield_trailing_5yrs);
  if (y5 !== undefined) track.fiveYearReturn = y5;
  const ay5 = num(row.avg_annual_yield_5yrs);
  if (ay5 !== undefined) track.avgAnnualYield5yrs = ay5;

  const fee = num(row.avg_annual_management_fee);
  if (fee !== undefined) track.managementFeeFromPublicData = fee;

  const ta = num(row.total_assets);
  if (ta !== undefined) track.totalAssets = ta;
  const rp = str(row.report_period);
  if (rp !== undefined) track.reportPeriod = rp;

  return track;
}

export function mapUnifiedFunds(rows: UnifiedFundRow[]): CatalogTrack[] {
  const out: CatalogTrack[] = [];
  for (const r of rows) {
    const t = mapUnifiedFundToCatalogTrack(r);
    if (t) out.push(t);
  }
  return out;
}
