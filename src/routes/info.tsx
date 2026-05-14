import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/info")({
  component: InfoScreen,
});

function InfoScreen() {
  return (
    <AppShell>
      <h1 className="text-xl font-bold text-foreground">מידע ומתודולוגיה</h1>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
        מה הכלי הזה עושה, מאיפה הנתונים, ומה לא תמצאו כאן.
      </p>

      <div className="mt-5 space-y-3">
        <Section title="מה הכלי עושה">
          הכלי מאפשר להזין באופן ידני מוצרי חיסכון פנסיוני (פנסיה, גמל,
          השתלמות, גמל להשקעה וביטוח מנהלים), ולקבל תמונה מצרפית של החשיפות
          העיקריות בתיק: מניות, חו״ל ומט״ח, לצד דמי הניהול הממוצעים.
        </Section>

        <Section title="מקור הנתונים">
          תוויות המסלולים ונתוני הביצועים מבוססים על המידע הפומבי של רשות שוק
          ההון, ביטוח וחיסכון בישראל. נתוני היתרה ודמי הניהול מוזנים על ידך
          באופן ידני.
        </Section>

        <Section title="איך מסווגים מסלול">
          התוויות (מניות, כללי, אג״ח, חו״ל, מט״ח) נגזרות ממאפייני המסלול
          המוצהרים. אין כאן דירוג סיכון, ציון איכות או המלצה — רק תיאור
          ניטרלי של מאפייני ההשקעה.
        </Section>

        <Section title="פרטיות">
          לא נדרש רישום. אין שמירה בשרת. כל נתון שמזינים נשמר בדפדפן של המכשיר
          הזה בלבד (localStorage) וניתן למחיקה מלאה בכל רגע ממסך “המוצרים שלי”.
        </Section>

        <Section title="הבהרה משפטית">
          המידע באתר הוא חינוכי בלבד ואינו מהווה ייעוץ פנסיוני, ייעוץ השקעות,
          שיווק פנסיוני או המלצה לפעולה. אין לראות בו תחליף לייעוץ אישי על ידי
          בעל רישיון מתאים. ביצועי עבר אינם מעידים על תשואות עתידיות.
        </Section>
      </div>

      <div className="mt-8">
        <Link
          to="/privacy"
          className="block text-center text-sm text-primary font-medium"
        >
          קרא את מסך הפרטיות וההבהרה
        </Link>
      </div>
    </AppShell>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-surface border border-border p-4">
      <h2 className="text-sm font-bold text-foreground">{title}</h2>
      <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
        {children}
      </p>
    </div>
  );
}
