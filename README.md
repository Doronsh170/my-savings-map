# החיסכון שלי בתמונה אחת

אפליקציית ווב סטטית (React + TypeScript) שמרכזת את מוצרי החיסכון הפנסיוני —
פנסיה, גמל, השתלמות, גמל להשקעה וביטוח מנהלים — לתמונת חשיפות אחת: כמה מהחיסכון
חשוף למניות, לחו״ל ולמט״ח, לפי היתרות שהמשתמש מזין.

הנתונים על הקופות מגיעים מהמאגרים הציבוריים של רשות שוק ההון (גמל-נט, פנסיה-נט,
ביטוח-נט) כפי שפורסמו ב-data.gov.il. **היתרות ודמי הניהול שהמשתמש מזין נשמרים
בדפדפן בלבד (localStorage) ולא נשלחים לשום שרת.** הכלי מציג נתונים להמחשה בלבד
ואינו מהווה ייעוץ פנסיוני, ייעוץ השקעות או המלצה.

## סטאק

| רכיב                    | בחירה                                                  |
| ----------------------- | ------------------------------------------------------ |
| שפה                     | TypeScript (`strict`)                                  |
| UI                      | React 19                                               |
| ראוטינג + SSR/prerender | TanStack Start / TanStack Router                       |
| Build                   | Vite 7                                                 |
| עיצוב                   | Tailwind CSS 4                                         |
| איכות קוד               | ESLint + Prettier                                      |
| אחסון נתוני משתמש       | localStorage בלבד — אין שרת, אין התחברות, אין אנליטיקס |

## מבנה הפרויקט

```
src/
  routes/           דפי האפליקציה (index, add, products, dashboard, info, privacy)
  components/       רכיבי UI של האפליקציה (AppShell, ExposureBar, Tag)
  lib/
    catalog.ts      טעינת הקטלוג + מתג דמו/אמת (CATALOG_CONFIG)
    unifiedMapper.ts המקום היחיד שמכיר את סכמת funds_unified.json
    productModel.ts  מודל המוצר של המשתמש
    simulation.ts    סימולציית תשואות היסטורית (הועתקה 1:1 מהגרסה הקודמת)
    storage.ts       שכבת localStorage
  data/
    funds_unified.json  מאגר הקופות המאוחד שהאפליקציה קוראת
tools/
  build_dataset.py  בניית funds_unified.json מקובצי המקור + בדיקות שפיות
```

הכלל המרכזי: `unifiedMapper.ts` הוא הגבול. רק הוא מכיר את מבנה קובץ הנתונים —
שאר האפליקציה רואה `CatalogTrack` בלבד. שינוי בסכמת המקור נוגע לקובץ אחד.

## הרצה מקומית

```bash
bun install
bun run dev          # שרת פיתוח
bun run typecheck    # tsc --noEmit
bun run lint
bun run build        # build לפרודקשן
```

(אפשר גם npm/pnpm; ה-lockfile בריפו הוא של bun.)

## עדכון הנתונים החודשי

הנתונים אינם נמשכים ב-runtime — הם קובץ אחד שנבנה מראש ומקומיט לריפו.

1. מורידים מ-data.gov.il את שלושת קובצי המקור (xlsx או csv) עם שמות העמודות
   המקוריים: גמל-נט, פנסיה-נט, ביטוח-נט.
2. בונים את הקובץ המאוחד:

   ```bash
   python3 tools/build_dataset.py \
       --gemel gemel.xlsx --pensia pensia.xlsx --bituach bituach.xlsx \
       --prev src/data/funds_unified.json \
       -o src/data/funds_unified.json
   ```

   הדגל `--prev` משווה מול הקובץ הקודם ותופס תקלות המרה (ירידה בתקופת הדיווח,
   קפיצה חריגה במספר הקופות, סטייה בחשיפות). **אם בדיקה נכשלת הקובץ לא נכתב**
   והשגיאות מודפסות.

3. בדיקת קובץ קיים בלי לבנות מחדש:

   ```bash
   python3 tools/build_dataset.py --check src/data/funds_unified.json
   ```

4. מריצים את רשימת האימות ב-[`MONTHLY_UPDATE.md`](MONTHLY_UPDATE.md) ומקומיטים.

דרישות: Python 3, ו-`openpyxl` אם קובצי המקור הם xlsx (`pip install openpyxl`).

## דיפלוי

**פרודקשן: GitHub Pages.** כל push ל-`main` מריץ את
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) — build סטטי
מלא (prerender) ופרסום. כשמשתנה שם הריפו יש לעדכן את `GITHUB_PAGES_BASE`
או את ברירת המחדל ב-`vite.config.ts`.

`wrangler.jsonc` ו-`src/server.ts` הם נתיב ה-SSR של סביבת התצוגה המקדימה של
Lovable (Cloudflare) ואינם יעד דיפלוי. בפרודקשן האפליקציה סטטית לחלוטין.

## ידוע / פתוח

- תגיות `og:image` ו-`twitter:image` ב-`src/routes/__root.tsx` עדיין מצביעות
  ל-CDN של תצוגת ה-preview. צריך להחליף בצילום מסך עצמאי מהריפו.
