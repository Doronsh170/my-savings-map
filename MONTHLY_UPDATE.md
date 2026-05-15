# Monthly Update Guide

This app is fully static and reads its catalog from a single JSON file.
A monthly refresh = replacing that one file. Nothing else.

## 1. Replace the data file

- File path: `src/data/funds_unified.json`
- Keep the **same filename**.
- Keep the **same JSON shape**:

  ```json
  {
    "meta": { ... },
    "funds": [ ... ]
  }
  ```

- Do **not** edit calculation logic.
- Do **not** edit UI components.
- Keep `CATALOG_CONFIG.useDemoData = false` in `src/lib/catalog.ts`.

The mapper in `src/lib/unifiedMapper.ts` reads only the documented fields
(`source`, `classification`, `managing_corp`, `fund_name`, `report_period`,
`total_assets`, `is_active`, exposure %, yield %, fee %, etc.). Extra fields
in the JSON are ignored — adding them is safe.

## 2. Verification checklist

After replacing the file, open the running app and confirm:

- [ ] **Total rows loaded** — `payload.funds.length` matches the new file
      (e.g. `meta.counts.total_funds`).
- [ ] **Active rows mapped** — every row with `is_active === true` appears
      in the catalog (`meta.counts.active_funds`).
- [ ] **Issuers appear for each product type** — open `/add`, pick each of:
      פנסיה, גמל, השתלמות, גמל להשקעה, ביטוח מנהלים, and confirm a non-empty
      issuer list, sorted by total assets descending.
- [ ] **Demo banners are hidden** — no "דוגמה" badges, no "קטלוג דמו פנימי"
      banner anywhere in the wizard.
- [ ] **Search works** — typing inside the wizard track step filters tracks
      by name / id (case-insensitive substring).
- [ ] **A selected product appears in the dashboard** — finish the wizard,
      land on `/dashboard`, and see the new product in the list.
- [ ] **Weighted exposures calculate correctly** — מניות / חו״ל / מט״ח cards
      reflect the selected products' balances and exposures.
- [ ] **Products without user-entered management fees show "לא הוזן"** in
      the per-product card (public-data fee is reference-only and is never
      used as a fallback).
- [ ] **Data freshness label** at the top of `/info` (and on the dashboard
      source note) updates to the new `meta.dataset_max_period` (e.g.
      `נתונים מעודכנים לתקופה: 2026/03`).

## 3. What you must NOT change

- No backend.
- No login.
- No analytics.
- No personal data collection.
- `localStorage` only.
- No advisory wording, no recommendations.

If any verification step fails, restore the previous `funds_unified.json`
and diagnose before publishing.
