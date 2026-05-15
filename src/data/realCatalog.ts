// Real catalog — to be populated with verified records from the Israeli
// Capital Market Authority public datasets (or any other vetted source).
//
// Rules for entries here:
//   - `isDemo` MUST be false.
//   - `trackId`, `sourceName`, `sourceDate` are required and must reflect
//     the actual source row.
//   - Do NOT mix demo data into this file. Demo rows live in
//     src/data/demoCatalog.ts.
//
// Activate this catalog by setting CATALOG_CONFIG.useDemoData = false in
// src/lib/catalog.ts. While this array is empty, the wizard will simply
// show no issuers / no tracks (empty state) for every product type.

import type { CatalogTrack } from "@/lib/catalog";

export const realCatalog: CatalogTrack[] = [
  // Example shape (do not ship — kept here only as a contract reminder):
  //
  // {
  //   productType: "השתלמות",
  //   issuerName: "<שם יצרן מהמאגר>",
  //   trackName: "<שם מסלול מהמאגר>",
  //   trackId: "<track-id-מהמאגר>",
  //   equityExposure: 95.2,
  //   foreignExposure: 88.4,
  //   fxExposure: 86.0,
  //   monthlyReturn: 1.4,
  //   ytdReturn: 9.8,
  //   threeYearReturn: 28.5,
  //   managementFeeFromPublicData: 0.72,
  //   sourceName: "רשות שוק ההון - גמל-נט",
  //   sourceDate: "2025-04-30",
  //   isDemo: false,
  // },
];
