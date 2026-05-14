import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  component: PrivacyScreen,
});

const points = [
  {
    title: "הנתונים נשמרים אצלך בלבד",
    text: "כל מה שתזין נשמר בדפדפן של המכשיר הזה (localStorage). שום נתון לא נשלח לשרת.",
  },
  {
    title: "ללא הרשמה וללא פרטים אישיים",
    text: "אין צורך בשם, טלפון, אימייל, סיסמה או תעודת זהות.",
  },
  {
    title: "אין כאן ייעוץ פיננסי",
    text: "המידע מוצג לצורך הסברה והמחשה בלבד, ואינו מהווה ייעוץ, שיווק או המלצה להשקעה.",
  },
  {
    title: "מקור הנתונים",
    text: "מבוסס על מאגרי המידע הפתוחים של רשות שוק ההון, ביטוח וחיסכון.",
  },
];

function PrivacyScreen() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 px-5 pt-10 pb-8 mx-auto w-full max-w-xl">
        <h1 className="text-2xl font-bold text-foreground">פרטיות והבהרה</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          רגע לפני שמתחילים — חשוב להכיר את הכללים.
        </p>

        <ul className="mt-6 space-y-3">
          {points.map((p) => (
            <li
              key={p.title}
              className="flex gap-3 p-4 rounded-xl bg-surface border border-border"
            >
              <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground grid place-items-center shrink-0">
                <Check className="w-4 h-4" strokeWidth={3} />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {p.title}
                </div>
                <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {p.text}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-col gap-2">
          <Link
            to="/add"
            className="w-full inline-flex justify-center items-center rounded-xl bg-primary text-primary-foreground py-3.5 font-semibold shadow-sm hover:opacity-95 transition"
          >
            הבנתי, המשך
          </Link>
          <Link
            to="/"
            className="text-center text-sm text-muted-foreground hover:text-foreground py-2"
          >
            חזרה
          </Link>
        </div>
      </main>
    </div>
  );
}
