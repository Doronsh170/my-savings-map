import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { ChevronDown, Plus, Wallet } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ExposureBar } from "@/components/ExposureBar";
import { Tag } from "@/components/Tag";
import { PLACEHOLDER_DASHBOARD, PLACEHOLDER_PRODUCTS } from "@/lib/placeholder";
import { loadProducts, type SavedProduct } from "@/lib/storage";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const [products, setProducts] = useState<SavedProduct[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setProducts(loadProducts());
    setHydrated(true);
  }, []);

  // For prototype: if no real products yet, show placeholder demo data.
  const isDemo = hydrated && products.length === 0;
  const data = PLACEHOLDER_DASHBOARD;
  const productsToShow = isDemo ? PLACEHOLDER_PRODUCTS : products;

  const exposureByLabel = (label: string) =>
    data.exposures.find((e) => e.label === label)?.value ?? 0;

  const topCards: Array<{ label: string; helper: string }> = [
    { label: "מניות", helper: "כמה מהחיסכון נמצא במניות" },
    { label: "חו״ל", helper: "כמה מהחיסכון מושקע מחוץ לישראל" },
    { label: "מט״ח", helper: "כמה מהחיסכון מושפע ממטבע חוץ" },
  ];

  return (
    <AppShell>
      <div className="mb-4 rounded-xl border border-dashed border-border bg-secondary/40 px-4 py-3 text-[12px] text-muted-foreground text-center">
        נתוני דוגמה לצורך המחשה בלבד
      </div>

      <section>
        <div className="text-xs text-muted-foreground">סך החיסכון שהוזן</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-3xl font-extrabold text-foreground tabular-nums">
            {data.totalBalance.toLocaleString("he-IL")} ₪
          </span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {productsToShow.length} מוצרים · דמי ניהול ממוצעים לפי הסכומים שהוזנו{" "}
          {data.avgFee}%
        </div>
      </section>

      <section className="mt-6 grid grid-cols-3 gap-2.5">
        {topCards.map((c) => (
          <BigStat
            key={c.label}
            label={c.label}
            value={exposureByLabel(c.label)}
            helper={c.helper}
          />
        ))}
      </section>

      <section className="mt-6 rounded-2xl bg-surface border border-border p-5">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-base font-bold text-foreground">
            פירוט החשיפות
          </h2>
          <span className="text-[11px] text-muted-foreground">% מהחיסכון</span>
        </div>
        <div className="space-y-4">
          {data.exposures.map((e, i) => (
            <ExposureBar
              key={e.label}
              label={e.label}
              value={e.value}
              tone={i === 0 ? "primary" : "primary"}
            />
          ))}
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground leading-relaxed">
          התוויות מוצגות לפי מאפייני המסלול בלבד (מניות, חו״ל, מט״ח, אג״ח, כללי)
          ואינן מהוות הערכת סיכון או המלצה.
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
            {productsToShow.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] text-muted-foreground">
                      {p.type}
                    </div>
                    <div className="text-sm font-semibold text-foreground mt-0.5">
                      {p.issuer}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {p.track}
                    </div>
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-bold text-foreground tabular-nums">
                      {p.balance.toLocaleString("he-IL")} ₪
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      דמי ניהול {p.fee}%
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {p.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Collapsible>

        <Collapsible title="אינדיקציית ביצועי מסלולים">
          <PlaceholderBlock
            icon="📊"
            text="כאן יוצגו נתוני תשואות עבר של המסלולים שבחרת, מתוך הנתונים הפומביים של רשות שוק ההון. לוגיקת החישוב תחובר בשלב הבא."
          />
        </Collapsible>

        <Collapsible title="סימולציה על בסיס תשואות עבר">
          <PlaceholderBlock
            icon="📈"
            text="המחשה כיצד היה מתנהג סך החיסכון בהתבסס על תשואות העבר של המסלולים. ביצועי עבר אינם מעידים על העתיד."
          />
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
  value: number;
  helper?: string;
}) {
  return (
    <div className="rounded-2xl bg-surface border border-border p-3">
      <div className="text-[11px] text-muted-foreground">חשיפה ל{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-primary tabular-nums">
        {value}%
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full bg-gold rounded-full"
          style={{ width: `${value}%` }}
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

function PlaceholderBlock({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="rounded-xl bg-secondary/50 border border-dashed border-border p-4 flex gap-3">
      <div className="text-2xl">{icon}</div>
      <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>
    </div>
  );
}
