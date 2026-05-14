interface ExposureBarProps {
  label: string;
  value: number; // 0-100
  tone?: "primary" | "gold";
}

export function ExposureBar({ label, value, tone = "primary" }: ExposureBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const fill =
    tone === "gold" ? "bg-gold" : "bg-primary";
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {clamped}%
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-secondary overflow-hidden">
        <div
          className={`h-full ${fill} rounded-full transition-all`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
