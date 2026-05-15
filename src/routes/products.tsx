import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Tag } from "@/components/Tag";
import {
  loadProducts,
  saveProducts,
  clearAll,
  type SavedProduct,
} from "@/lib/storage";

export const Route = createFileRoute("/products")({
  component: ProductsScreen,
});

function tagsFor(p: SavedProduct): string[] {
  const out: string[] = [];
  if ((p.equityExposure ?? 0) >= 50) out.push("מניות");
  if ((p.foreignExposure ?? 0) >= 50) out.push("חו״ל");
  if ((p.fxExposure ?? 0) >= 50) out.push("מט״ח");
  return out;
}

function ProductsScreen() {
  const [products, setProducts] = useState<SavedProduct[]>([]);
  const [, setHydrated] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    setProducts(loadProducts());
    setHydrated(true);
  }, []);

  function removeOne(id: string) {
    const next = products.filter((p) => p.id !== id);
    setProducts(next);
    saveProducts(next);
  }

  function resetAll() {
    clearAll();
    setProducts([]);
    setConfirmReset(false);
  }

  return (
    <AppShell>
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold text-foreground">המוצרים שלי</h1>
        <span className="text-xs text-muted-foreground">
          {products.length} פריטים
        </span>
      </div>

      {products.some((p) => p.isDemo) && (
        <div className="mt-3 rounded-xl border border-dashed border-border bg-secondary/40 px-4 py-3 text-[12px] text-muted-foreground text-center">
          מסלולים לדוגמה בלבד - לצורך המחשת הממשק
        </div>
      )}

      <Link
        to="/add"
        className="mt-4 flex items-center justify-center gap-2 w-full rounded-xl bg-primary text-primary-foreground py-3.5 font-semibold shadow-sm"
      >
        <Plus className="w-4 h-4" />
        הוסף מוצר
      </Link>

      <ul className="mt-5 space-y-2.5">
        {products.map((p) => (
          <li
            key={p.id}
            className="rounded-xl border border-border bg-surface p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    {p.productType}
                  </span>
                  {p.isDemo && (
                    <span className="inline-flex items-center rounded-full border border-dashed border-border bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      דוגמה
                    </span>
                  )}
                </div>
                <div className="text-sm font-semibold text-foreground mt-0.5 truncate">
                  {p.issuerName}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {p.trackName}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {tagsFor(p).map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
              </div>
              <div className="text-left shrink-0">
                <div className="text-sm font-bold text-foreground tabular-nums">
                  {p.userBalance.toLocaleString("he-IL")} ₪
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {p.userManagementFee == null
                    ? "לא הוזן"
                    : `${p.userManagementFee}%`}
                </div>
                <button
                  onClick={() => removeOne(p.id)}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-destructive hover:underline"
                >
                  <Trash2 className="w-3 h-3" />
                  הסר
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {products.length > 0 && (
        <div className="mt-8 rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-secondary text-destructive grid place-items-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-foreground">
                מחיקת כל הנתונים מהמכשיר
              </div>
              <div className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                הפעולה תמחק לצמיתות את כל המוצרים שהזנת. לא ניתן לשחזר.
              </div>
              {!confirmReset ? (
                <button
                  onClick={() => setConfirmReset(true)}
                  className="mt-3 text-sm font-medium text-destructive"
                >
                  מחק את הנתונים מהמכשיר
                </button>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={resetAll}
                    className="rounded-lg bg-destructive text-destructive-foreground px-3 py-2 text-xs font-semibold"
                  >
                    כן, מחק הכול
                  </button>
                  <button
                    onClick={() => setConfirmReset(false)}
                    className="rounded-lg border border-border px-3 py-2 text-xs"
                  >
                    ביטול
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
