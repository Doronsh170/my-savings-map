import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { getDatasetMaxPeriod } from "@/data/realCatalog";

export const Route = createFileRoute("/info")({
  component: InfoScreen,
});

function InfoScreen() {
  const period = getDatasetMaxPeriod();
  return (
    <AppShell>
      <h1 className="text-xl font-bold text-foreground">מה חשוב לדעת?</h1>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
        כל מה שכדאי לדעת על הכלי, בקצרה ובשפה פשוטה.
      </p>
      {period && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground text-center">
          נתונים מעודכנים לתקופה: {period}
        </div>
      )}

      <div className="mt-5 space-y-3">
        <Card title="מה הכלי עושה">
          הכלי עוזר לראות בתמונה אחת איך החיסכון שהוזן מחולק: מניות, חו״ל,
          מט״ח ודמי ניהול.
        </Card>

        <Card title="מאיפה הנתונים?">
          הנתונים מבוססים על מאגרי מידע ציבוריים של רשות שוק ההון.
        </Card>

        <Card title="מה לגבי פרטיות?">
          אין הרשמה, אין שרת, והנתונים נשמרים רק במכשיר שלך, בדפדפן שבו
          השתמשת.
        </Card>

        <Card title="חשוב לדעת">
          הכלי אינו ייעוץ, אינו שיווק פנסיוני או השקעות, ואינו המלצה לביצוע פעולה.
        </Card>
      </div>

      <div className="mt-5">
        <Collapsible title="רוצה להבין איך זה מחושב?">
          <Sub title="איך מסכמים את החיסכון">
            סך החיסכון הוא סכום היתרות שהזנת.
            <br />
            מוצר בלי יתרה לא נכלל.
          </Sub>

          <Sub title="איך מחשבים את החשיפות">
            לכל מסלול יש מאפיינים (מניות, חו״ל, מט״ח ועוד).
            <br />
            הכלי בודק כמה כסף יש בכל מסלול, ומחשב איזה חלק מהחיסכון נמצא בכל
            קטגוריה.
          </Sub>

          <Sub title="איך מחשבים את דמי הניהול הממוצעים">
            זה ממוצע לפי הסכומים שהזנת.
            <br />
            מוצרים עם יתרה גבוהה משפיעים יותר על הממוצע.
          </Sub>

          <Sub title="איך מסווגים מסלול">
            התוויות (מניות, כללי, אג״ח, חו״ל, מט״ח) מבוססות על מאפייני המסלול
            במאגרי רשות שוק ההון.
            <br />
            אין כאן דירוג סיכון או המלצה — רק תיאור.
          </Sub>

          <Sub title="ביצועי עבר">
            ביצועי עבר אינם מעידים על תשואות עתידיות.
          </Sub>
        </Collapsible>
      </div>

      <div className="mt-8">
        <Link
          to="/privacy"
          className="block text-center text-sm text-primary font-medium"
        >
          קרא את מסך הפרטיות וההבהרה
        </Link>
      </div>

      <p className="mt-6 text-center text-[11px] text-muted-foreground">
        פותח על ידי דורון שרייבמן
      </p>
    </AppShell>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-surface border border-border p-4">
      <h2 className="text-sm font-bold text-foreground">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
        {children}
      </p>
    </div>
  );
}

function Collapsible({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
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
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

function Sub({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-xs font-bold text-foreground">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
        {children}
      </p>
    </div>
  );
}
