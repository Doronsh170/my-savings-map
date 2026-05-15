// Ported 1:1 from the original index.html calculator.
// Do NOT change these constants or the loop logic.

export const SIM_RAW_YIELDS: Record<"low" | "medium" | "high", number[]> = {
  low: [
    22.66, 6.42, 13.62, 15.6, 0.18, 9.39, 1.67, 5.01, 6.11, 5.12, 3.33, 5.27,
    8.12, -0.3, -0.37, 7.07, 10.05, 5.98, 0.61, 9.16, 1.05, 2.83, 6.99, -0.06,
    13.25, 10.47, 3.05, -13.89, 8.6, 5.03,
  ],
  medium: [
    30.82, 14.37, 23.6, 22.47, 9.89, 0.71, -4.99, -7.81, 17.2, 8.09, 4.06,
    10.29, 6.78, -14.72, 11.58, 11.81, 6.85, 10.61, 15.11, 11.89, 1.21, 7.3,
    14.1, -2.55, 22.29, 14.8, 15.54, -16.96, 17.26, 14.61,
  ],
  high: [
    35.83, 20.56, 30.78, 27.0, 17.98, -6.46, -10.11, -18.26, 25.56, 10.11, 4.63,
    14.24, 5.95, -30.89, 22.23, 14.18, 3.49, 14.6, 28.03, 13.24, 1.37, 10.66,
    19.73, -3.81, 29.05, 17.35, 25.18, -18.02, 23.84, 22.23,
  ],
};

export type RiskTrack = "low" | "medium" | "high";

export const SIM_RISK_LABELS: Record<RiskTrack, string> = {
  low: "סיכון נמוך",
  medium: "סיכון בינוני",
  high: "סיכון גבוה",
};

export function getSimulationRiskTrack(stockPct: number): RiskTrack {
  const pct = Number(stockPct) || 0;
  if (pct <= 10) return "low";
  if (pct <= 70) return "medium";
  return "high";
}

export interface SimulationInput {
  totalBalance: number;
  monthly: number;
  years: number; // 1..30
  feePct: number;
  track: RiskTrack;
}

export interface SimulationResult {
  initialBalance: number;
  futureContributions: number;
  gain: number;
  finalAmount: number;
}

export function runSimulation(input: SimulationInput): SimulationResult {
  const { totalBalance, monthly, years, feePct, track } = input;
  const yields = SIM_RAW_YIELDS[track];

  let amount = totalBalance;
  let futureContributions = 0;
  const monthlyFee = feePct / 100 / 12;

  for (let y = 0; y < years; y++) {
    const annualYield = (yields[y % yields.length] || 0) / 100;
    const monthlyYield = annualYield / 12;
    for (let m = 0; m < 12; m++) {
      amount += amount * monthlyYield;
      amount -= amount * monthlyFee;
      if (monthly > 0) {
        amount += monthly;
        futureContributions += monthly;
      }
    }
  }

  const gain = amount - totalBalance - futureContributions;
  return {
    initialBalance: totalBalance,
    futureContributions,
    gain,
    finalAmount: amount,
  };
}
