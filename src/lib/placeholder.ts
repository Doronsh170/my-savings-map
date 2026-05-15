import type { ProductType } from "./storage";

// Demo placeholder dashboard data is no longer used — the dashboard now
// reads directly from saved ProductRecords. Only the ordered product type
// list is kept, since the wizard's first step needs it.
export const PRODUCT_TYPES: ProductType[] = [
  "פנסיה",
  "גמל",
  "השתלמות",
  "גמל להשקעה",
  "ביטוח מנהלים",
];
