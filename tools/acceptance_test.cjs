/* בדיקות קבלה לדשבורד, בדפדפן אמיתי (Playwright + Chromium).
   מריצים מתיקיית הפרויקט:
     npm i -D playwright && npx playwright install chromium   # פעם אחת
     node tools/acceptance_test.cjs
   הסקריפט מרים שרת סטטי מקומי, מריץ את הבדיקות ומדפיס PASS/FAIL לכל אחת.
   קוד יציאה 0 רק אם כולן עברו. */
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
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const BASE = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const ready = page => page.waitForFunction(() => typeof DATA !== 'undefined' && DATA.length > 0);
  const newPage = async () => {
    const page = await (await browser.newContext()).newPage();
    page.on('pageerror', e => check('no page errors', false, e.message));
    page.on('dialog', d => d.accept());
    await page.goto(BASE);
    await ready(page);
    return page;
  };
  const seed = (page, rows) => page.evaluate(r => localStorage.setItem(STORAGE_KEY, JSON.stringify(r)), rows);

  try {
    const page = await newPage();
    const pick = await page.evaluate(() => {
      const withStock = DATA.find(r => isSelectableFund(r) && r.stock_pct != null && Number(r.report_period) === Number(DATASET_MAX_PERIOD)
        && r.ytd_yield != null && compareToPeers(withRuntimeFlags(r), 0.5, null));
      const noStock = DATA.find(r => isSelectableFund(r) && r.stock_pct == null);
      const lagging = DATA.find(r => isSelectableFund(r) && Number(r.report_period) !== Number(DATASET_MAX_PERIOD)
        && monthDiff(r.report_period, DATASET_MAX_PERIOD) <= 3 && r.ytd_yield != null);
      return { a: withStock, n: noStock, l: lagging };
    });

    // 1. נתון חסר אינו אפס, ושיעור הכיסוי מוצג.
    await seed(page, [{ uid: pick.a.uid, balance: 100000, management_fee: 0.5 }, { uid: pick.n.uid, balance: 100000 }]);
    await page.reload(); await ready(page);
    const stockShown = await page.textContent('#aggStock');
    check('missing stock_pct is not averaged as 0', stockShown === pick.a.stock_pct.toFixed(1), `shown ${stockShown}, expected ${pick.a.stock_pct.toFixed(1)}`);
    check('coverage note names partial coverage', /חשיפה למניות — 50% מהתיק/.test(await page.textContent('#coverageNote')));

    // 2. ההשוואה למסלולים דומים שורדת רענון.
    check('peer comparison present after reload', (await page.locator('.cmp-section').count()) > 0);

    // 3. תשואות רק מחודש הדיווח העדכני.
    if (pick.l) {
      await seed(page, [{ uid: pick.a.uid, balance: 100000 }, { uid: pick.l.uid, balance: 100000 }]);
      await page.reload(); await ready(page);
      const ytd = await page.textContent('#perfYtd');
      check('yields exclude tracks from an older report period', ytd === pick.a.ytd_yield.toFixed(2), `shown ${ytd}, expected ${pick.a.ytd_yield.toFixed(2)} (lagging ${pick.l.uid} @ ${pick.l.report_period})`);
    } else {
      check('yields exclude tracks from an older report period', true, 'skipped: no lagging track in dataset');
    }

    // 4. עריכה מתוך הדשבורד פותחת את טופס היתרה.
    await page.evaluate(() => goToDashboard());
    await page.click('text=עריכת יתרות ודמי ניהול');
    await page.locator('.row-edit-btn').first().click();
    check('edit button opens the balance form', await page.isVisible('#quickBalanceInput'));
    // 4א. הסבר ההשוואה ופרטי המסלול בחלונות נפרדים, בלי אקורדיון.
    await page.evaluate(() => closeInfoDialog());
    await page.evaluate(() => goToDashboard());
    await page.evaluate(() => { document.querySelector('.details-toggle-section').open = true; });
    check('no accordion inside product cards', (await page.locator('.detail-card details').count()) === 0);
    const card = page.locator('.detail-card', { has: page.locator('.cmp-section') }).first();
    await card.locator('text=איך מחושבת ההשוואה?').click();
    const methodBody = await page.textContent('#infoDialogBody');
    check('method dialog opens with methodology only',
      await page.isVisible('#infoDialog') && /ההשוואה נעשית מול מסלולים/.test(methodBody) && (await page.locator('#infoDialogBody .detail-card-grid').count()) === 0);
    await page.click('.info-dialog-x');
    check('X closes the dialog', !(await page.isVisible('#infoDialog')));
    await card.locator('text=פרטים נוספים על המסלול').click();
    const fundBody = await page.textContent('#infoDialogBody');
    check('details dialog opens with track data only',
      await page.isVisible('#infoDialog') && /חו״ל/.test(fundBody) && !/ההשוואה נעשית/.test(fundBody));
    await page.click('.info-dialog-close');
    check('"סגור" closes the dialog', !(await page.isVisible('#infoDialog')));
    await card.locator('text=פרטים נוספים על המסלול').click();
    await page.keyboard.press('Escape');
    check('Escape closes the dialog', !(await page.isVisible('#infoDialog')));

    check('add-product button exists on dashboard', (await page.locator('.dashboard-edit-actions >> text=הוספת מוצר').count()) === 1);

    // 5. המחשבון: גלוי, היסטורי בלבד, המרה גאומטרית.
    await seed(page, [{ uid: pick.a.uid, balance: 100000 }]);
    await page.reload(); await ready(page);
    check('calculator visible', await page.isVisible('#simulationTabSection'));
    const stock = pick.a.stock_pct;
    const expHist = await page.evaluate(([st]) => 100000 * (1 + simAnnualYield(0, st) / 100) * (1 + simAnnualYield(1, st) / 100), [stock]);
    const gotHist = await page.evaluate(() => {
      document.getElementById('simYearsInput').value = '2';
      document.getElementById('simFeeInput').value = '0';
      document.getElementById('simMonthlyInput').value = '';
      runHistoricalSimulation();
      return Number(document.getElementById('simFinalAmount').textContent.replace(/[^0-9]/g, ''));
    });
    check('simulation compounds the historical series year by year', Math.abs(gotHist - expHist) <= 1, `got ${gotHist}, expected ${Math.round(expHist)}`);
    check('no average-scenario mode', (await page.locator('input[name="simMode"]').count()) === 0);
    const simFactor = await page.evaluate(() => {
      let x = 1; const m = Math.pow(1 + simAnnualYield(0, 100) / 100, 1 / 12) - 1;
      for (let i = 0; i < 12; i++) x *= 1 + m;
      return x;
    });
    check('12 monthly steps reproduce the annual yield', Math.abs(simFactor - 1.3583) < 1e-9, simFactor.toFixed(6));

    // 6. רמות השיתוף: מה נכלל בכל אחת.
    const texts = await page.evaluate(() => ({ e: buildShareText('exposure'), f: buildShareText('full'), l: buildShareText('link') }));
    check('share "exposure" has no amounts or fees', !/₪|דמי ניהול/.test(texts.e) && !texts.e.includes('#p='));
    check('share "full" has amounts, no link', /₪/.test(texts.f) && !texts.f.includes('#p='));
    check('share "link" has amounts and link', /₪/.test(texts.l) && texts.l.includes('#p='));
    await page.evaluate(() => { window.open = () => ({}); shareWhatsApp(); });
    const preview = await page.inputValue('#sharePreview');
    check('share dialog defaults to exposure-only, with preview', !/₪/.test(preview) && preview.length > 0);
    await page.evaluate(() => cancelShare());

    // 7. קישור ששותף נפתח כתצוגה נפרדת ואינו נוגע בתיק השמור.
    const shareUrl = await page.evaluate(u => {
      userFunds.push({ fund: withRuntimeFlags(DATA.find(r => r.uid === u)), balance: 77000, managementFee: 0.3 });
      const url = buildShareUrl(); userFunds.pop(); return url;
    }, pick.n.uid);
    const recipient = await newPage();
    await seed(recipient, [{ uid: pick.a.uid, balance: 50000 }]);
    const savedBefore = await recipient.evaluate(() => localStorage.getItem(STORAGE_KEY));
    await recipient.goto(shareUrl); await ready(recipient);
    await recipient.waitForFunction(() => SHARED_VIEW === true);
    check('shared link opens a separate view', await recipient.isVisible('#sharedViewBanner'));
    check('shared view leaves saved portfolio untouched', (await recipient.evaluate(() => localStorage.getItem(STORAGE_KEY))) === savedBefore);
    check('shared link removed from address bar', (await recipient.evaluate(() => location.hash)) === '');
    await recipient.click('text=סגירה וחזרה לתיק שלי');
    check('close returns to own portfolio', JSON.stringify(await recipient.evaluate(() => userFunds.map(i => i.fund.uid))) === JSON.stringify([pick.a.uid]));
    await recipient.goto(BASE); await recipient.goto(shareUrl); await ready(recipient);
    await recipient.waitForFunction(() => SHARED_VIEW === true);
    await recipient.click('text=שמירת התיק בדפדפן הזה');
    check('save stores the shared portfolio', (await recipient.evaluate(() => JSON.parse(localStorage.getItem(STORAGE_KEY)).length)) === 2);
  } catch (error) {
    check('test run completed', false, error.message);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
