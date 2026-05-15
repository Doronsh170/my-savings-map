import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, TrendingUp, Lock } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-5 pt-6">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-primary text-primary-foreground grid place-items-center text-sm font-bold">
            ד
          </div>
          <span className="text-sm font-semibold">החיסכון שלי בתמונה אחת</span>
        </div>
      </header>

      <main className="flex-1 px-5 pt-10 pb-8 mx-auto w-full max-w-xl">
        <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight text-foreground">
          כמה מהחיסכון שלך נמצא{" "}
          <span className="text-primary">במניות</span>,{" "}
          <span className="text-primary">בחו״ל</span> ו
          <span className="text-primary">במט״ח</span>?
        </h1>
        <p className="mt-4 text-base text-muted-foreground leading-relaxed">
          הכלי עוזר לראות בתמונה אחת איך החיסכון שהוזן מחולק: מניות, חו״ל,
          מט״ח ודמי ניהול.
        </p>

        <div className="mt-8 space-y-3">
          <Feature
            icon={<Lock className="w-5 h-5" />}
            title="הנתונים נשארים אצלך"
            text="הכול נשמר במכשיר בלבד. אין רישום, אין שרת."
          />
          <Feature
            icon={<TrendingUp className="w-5 h-5" />}
            title="תמונה מצרפית"
            text="חשיפה למניות, חו״ל ומט״ח — בכל המוצרים יחד."
          />
          <Feature
            icon={<ShieldCheck className="w-5 h-5" />}
            title="לא ייעוץ פיננסי"
            text="הכלי אינו ייעוץ, אינו שיווק פנסיוני או השקעות, ואינו המלצה לביצוע פעולה."
          />
        </div>

        <div className="mt-10 flex flex-col gap-3">
          <Link
            to="/privacy"
            className="w-full inline-flex justify-center items-center rounded-xl bg-primary text-primary-foreground py-3.5 font-semibold shadow-sm hover:opacity-95 transition"
          >
            בוא נתחיל
          </Link>
          <Link
            to="/info"
            className="text-center text-sm text-muted-foreground hover:text-foreground"
          >
            למידע על המתודולוגיה
          </Link>
        </div>
      </main>

      <footer className="px-5 py-6 text-center text-[11px] text-muted-foreground border-t border-border space-y-1">
        <div>פותח על ידי דורון שרייבמן</div>
        <div>© 2026 דורון שרייבמן. כל הזכויות שמורות.</div>
      </footer>
    </div>
  );
}

function Feature({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-3 p-4 rounded-xl bg-surface border border-border">
      <div className="w-9 h-9 rounded-lg bg-secondary text-primary grid place-items-center shrink-0">
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          {text}
        </div>
      </div>
    </div>
  );
}
