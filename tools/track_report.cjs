/* דוח תוויות מסלול ובדיקת איכות נתונים.
   מריצים מתיקיית הפרויקט:  node tools/track_report.cjs > track_report.csv
   לכל קופה ניתנת לבחירה: הסיווג הרשמי, התווית שהאתר מציג, קבוצת ההשוואה,
   החשיפה המדווחת למניות, וסימון לבדיקה כשהחשיפה המדווחת רחוקה ממה שהתווית
   מרמזת. הסימון נועד לבדיקה ידנית בלבד: הוא אינו משנה את התווית באתר, כי
   חשיפה של חודש אחד אינה מוכיחה שהמדיניות או הסיווג הרשמי שגויים. */
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  const globalRoot = require('child_process').execSync('npm root -g').toString().trim();
  ({ chromium } = require(path.join(globalRoot, 'playwright')));
}

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForFunction(() => typeof DATA !== 'undefined' && DATA.length > 0);
  const rows = await page.evaluate(() => {
    // ספי הסימון הם כלל אצבע לבדיקה, לא הגדרה: מסלול מנייתי שמדווח פחות מ-50%
    // מניות, מסלול אג״ח או כספי שמדווח יותר מ-30%, או תקרה שנחרגה ביותר מ-10 נק׳.
    const flag = (k, stock) => {
      if (typeof stock !== 'number') return '';
      if (['equity', 'index_equity', 'sp500'].includes(k.kind) && stock < 50) return 'חשיפה נמוכה מהצפוי למסלול מנייתי';
      if (['bond', 'index_bond', 'money'].includes(k.kind) && stock > 30) return 'חשיפה גבוהה מהצפוי למסלול אג״ח/כספי';
      if (k.kind === 'no_stock' && stock > 10) return 'חשיפה למניות במסלול "ללא מניות"';
      if (k.cap !== null && stock > k.cap + 10) return 'חשיפה מעל התקרה שבשם';
      return '';
    };
    return DATA.filter(isSelectableFund).map(r => {
      const k = trackKindOf(r);
      return [r.uid, r.fund_name, r.specialization || '', r.sub_specialization || '', trackLabel(r),
        k.kind || '', r._cmpCategory, r.stock_pct, r.report_period, flag(k, r.stock_pct)];
    });
  });
  const csv = v => { const s = v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim(); return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['uid', 'שם המסלול', 'התמחות רשמית', 'תת-התמחות רשמית', 'תווית באתר', 'סוג', 'קבוצת השוואה', 'חשיפה למניות %', 'חודש דיווח', 'לבדיקת איכות נתונים'];
  process.stdout.write('﻿' + [head, ...rows].map(row => row.map(csv).join(',')).join('\n') + '\n');
  await browser.close();
  server.close();
})();
