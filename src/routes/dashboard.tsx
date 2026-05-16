import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { ChevronDown, Plus, Wallet } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ExposureBar } from "@/components/ExposureBar";
import { Tag } from "@/components/Tag";
import { loadProducts, displayProductType, type SavedProduct } from "@/lib/storage";
import { getDatasetMaxPeriod } from "@/data/realCatalog";
import {
  getSimulationRiskTrack,
  runSimulation,
  SIM_RISK_LABELS,
} from "@/lib/simulation";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

const DATASET_PERIOD = getDatasetMaxPeriod();
const PUBLIC_DATA_NOTE =
  "דמי הניהול והתשואות מבוססים על נתונים ציבוריים ואינם בהכרח הנתונים האישיים שלך.";

interface WeightedResult {
  /** Weighted value (rounded), or null when no product carries this field. */
  value: number | null;
  /** True when at least one product was excluded due to missing data. */
  partial: boolean;
}

interface DashboardData {
  totalBalance: number;
  productsCount: number;
  /** null when no user entered a management fee. */
  avgFee: WeightedResult;
  exposures: Array<{ label: string; result: WeightedResult }>;
}

/**
 * Weighted average over a subset of products: products where `pick` returns
 * `undefined` are excluded from BOTH numerator and denominator. `0` is a real
 * value and IS included. Returns { value: null } when no product has the
 * field; `partial` is true when some products were excluded.
 */
function weightedBy(
  products: SavedProduct[],
  pick: (p: SavedProduct) => number | undefined,
): WeightedResult {
  let num = 0;
  let den = 0;
  let included = 0;
  for (const p of products) {
    const v = pick(p);
    if (v == null || !p.userBalance) continue;
    num += p.userBalance * v;
    den += p.userBalance;
    included += 1;
  }
  if (den <= 0 || included === 0) return { value: null, partial: false };
  return {
    value: +(num / den).toFixed(1),
    partial: included < products.length,
  };
}

function computeDashboard(products: SavedProduct[]): DashboardData {
  const totalBalance = products.reduce((s, p) => s + (p.userBalance || 0), 0);
  return {
    totalBalance,
    productsCount: products.length,
    // Fee uses ONLY userManagementFee. No fallback to public-data fee.
    avgFee: weightedBy(products, (p) => p.userManagementFee),
    exposures: [
      { label: "מניות", result: weightedBy(products, (p) => p.equityExposure) },
      { label: "חו״ל", result: weightedBy(products, (p) => p.foreignExposure) },
      { label: "מט״ח", result: weightedBy(products, (p) => p.fxExposure) },
    ],
  };
}

/** Lightweight, neutral tag list synthesized from a product's exposures. */
function tagsFor(p: SavedProduct): string[] {
  const out: string[] = [];
  if ((p.equityExposure ?? 0) >= 50) out.push("מניות");
  if ((p.foreignExposure ?? 0) >= 50) out.push("חו״ל");
  if ((p.fxExposure ?? 0) >= 50) out.push("מט״ח");
  return out;
}

function Dashboard() {
  const [products, setProducts] = useState<SavedProduct[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setProducts(loadProducts());
    setHydrated(true);
  }, []);

  const data = useMemo(() => computeDashboard(products), [products]);

  if (hydrated && products.length === 0) {
    return (
      <AppShell>
        <div className="mt-10 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-secondary text-primary grid place-items-center">
            <Wallet className="w-7 h-7" />
          </div>
          <h1 className="mt-4 text-lg font-bold text-foreground">
            עדיין לא הוזנו מוצרים
          </h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-xs">
            כדי לראות את תמונת המצב, הוסף את המוצר הראשון שלך.
          </p>
          <Link
            to="/add"
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-3 font-semibold shadow-sm"
          >
            <Plus className="w-4 h-4" />
            הוסף מוצר ראשון
          </Link>
        </div>
      </AppShell>
    );
  }

  const exposureFor = (label: string) =>
    data.exposures.find((e) => e.label === label)?.result ?? {
      value: null,
      partial: false,
    };

  const topCards: Array<{ label: string; helper: string }> = [
    { label: "מניות", helper: "כמה מהחיסכון נמצא במניות" },
    { label: "חו״ל", helper: "כמה מהחיסכון מושקע מחוץ לישראל" },
    { label: "מט״ח", helper: "כמה מהחיסכון מושפע ממטבע חוץ" },
  ];

  const anyExposurePartial = data.exposures.some((e) => e.result.partial);
  const PARTIAL_NOTE =
    "החישוב מבוסס רק על מוצרים שבהם קיים נתון חשיפה זמין.";

  return (
    <AppShell>
      {products.some((p) => p.isDemo) && (
        <div className="mb-4 rounded-xl border border-dashed border-border bg-secondary/40 px-4 py-3 text-[12px] text-muted-foreground text-center">
          נתוני דוגמה בלבד - אינם משקפים מוצרים אמיתיים
        </div>
      )}
      <section>
        <div className="text-xs text-muted-foreground">סך החיסכון שהוזן</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-3xl font-extrabold text-foreground tabular-nums">
            {data.totalBalance.toLocaleString("he-IL")} ₪
          </span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {data.productsCount} מוצרים · דמי ניהול ממוצעים לפי הסכומים שהוזנו{" "}
          {data.avgFee.value === null ? "לא הוזן" : `${data.avgFee.value}%`}
        </div>
        {data.avgFee.partial && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            החישוב מבוסס רק על מוצרים שבהם הוזנו דמי ניהול.
          </div>
        )}
      </section>

      <section className="mt-6 grid grid-cols-3 gap-2.5">
        {topCards.map((c) => {
          const r = exposureFor(c.label);
          return (
            <BigStat
              key={c.label}
              label={c.label}
              value={r.value}
              helper={c.helper}
            />
          );
        })}
      </section>

      <section className="mt-6 rounded-2xl bg-surface border border-border p-5">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-base font-bold text-foreground">
            איך מחולק החיסכון
          </h2>
          <span className="text-[11px] text-muted-foreground">% מהחיסכון</span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-4">
          איזה חלק מהחיסכון נמצא בכל סוג השקעה.
        </p>
        <div className="space-y-4">
          {data.exposures.map((e) => (
            <ExposureBar
              key={e.label}
              label={e.label}
              value={e.result.value ?? 0}
              tone="primary"
            />
          ))}
        </div>
        {anyExposurePartial && (
          <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
            {PARTIAL_NOTE}
          </p>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
          {PUBLIC_DATA_NOTE}
          {DATASET_PERIOD && ` נתונים מעודכנים לתקופה: ${DATASET_PERIOD}.`}
        </p>
        <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
          התוויות (מניות, חו״ל, מט״ח, אג״ח, כללי) מתארות את מאפייני המסלול
          בלבד, ואינן מהוות הערכת סיכון או המלצה.
        </p>
      </section>

      <Link
        to="/add"
        className="mt-5 flex items-center justify-center gap-2 w-full rounded-xl bg-primary text-primary-foreground py-3.5 font-semibold shadow-sm"
      >
        <Plus className="w-4 h-4" />
        הוסף מוצר
      </Link>

      <div className="mt-6 space-y-3">
        <Collapsible title="פירוט לפי מוצר" defaultOpen>
          <div className="space-y-2.5">
            {products.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">
                        {displayProductType(p.productType)}
                      </span>
                      {p.isDemo && (
                        <span className="inline-flex items-center rounded-full border border-dashed border-border bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          דוגמה
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-foreground mt-0.5">
                      {p.issuerName}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {p.trackName}
                    </div>
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-bold text-foreground tabular-nums">
                      {p.userBalance.toLocaleString("he-IL")} ₪
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {p.userManagementFee == null
                        ? "דמי ניהול: לא הוזן"
                        : `דמי ניהול ${p.userManagementFee}%`}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {tagsFor(p).map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Collapsible>

        <Collapsible title="אינדיקציית ביצועי מסלולים">
          <PerformanceSection products={products} />
        </Collapsible>

        <Collapsible title="סימולציה על בסיס תשואות עבר">
          <SimulationSection products={products} />
        </Collapsible>
      </div>
    </AppShell>
  );
}

function BigStat({
  label,
  value,
  helper,
}: {
  label: string;
  value: number | null;
  helper?: string;
}) {
  const display = value ?? 0;
  return (
    <div className="rounded-2xl bg-surface border border-border p-3">
      <div className="text-[11px] text-muted-foreground">חשיפה ל{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-primary tabular-nums">
        {value === null ? "—" : `${value}%`}
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full bg-gold rounded-full"
          style={{ width: `${display}%` }}
        />
      </div>
      {helper && (
        <div className="mt-2 text-[10px] text-muted-foreground leading-snug">
          {helper}
        </div>
      )}
    </div>
  );
}

function Collapsible({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl bg-surface border border-border overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-4 text-right"
      >
        <span className="text-sm font-bold text-foreground">{title}</span>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function fmtPct(v: number | null): string {
  return v === null ? "לא זמין" : `${v.toFixed(2)}%`;
}

function weightedReturn(
  products: SavedProduct[],
  pick: (p: SavedProduct) => number | undefined,
): number | null {
  let num = 0;
  let den = 0;
  let included = 0;
  for (const p of products) {
    const v = pick(p);
    if (v == null || !p.userBalance) continue;
    num += p.userBalance * v;
    den += p.userBalance;
    included += 1;
  }
  if (den <= 0 || included === 0) return null;
  return +(num / den).toFixed(2);
}

/** Format "202603" or "2026-03" → "03/2026". Returns null if unrecognized. */
function formatPeriod(raw?: string): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{6}$/.test(s)) return `${s.slice(4, 6)}/${s.slice(0, 4)}`;
  const m = s.match(/^(\d{4})[-/](\d{2})$/);
  if (m) return `${m[2]}/${m[1]}`;
  return null;
}

function periodYear(raw?: string): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})/);
  return m ? m[1] : null;
}

function PerformanceSection({ products }: { products: SavedProduct[] }) {
  const wYtd = weightedReturn(products, (p) => p.ytdReturn);
  const w3y = weightedReturn(products, (p) => p.threeYearReturn);

  const latestPeriod = products
    .map((p) => formatPeriod(p.reportPeriod))
    .filter((s): s is string => Boolean(s))
    .sort((a, b) => {
      const [am, ay] = a.split("/").map(Number);
      const [bm, by] = b.split("/").map(Number);
      return by !== ay ? by - ay : bm - am;
    })[0];

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold text-foreground">
          תשואות עבר של המסלולים שנבחרו
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          התשואות מוצגות לפי נתוני המסלולים שנבחרו.
        </div>
      </div>
      {latestPeriod && (
        <div className="text-[11px] text-muted-foreground">
          נתוני תשואה לתקופת דיווח: {latestPeriod}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <ReturnStat label="חודש אחרון" value={wMonthly} />
        <ReturnStat label="תשואה מתחילת השנה" value={wYtd} />
        <ReturnStat label="תשואה מצטברת ל-3 שנים" value={w3y} />
      </div>
      <div className="space-y-2">
        {products.map((p) => {
          const period = formatPeriod(p.reportPeriod);
          return (
          <div
            key={p.id}
            className="rounded-xl border border-border bg-surface p-3"
          >
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">
                {p.issuerName}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {p.trackName}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1 text-center">
              <ReturnCell
                label="חודש אחרון"
                value={p.monthlyReturn ?? null}
              />
              <ReturnCell
                label="תשואה מתחילת השנה"
                value={p.ytdReturn ?? null}
              />
              <ReturnCell
                label="תשואה מצטברת ל-3 שנים"
                value={p.threeYearReturn ?? null}
              />
            </div>
            <div className="mt-3 text-[10px] text-muted-foreground">
              מקור: {p.sourceName ?? "—"}
              {period && ` | נתוני תשואה לתקופת דיווח: ${period}`}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              דמי ניהול לפי נתון ציבורי:{" "}
              {p.managementFeeFromPublicData == null
                ? "לא זמין"
                : `${p.managementFeeFromPublicData}%`}
            </div>
          </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {PUBLIC_DATA_NOTE}
      </p>
    </div>
  );
}

function ReturnStat({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div className="rounded-xl bg-secondary/50 border border-border p-2 text-center">
      <div className="text-[10px] text-muted-foreground leading-tight break-words">{label}</div>
      <div className="mt-0.5 text-sm font-bold text-foreground tabular-nums">
        {fmtPct(value)}
      </div>
    </div>
  );
}

function ReturnCell({
  label,
  value,
  title,
}: {
  label: string;
  value: number | null;
  title?: string;
}) {
  return (
    <div title={title}>
      <div className="text-[10px] text-muted-foreground leading-tight break-words">{label}</div>
      <div className="text-xs font-semibold text-foreground tabular-nums">
        {fmtPct(value)}
      </div>
    </div>
  );
}

function SimulationSection({ products }: { products: SavedProduct[] }) {
  // Weighted equity exposure (numerator/denominator over products with stock_pct).
  const totalBalance = products.reduce((s, p) => s + (p.userBalance || 0), 0);
  let eqNum = 0;
  let eqDen = 0;
  let feeNum = 0;
  let feeDen = 0;
  for (const p of products) {
    if (!p.userBalance || p.userBalance <= 0) continue;
    if (p.equityExposure != null) {
      eqNum += p.userBalance * p.equityExposure;
      eqDen += p.userBalance;
    }
    if (p.userManagementFee != null) {
      feeNum += p.userBalance * p.userManagementFee;
      feeDen += p.userBalance;
    }
  }
  const stockPct = eqDen > 0 ? eqNum / eqDen : 0;
  const weightedFee = feeDen > 0 ? +(feeNum / feeDen).toFixed(2) : null;
  const track = getSimulationRiskTrack(stockPct);

  const [years, setYears] = useState(10);
  const [monthly, setMonthly] = useState(0);
  const [feeStr, setFeeStr] = useState<string>("");
  const [feeEdited, setFeeEdited] = useState(false);

  // Prefill fee with weighted user fee when not user-edited.
  useEffect(() => {
    if (!feeEdited && weightedFee != null) {
      setFeeStr(weightedFee.toFixed(2));
    }
  }, [weightedFee, feeEdited]);

  const DISCLAIMER =
    "הסימולציה מבוססת על תשואות עבר בלבד. ביצועי עבר אינם מעידים על תשואות עתידיות. אין לראות בכך ייעוץ או המלצה.";

  if (totalBalance <= 0) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          לא הוזנה יתרה להצגת הסימולציה.
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {DISCLAIMER}
        </p>
      </div>
    );
  }

  const feePct = Math.max(0, Number(feeStr) || 0);
  const safeYears = Math.max(1, Math.min(30, Math.round(years)));
  const result = runSimulation({
    totalBalance,
    monthly: Math.max(0, monthly),
    years: safeYears,
    feePct,
    track,
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-secondary/40 p-3 text-[11px] text-muted-foreground leading-relaxed">
        מסלול סיכון לסימולציה נקבע לפי החלק מהמוצרים שהוזנו שנמצא במניות:{" "}
        <span className="font-semibold text-foreground">
          {SIM_RISK_LABELS[track]}
        </span>{" "}
        ({stockPct.toFixed(1)}% מניות)
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] text-muted-foreground">מספר שנים</span>
          <input
            type="number"
            min={1}
            max={30}
            value={years}
            onChange={(e) =>
              setYears(Math.max(1, Math.min(30, Number(e.target.value) || 1)))
            }
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm tabular-nums"
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-muted-foreground">
            הפקדה חודשית (₪)
          </span>
          <input
            type="number"
            min={0}
            value={monthly}
            onChange={(e) =>
              setMonthly(Math.max(0, Number(e.target.value) || 0))
            }
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm tabular-nums"
          />
        </label>
        <label className="block col-span-2">
          <span className="text-[11px] text-muted-foreground">
            דמי ניהול שנתיים לסימולציה (%)
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={feeStr}
            onChange={(e) => {
              setFeeEdited(true);
              setFeeStr(e.target.value);
            }}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm tabular-nums"
          />
        </label>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4 space-y-2">
        <Row
          label="היתרה שהוזנה"
          value={`${Math.round(result.initialBalance).toLocaleString("he-IL")} ₪`}
        />
        <Row
          label="הפקדות חודשיות שחושבו"
          value={`${Math.round(result.futureContributions).toLocaleString("he-IL")} ₪`}
        />
        <Row
          label="תוספת מתשואות עבר"
          value={`${Math.round(result.gain).toLocaleString("he-IL")} ₪`}
        />
        <div className="pt-2 border-t border-border flex items-baseline justify-between">
          <span className="text-sm font-semibold text-foreground">
            סכום לאחר סימולציה
          </span>
          <span className="text-base font-extrabold text-primary tabular-nums">
            {Math.round(result.finalAmount).toLocaleString("he-IL")} ₪
          </span>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {DISCLAIMER}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground tabular-nums">{value}</span>
    </div>
  );
}
