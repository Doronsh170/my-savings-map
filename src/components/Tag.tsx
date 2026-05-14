import type { ReactNode } from "react";

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground text-[11px] font-medium">
      {children}
    </span>
  );
}
