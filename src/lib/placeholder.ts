import type { ProductType, TrackTag } from "./storage";

export const PRODUCT_TYPES: ProductType[] = [
  "פנסיה",
  "גמל",
  "השתלמות",
  "גמל להשקעה",
  "ביטוח מנהלים",
];

export const ISSUERS: string[] = [
  "מנורה מבטחים",
  "מגדל",
  "הראל",
  "כלל",
  "הפניקס",
  "אלטשולר שחם",
  "מיטב",
  "מור",
  "ילין לפידות",
  "אנליסט",
];

export interface PlaceholderTrack {
  name: string;
  tags: TrackTag[];
}

export const TRACKS: PlaceholderTrack[] = [
  { name: "מסלול כללי", tags: ["כללי"] },
  { name: "מסלול מנייתי", tags: ["מניות"] },
  { name: "מסלול מנייתי חו״ל", tags: ["מניות", "חו״ל", "מט״ח"] },
  { name: "מסלול אג״ח", tags: ["אג״ח"] },
  { name: "מסלול מחקה S&P 500", tags: ["מניות", "חו״ל", "מט״ח"] },
  { name: "מסלול מחקה ת״א 125", tags: ["מניות"] },
  { name: "מסלול הלכה", tags: ["כללי"] },
];

// Placeholder dashboard data only (no calculations yet).
export const PLACEHOLDER_DASHBOARD = {
  totalBalance: 482000,
  exposures: [
    { label: "מניות", value: 58 },
    { label: "חו״ל", value: 41 },
    { label: "מט״ח", value: 36 },
    { label: "אג״ח", value: 22 },
  ],
  avgFee: 0.62,
  productsCount: 3,
};

export const PLACEHOLDER_PRODUCTS = [
  {
    id: "p1",
    type: "פנסיה" as ProductType,
    issuer: "מנורה מבטחים",
    track: "מסלול כללי",
    tags: ["כללי"] as TrackTag[],
    balance: 220000,
    fee: 0.5,
  },
  {
    id: "p2",
    type: "השתלמות" as ProductType,
    issuer: "אלטשולר שחם",
    track: "מסלול מחקה S&P 500",
    tags: ["מניות", "חו״ל", "מט״ח"] as TrackTag[],
    balance: 162000,
    fee: 0.7,
  },
  {
    id: "p3",
    type: "גמל" as ProductType,
    issuer: "מיטב",
    track: "מסלול מנייתי",
    tags: ["מניות"] as TrackTag[],
    balance: 100000,
    fee: 0.65,
  },
];
