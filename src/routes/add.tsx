import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronRight, ArrowRight } from "lucide-react";
import { PRODUCT_TYPES, ISSUERS } from "@/lib/placeholder";
import { getTracksFor, type Track } from "@/lib/tracks";
import { loadProducts, saveProducts, type ProductType } from "@/lib/storage";
import { Tag } from "@/components/Tag";

export const Route = createFileRoute("/add")({
  component: AddWizard,
});

type Step = 1 | 2 | 3 | 4 | 5;

function AddWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [type, setType] = useState<ProductType | null>(null);
  const [issuer, setIssuer] = useState<string | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [balance, setBalance] = useState("");
  const [fee, setFee] = useState("");

  const totalSteps = 4;

  function goBack() {
    if (step === 1) {
      navigate({ to: "/dashboard" });
      return;
    }
    setStep((s) => (Math.max(1, s - 1) as Step));
  }

  function persistAndContinue(action: "add" | "view") {
    const products = loadProducts();
    products.push({
      id: `${Date.now()}`,
      type: type!,
      issuer: issuer!,
      track: track!.trackName,
      trackId: track!.trackId,
      tags: track!.tags,
      balance: Number(balance) || 0,
      fee: Number(fee) || 0,
      isDemo: true,
    });
    saveProducts(products);
    if (action === "view") {
      navigate({ to: "/dashboard" });
    } else {
      // reset wizard
      setStep(1);
      setType(null);
      setIssuer(null);
      setTrack(null);
      setBalance("");
      setFee("");
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur border-b border-border">
        <div className="mx-auto max-w-xl px-4 py-3 flex items-center gap-3">
          <button
            onClick={goBack}
            className="w-9 h-9 rounded-lg hover:bg-secondary grid place-items-center"
            aria-label="חזרה"
          >
            <ArrowRight className="w-5 h-5 text-foreground" />
          </button>
          <div className="flex-1">
            <div className="text-sm font-semibold text-foreground">
              הוספת מוצר חיסכון
            </div>
            {step <= totalSteps && (
              <div className="text-[11px] text-muted-foreground">
                שלב {step} מתוך {totalSteps}
              </div>
            )}
          </div>
        </div>
        {step <= totalSteps && (
          <div className="h-1 bg-secondary">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(step / totalSteps) * 100}%` }}
            />
          </div>
        )}
      </header>

      <main className="flex-1 mx-auto w-full max-w-xl px-4 py-6">
        {step === 1 && (
          <Step
            title="איזה סוג מוצר תרצה להוסיף?"
            subtitle="בחר את סוג החיסכון או הביטוח."
          >
            <div className="grid gap-2.5">
              {PRODUCT_TYPES.map((t) => (
                <SelectRow
                  key={t}
                  label={t}
                  selected={type === t}
                  onClick={() => {
                    setType(t);
                    setStep(2);
                  }}
                />
              ))}
            </div>
          </Step>
        )}

        {step === 2 && (
          <Step title="באיזה גוף מנהל המוצר?" subtitle={`סוג: ${type}`}>
            <div className="grid gap-2">
              {ISSUERS.map((i) => (
                <SelectRow
                  key={i}
                  label={i}
                  selected={issuer === i}
                  onClick={() => {
                    setIssuer(i);
                    setStep(3);
                  }}
                />
              ))}
            </div>
          </Step>
        )}

        {step === 3 && (
          <Step
            title="באיזה מסלול?"
            subtitle={`${type} · ${issuer}`}
          >
            <div className="mb-3 rounded-lg border border-dashed border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
              מסלולי דוגמה לצורך המחשה בלבד
            </div>
            <div className="grid gap-2">
              {getTracksFor(type!, issuer!).map((tr) => {
                const key = tr.trackId ?? tr.trackName;
                const selected =
                  (track?.trackId ?? track?.trackName) === key;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      setTrack(tr);
                      setStep(4);
                    }}
                    className={`flex items-center justify-between gap-3 text-right p-3.5 rounded-xl bg-surface border transition ${
                      selected
                        ? "border-primary"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <div className="flex flex-col gap-1.5 items-start">
                      <span className="text-sm font-medium text-foreground">
                        {tr.trackName}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {tr.tags.map((tag) => (
                          <Tag key={tag}>{tag}</Tag>
                        ))}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground rotate-180 shrink-0" />
                  </button>
                );
              })}
            </div>
          </Step>
        )}

        {step === 4 && (
          <Step
            title="פרטי היתרה ודמי הניהול"
            subtitle={`${track?.trackName} · ${issuer}`}
          >
            <div className="space-y-4">
              <Field
                label="מה היתרה המשוערת במוצר? (₪)"
                value={balance}
                onChange={setBalance}
                placeholder="לדוגמה: 120000"
                inputMode="numeric"
              />
              <Field
                label="דמי ניהול שנתיים מהצבירה (%)"
                value={fee}
                onChange={setFee}
                placeholder="לדוגמה: 0.6"
                inputMode="decimal"
              />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                ניתן למצוא את הנתונים בדוח השנתי או בחשבון האישי באתר היצרן.
                המידע נשמר במכשיר שלך בלבד.
              </p>
            </div>

            <button
              disabled={!balance}
              onClick={() => setStep(5)}
              className="mt-8 w-full inline-flex justify-center items-center rounded-xl bg-primary text-primary-foreground py-3.5 font-semibold shadow-sm disabled:opacity-40 transition"
            >
              המשך
            </button>
          </Step>
        )}

        {step === 5 && (
          <Step
            title="המוצר נוסף בהצלחה"
            subtitle="מה תרצה לעשות עכשיו?"
          >
            <div className="rounded-xl bg-surface border border-border p-4">
              <div className="text-xs text-muted-foreground">{type}</div>
              <div className="text-sm font-semibold text-foreground mt-0.5">
                {issuer} · {track?.trackName}
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                יתרה: {Number(balance).toLocaleString("he-IL")} ₪ · דמי ניהול:{" "}
                {fee || "0"}%
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2.5">
              <button
                onClick={() => persistAndContinue("add")}
                className="w-full rounded-xl border border-primary text-primary py-3.5 font-semibold hover:bg-secondary transition"
              >
                הוסף מוצר נוסף
              </button>
              <button
                onClick={() => persistAndContinue("view")}
                className="w-full rounded-xl bg-primary text-primary-foreground py-3.5 font-semibold shadow-sm hover:opacity-95 transition"
              >
                צפה בדשבורד
              </button>
            </div>
          </Step>
        )}
      </main>

      <footer className="px-5 py-4 text-center text-[11px] text-muted-foreground">
        כלי חינוכי בלבד · אין במידע משום ייעוץ
      </footer>
    </div>
  );
}

function Step({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-xl font-bold text-foreground">{title}</h2>
      {subtitle && (
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      )}
      <div className="mt-5">{children}</div>
    </div>
  );
}

function SelectRow({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between text-right p-3.5 rounded-xl bg-surface border transition ${
        selected ? "border-primary" : "border-border hover:border-primary/40"
      }`}
    >
      <span className="text-sm font-medium text-foreground">{label}</span>
      <ChevronRight className="w-4 h-4 text-muted-foreground rotate-180" />
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "numeric" | "decimal";
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="mt-1.5 w-full rounded-xl border border-input bg-surface px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
    </label>
  );
}
