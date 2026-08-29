# דשבורד חשיפות חיסכון

דשבורד סטטי (HTML + JS, ללא שרת) להצגת חשיפות מצרפיות של מוצרי חיסכון —
גמל, השתלמות, פנסיה וביטוח מנהלים — על בסיס הנתונים הציבוריים של רשות שוק
ההון (גמל-נט, פנסיה-נט, ביטוח-נט) כפי שפורסמו ב-data.gov.il.

היתרות ודמי הניהול שהמשתמש מזין נשמרים בדפדפן בלבד (localStorage).
הדשבורד מציג נתונים להמחשה בלבד ואינו מהווה ייעוץ או המלצה.

## מבנה הפרויקט

| קובץ | תפקיד |
|---|---|
| `index.html` | הדף — מבנה ועיצוב |
| `scripts.js` | כל הלוגיקה (נטען בסוף הדף; מקור האמת היחיד לקוד) |
| `funds_unified.json` | מאגר הקופות המאוחד שהדשבורד קורא |
| `tools/build_dataset.py` | בניית המאגר מקובצי המקור + בדיקות שפיות |
| `logos/` | לוגואים של החברות המנהלות (אופציונלי — ראה `logos/README.md`) |
| `netlify.toml` | הגדרות הפרסום ל-Netlify |

## פרסום (Netlify)

האתר מתפרסם ב-Netlify מענף `main`. פקודת הבנייה מעתיקה את קובצי האתר
לתיקיית `_site` (שאינה נשמרת ב-git) ומייצרת ממנה גם `404.html`:

```bash
mkdir -p _site
cp index.html styles.css scripts.js funds_unified.json _site/
cp index.html _site/404.html
mkdir -p _site/logos
cp -R logos/. _site/logos/ 2>/dev/null || true
```

חיבור ראשוני: ב-Netlify בוחרים **Add new site → Import an existing project**,
מחברים את הריפו הזה ובוחרים ענף `main`. אין צורך למלא Build command ו-Publish
directory — הם נקראים מ-`netlify.toml`. מכאן כל push ל-`main` מפרסם אוטומטית,
ו-Pull Requests מקבלים Deploy Preview.

לבדיקה מקומית לפני push: `npx netlify-cli deploy --build` (או פשוט להריץ שרת
סטטי מתיקיית הפרויקט, למשל `python3 -m http.server`).

## עדכון הנתונים החודשי

1. מורידים את שלושת קובצי הנתונים (xlsx או csv) מ-data.gov.il:
   גמל-נט, פנסיה-נט וביטוח-נט, עם העמודות המקוריות (FUND_ID, REPORT_PERIOD...).
2. מריצים מתיקיית הפרויקט:

   ```bash
   python3 tools/build_dataset.py \
       --gemel gemel.xlsx --pensia pensia.xlsx --bituach bituach.xlsx \
       --prev funds_unified.json -o funds_unified.json
   ```

   הדגל `--prev` משווה לקובץ הקודם ותופס תקלות המרה (ירידה בתקופה,
   קפיצה חריגה במספר הקופות, סטייה בחשיפות). אם בדיקה נכשלת — הקובץ
   לא נכתב והשגיאות מודפסות.

   בנוסף, המאגר שומר לכל קופה היסטוריה חודשית של תשואה וחשיפת מניות
   (עד 24 חודשים) שמזינה את גרפי "מגמה חודשית של התיק" בדשבורד.
   ההיסטוריה נבנית מקובצי המקור ומתמזגת עם הקובץ הקודם דרך `--prev`,
   כך שהיא רק מצטברת מעדכון לעדכון.
3. לבדיקה של קובץ קיים בלי לבנות מחדש:

   ```bash
   python3 tools/build_dataset.py --check funds_unified.json
   ```

4. עושים commit ל-`funds_unified.json` המעודכן.

דרישות: Python 3, ו-`openpyxl` אם קובצי המקור הם xlsx (`pip install openpyxl`).
