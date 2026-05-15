import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, Wallet, Info } from "lucide-react";
import type { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
  title?: string;
}

const tabs = [
  { to: "/dashboard", label: "דשבורד", icon: LayoutDashboard },
  { to: "/products", label: "המוצרים שלי", icon: Wallet },
  { to: "/info", label: "מידע", icon: Info },
] as const;

export function AppShell({ children, title }: AppShellProps) {
  const { pathname } = useLocation();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-30 bg-background/85 backdrop-blur border-b border-border">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground grid place-items-center text-sm font-bold">
              ד
            </div>
            <span className="text-sm font-semibold text-foreground leading-tight">
              החיסכון שלי בתמונה אחת
            </span>
          </Link>
          {title && (
            <span className="text-xs text-muted-foreground">{title}</span>
          )}
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 pb-44 pt-4">
        {children}
      </main>

      <p className="mx-auto max-w-3xl px-4 pb-24 text-[11px] text-muted-foreground text-center">
        כלי המחשה להצגת תמונת מצב של החיסכון שהוזן, על בסיס נתונים ציבוריים.
        <br />
        הכלי אינו ייעוץ, אינו שיווק פנסיוני או השקעות, ואינו המלצה לביצוע פעולה.
      </p>

      <nav className="fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-border">
        <div className="mx-auto max-w-3xl grid grid-cols-3">
          {tabs.map((t) => {
            const active = pathname.startsWith(t.to);
            const Icon = t.icon;
            return (
              <Link
                key={t.to}
                to={t.to}
                className={`flex flex-col items-center gap-1 py-2.5 text-xs transition-colors ${
                  active
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-5 h-5" strokeWidth={active ? 2.4 : 1.8} />
                <span>{t.label}</span>
              </Link>
            );
          })}
        </div>
        <div className="text-center text-[10px] text-muted-foreground py-1.5 border-t border-border/60 space-y-0.5">
          <div>פותח על ידי דורון שרייבמן</div>
          <div>© 2026 דורון שרייבמן. כל הזכויות שמורות.</div>
        </div>
      </nav>
    </div>
  );
}
