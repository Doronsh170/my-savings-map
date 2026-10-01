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

    // 2. ההשוואה לקופות באותו סוג מסלול שורדת רענון.
    check('peer comparison present after reload', (await page.locator('.product-cmp-peer').count()) > 0);

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
    const openProduct = async (pg, uid) => {
      if ((await pg.getAttribute(`[data-toggle-uid="${uid}"]`, 'aria-expanded')) !== 'true') await pg.click(`[data-toggle-uid="${uid}"]`);
    };
    await openProduct(page, pick.a.uid);
    await page.click(`.product-detail [data-edit-uid="${pick.a.uid}"]`);
    check('edit button opens the balance form', await page.isVisible('#quickBalanceInput'));
    // 4א. הסבר ההשוואה ופרטי המסלול בחלונות נפרדים.
    await page.evaluate(() => closeInfoDialog());
    await page.evaluate(() => goToDashboard());
    check('product list is not a collapsible section', (await page.locator('#detailsSection details').count()) === 0 && await page.isVisible('#detailsRows'));
    await openProduct(page, pick.a.uid);
    const card = page.locator(`.product[data-product-uid="${pick.a.uid}"]`);
    check('open product: fees, exposures and two actions only',
      (await card.locator('.product-detail .product-stat').count()) >= 2
      && /^מניות \d+% · חו״ל \d+% · מט״ח \d+%$/.test((await card.locator('.product-expo').textContent()).trim())
      && (await card.locator('.product-actions button').count()) === 2
      && (await card.locator('.product-detail:visible >> text=איך מחושבת ההשוואה?').count()) === 0);
    const yieldLine = (await card.locator('.product-yield-row').textContent()).replace(/\s+/g, ' ').trim();
    check('open product shows the track return with its period vs. the average', /^תשואת המסלול שלך מצטברת ל־3 שנים, לפני דמי ניהול -?\d+\.\d% ממוצע בקבוצה -?\d+\.\d%$/.test(yieldLine), yieldLine);
    check('every row has an open/close arrow', (await page.locator('#detailsRows .product-row .product-chev').count()) === (await page.locator('#detailsRows .product').count()));
    // שכבה 3: "השוואה מלאה" — טבלה, נתוני מסלול, ו"איך מחושבת ההשוואה?" בפנים.
    await card.locator('.product-actions >> text=השוואה מלאה').click();
    const fullBody = await page.textContent('#infoDialogBody');
    check('full comparison opens with the table and track data',
      await page.isVisible('#infoDialog') && /ממוצע קופות באותו סוג מסלול/.test(fullBody) && /נתוני המסלול/.test(fullBody) && /נכסים סחירים/.test(fullBody));
    check('method is one more layer in, closed', !(await page.isVisible('#infoDialogBody .cmp-method')));
    await page.click('#infoDialogBody .method-details > summary');
    const methodBody = await page.textContent('#infoDialogBody .cmp-method');
    check('method explains the comparison group',
      await page.isVisible('#infoDialogBody .cmp-method') && /אותו סוג מוצר/.test(methodBody) && /אותה מדיניות השקעה/.test(methodBody) && /אותו חודש דיווח/.test(methodBody) && /אותה קטגוריית מסלול/.test(methodBody)
      && /אוכלוסיית יעד/.test(methodBody) && /ממוצע פשוט/.test(methodBody) && /לפחות 5 קופות/.test(methodBody));
    await page.click('.info-dialog-x');
    check('X closes the dialog', !(await page.isVisible('#infoDialog')));
    await card.locator('.product-actions >> text=השוואה מלאה').click();
    await page.click('.info-dialog-close');
    check('"סגור" closes the dialog', !(await page.isVisible('#infoDialog')));
    await card.locator('.product-actions >> text=השוואה מלאה').click();
    await page.keyboard.press('Escape');
    check('Escape closes the dialog', !(await page.isVisible('#infoDialog')));

    check('add-product button exists on dashboard', (await page.locator('.total-actions >> text=הוספת חיסכון').count()) === 1);
    check('no duplicate balance-edit button', (await page.locator('text=עריכת יתרות ודמי ניהול').count()) === 0);

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
    check('share "exposure" has no amounts or entered fees', !/₪|דמי הניהול שהוזנו/.test(texts.e) && !texts.e.includes('#p='));
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

    // 8. משתמש חוזר נכנס ישר לתיק; משתמש חדש מתחיל באשף.
    const fresh = await newPage();
    check('new visitor starts on the wizard', await fresh.isVisible('#wizScreen') && !(await fresh.isVisible('#dashboard')));
    const monthsAgo = n => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString(); };
    await seed(fresh, [
      { uid: pick.a.uid, balance: 100000, updated_at: monthsAgo(4) },
      { uid: pick.n.uid, balance: 50000, updated_at: new Date().toISOString() }
    ]);
    await fresh.reload(); await ready(fresh);
    await fresh.waitForFunction(() => document.body.classList.contains('dashboard-reached'));
    check('returning user opens on the dashboard', await fresh.isVisible('#dashboard') && !(await fresh.isVisible('#wizScreen')));

    // 9. גיל היתרות ועדכון מהיר.
    check('balance age names the oldest balance', /חלק מהיתרות עודכנו לפני 4 חודשים/.test(await fresh.textContent('#balanceAge')));
    await fresh.click('.total-actions >> text=עדכון יתרות');
    check('quick update lists every product', (await fresh.locator('#balancesRows input').count()) === 2);
    await fresh.fill(`#balancesRows input[data-balance-uid="${pick.a.uid}"]`, '');
    await fresh.click('#balancesDialog button[type=submit]');
    check('quick update rejects an empty balance', await fresh.isVisible('#balancesError') && await fresh.isVisible('#balancesDialog'));
    await fresh.fill(`#balancesRows input[data-balance-uid="${pick.a.uid}"]`, '120000');
    await fresh.keyboard.press('Enter');
    const savedA = await fresh.evaluate(u => JSON.parse(localStorage.getItem(STORAGE_KEY)).find(r => r.uid === u), pick.a.uid);
    check('quick update saves the new balance', !(await fresh.isVisible('#balancesDialog')) && savedA.balance === 120000);
    check('quick update refreshes the age', /היתרות עודכנו היום/.test(await fresh.textContent('#balanceAge')));
    check('total reflects the quick update', (await fresh.textContent('#totalBalance')).replace(/[^0-9]/g, '') === '170000');

    // 10. הסרה: דרך "עריכה" ← "הסר מהתיק", מיידית ועם ביטול, בלי חלון אישור.
    let confirmAsked = false;
    fresh.on('dialog', () => { confirmAsked = true; });
    check('no remove button in the open product', (await fresh.locator('#detailsRows [data-remove-uid]').count()) === 0);
    await openProduct(fresh, pick.n.uid);
    await fresh.click(`.product-detail [data-edit-uid="${pick.n.uid}"]`);
    await fresh.click('[data-wiz="removePicked"]');
    const afterRemove = await fresh.evaluate(() => JSON.parse(localStorage.getItem(STORAGE_KEY)).length);
    check('remove is immediate, with an undo toast', !confirmAsked && afterRemove === 1 && await fresh.isVisible('#undoToast'));
    await fresh.click('#undoToastBtn');
    const afterUndo = await fresh.evaluate(() => JSON.parse(localStorage.getItem(STORAGE_KEY)).map(r => r.uid));
    check('undo restores the removed product', afterUndo.length === 2 && afterUndo.includes(pick.n.uid) && !(await fresh.isVisible('#undoToast')));
    await fresh.click('#wizBar >> text=חזרה לתיק');
    check('back in the portfolio with both products', (await fresh.locator('#detailsRows .product').count()) === 2 && await fresh.isVisible('#dashboard'));
    // הסרה מתוך הדשבורד (removeFundByUid) עדיין עובדת עם ביטול, גם למוצר האחרון.
    await fresh.evaluate(u => removeFundByUid(u), pick.n.uid);
    await fresh.evaluate(u => removeFundByUid(u), pick.a.uid);
    check('removing the last product returns to the wizard', await fresh.isVisible('#wizScreen'));
    await fresh.click('#undoToastBtn');
    check('undo of the last product reopens the dashboard', await fresh.isVisible('#dashboard') && !(await fresh.isVisible('#wizScreen')));

    // 11. באשף, מי שיש לו תיק רואה "חזרה לתיק" ולא "התחל מחדש".
    await fresh.click('.total-actions >> text=הוספת חיסכון');
    check('wizard offers a way back to the portfolio', (await fresh.locator('#wizBar >> text=חזרה לתיק').count()) === 1 && (await fresh.locator('#wizBar >> text=התחל מחדש').count()) === 0);
    await fresh.click('#wizBar >> text=חזרה לתיק');
    check('"back to portfolio" shows the dashboard', await fresh.isVisible('#dashboard') && !(await fresh.isVisible('#wizScreen')));

    // 12א. ראש הדשבורד: יתרה, משפט מבנה, ואז כרטיסי החשיפה; המידע הכללי למטה.
    const order = await fresh.evaluate(() => ['totalBalance', 'portfolioSummary', 'aggStock', 'detailsRows', 'perfSection', 'siteInfoSection']
      .map(id => document.getElementById(id).getBoundingClientRect().top));
    check('dashboard reads total → summary → exposure → products → performance, info rows below', order.every((top, i) => i === 0 || order[i - 1] < top), JSON.stringify(order.map(Math.round)));
    check('summary sentence shown on the dashboard', /^עד עכשיו הוספת חיסכון אחד: .+\.$/.test(await fresh.textContent('#portfolioSummary')));
    const summaries = await fresh.evaluate(([a, n]) => {
      const item = (uid, balance) => ({ fund: withRuntimeFlags(DATA.find(r => r.uid === uid)), balance });
      return {
        two: portfolioSummaryText([item(a, 300000), item(n, 100000)], 400000),
        tie: portfolioSummaryText([item(a, 100000), item(n, 100000)], 200000)
      };
    }, [pick.a.uid, pick.n.uid]);
    check('summary names product count and largest share', /^עד עכשיו הוספת 2 חסכונות\. הגדול שבהם, .+, הוא 75% מהיתרה שהוזנה\.$/.test(summaries.two), summaries.two);
    check('summary handles a tie for largest', /^עד עכשיו הוספת 2 חסכונות\. הגדולים שבהם, .+, הם 50% מהיתרה שהוזנה כל אחד\.$/.test(summaries.tie), summaries.tie);
    check('tab title has no version', (await fresh.title()) === 'מפת החיסכון');
    const gaps = await fresh.evaluate(() => {
      const tops = ['perfSection', 'historySection', 'simulationTabSection']
        .map(id => document.getElementById(id)).filter(el => el.offsetParent)
        .map(el => el.querySelector('summary').getBoundingClientRect());
      return tops.slice(1).map((r, i) => r.top - tops[i].bottom);
    });
    check('collapsed sections sit close together', gaps.length > 0 && gaps.every(g => g < 30), JSON.stringify(gaps.map(Math.round)));

    // 12ב. ב-PDF תאריך מלא; בלי תווית סוג המוצר ובלי "חזרה לראש העמוד".
    await fresh.emulateMedia({ media: 'print' });
    const printedAge = await fresh.evaluate(() => document.getElementById('balanceAge').innerText.trim());
    await fresh.emulateMedia({ media: 'screen' });
    check('PDF shows the full update date', /^היתרה עודכנה ב-\d{2}\.\d{2}\.\d{4}\.$/.test(printedAge), printedAge);
    check('screen still shows the relative age', /^היתרה עודכנה היום\.$/.test(await fresh.evaluate(() => document.getElementById('balanceAge').innerText.trim())));
    check('no product-type chip in the balance card', (await fresh.locator('#sourceMix, .source-mix-item').count()) === 0);
    check('no back-to-top button', (await fresh.locator('text=חזרה לראש העמוד').count()) === 0);

    // 13. רשימת המוצרים: שורה לכל מוצר, שלושה מצבי השוואה, מוצר פתוח אחד.
    const noPeers = await fresh.evaluate(() => {
      const r = DATA.find(x => isSelectableFund(x) && !withRuntimeFlags(x).is_stale && !compareToPeers(withRuntimeFlags(x), null, null));
      return r && r.uid;
    });
    const withFeePeers = await fresh.evaluate(skip => {
      const r = DATA.find(x => isSelectableFund(x) && x.uid !== skip && !withRuntimeFlags(x).is_stale && x._product !== 'pensia'
        && (compareToPeers(withRuntimeFlags(x), null, null) || { rows: [] }).rows.some(row => row.key === 'fee'));
      return r && r.uid;
    }, pick.a.uid);
    await seed(fresh, [
      { uid: pick.a.uid, balance: 300000, management_fee: 0.5, updated_at: new Date().toISOString() },
      { uid: withFeePeers, balance: 200000, updated_at: new Date().toISOString() },
      { uid: noPeers, balance: 100000, updated_at: new Date().toISOString() }
    ]);
    await fresh.reload(); await ready(fresh);
    await fresh.waitForFunction(() => document.body.classList.contains('dashboard-reached'));
    const rowUids = await fresh.evaluate(() => Array.from(document.querySelectorAll('#detailsRows .product')).map(el => el.dataset.productUid));
    check('one row per product, largest first', JSON.stringify(rowUids) === JSON.stringify([pick.a.uid, withFeePeers, noPeers]));
    const ind = uid => fresh.textContent(`[data-ind-uid="${uid}"]`);
    check('definition shown once under the list heading', (await fresh.textContent('.products-def')) === 'ממוצע בקבוצה = ממוצע קופות באותו סוג מסלול'
      && (await fresh.locator('#detailsRows :text("ממוצע קופות באותו סוג מסלול"):visible').count()) === 0);
    check('row with fee: yours · average', /^דמי הניהול שלך 0\.50% · ממוצע בקבוצה \d\.\d\d%$/.test((await ind(pick.a.uid)).trim()), await ind(pick.a.uid));
    check('row without fee: "הזן דמי ניהול" only', (await ind(withFeePeers)).trim() === 'הזן דמי ניהול', await ind(withFeePeers));
    check('row without a comparison group has no extra line', (await ind(noPeers)).trim() === '', await ind(noPeers) + ' / ' + noPeers);
    const pensionRow = await fresh.evaluate(() => {
      const r = DATA.find(x => isSelectableFund(x) && x._product === 'pensia' && !withRuntimeFlags(x).is_stale
        && (compareToPeers(withRuntimeFlags(x), null, null) || { rows: [] }).rows.some(row => row.key === 'fee'));
      const item = { fund: withRuntimeFlags(r), balance: 1, managementFee: 0.15, depositFee: 1.5 };
      const div = document.createElement('div');
      div.innerHTML = productIndicatorHtml(item, compareToPeers(item.fund, 0.15, 1.5)) + productDetailHtml(item, compareToPeers(item.fund, 0.15, 1.5));
      return { ind: div.querySelector('.product-ind').textContent, rows: Array.from(div.querySelectorAll('tbody th')).map(th => th.textContent),
        head: Array.from(div.querySelectorAll('thead th')).map(th => th.textContent),
        layer2: Array.from(div.querySelectorAll('.product-stat:not(.product-yield-row) .product-stat-label')).map(el => el.textContent) };
    });
    check('pension row names the accumulation fee', /^דמי הניהול שלך מצבירה 0\.15% · ממוצע בקבוצה \d\.\d\d%$/.test(pensionRow.ind), pensionRow.ind);
    check('pension open product lists both fees separately', JSON.stringify(pensionRow.layer2) === JSON.stringify(['דמי הניהול שלך מצבירה', 'דמי הניהול שלך מהפקדות']), JSON.stringify(pensionRow.layer2));
    check('pension full comparison lists both fees', pensionRow.rows.includes('דמי הניהול שלך מצבירה') && pensionRow.rows.includes('דמי הניהול שלך מהפקדות'), JSON.stringify(pensionRow.rows));
    check('table header: נתון | שלך | ממוצע קופות באותו סוג מסלול', JSON.stringify(pensionRow.head) === JSON.stringify(['נתון', 'שלך', 'ממוצע קופות באותו סוג מסלול']), JSON.stringify(pensionRow.head));
    const staleText = await fresh.evaluate(() => {
      const r = DATA.find(x => isSelectableFund(x) && withRuntimeFlags(x).is_stale);
      return r ? productIndicatorHtml({ fund: withRuntimeFlags(r), managementFee: null }, null).replace(/<[^>]+>/g, '') : '';
    });
    check('stale track keeps "נתוני המסלול לא עודכנו מאז"', /^נתוני המסלול לא עודכנו מאז \d\d\/\d{4}$/.test(staleText), staleText);
    check('rows start closed', (await fresh.locator('#detailsRows .product-detail:visible').count()) === 0);
    await fresh.click(`[data-toggle-uid="${pick.a.uid}"]`);
    await fresh.click(`[data-toggle-uid="${noPeers}"]`);
    check('only one product open at a time', (await fresh.locator('#detailsRows .product-detail:visible').count()) === 1
      && (await fresh.getAttribute(`[data-toggle-uid="${noPeers}"]`, 'aria-expanded')) === 'true');
    check('no-peers detail explains and still takes a fee', /אין כרגע ממוצע מתאים להשוואה/.test(await fresh.textContent(`.product[data-product-uid="${noPeers}"] .product-detail`))
      && (await fresh.locator(`.product[data-product-uid="${noPeers}"] [data-fee-edit]`).count()) >= 1);
    await fresh.click(`[data-toggle-uid="${noPeers}"]`);
    check('clicking an open row closes it', (await fresh.locator('#detailsRows .product-detail:visible').count()) === 0);
    await fresh.click(`[data-toggle-uid="${withFeePeers}"] [data-ask-fee]`);
    const focused = await fresh.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-fee-uid'));
    check('"הזן דמי ניהול" opens the product at the fee field', focused === withFeePeers);
    await fresh.keyboard.type('0.35');
    await fresh.keyboard.press('Enter');
    const savedFee = await fresh.evaluate(u => JSON.parse(localStorage.getItem(STORAGE_KEY)).find(r => r.uid === u).management_fee, withFeePeers);
    check('fee typed in the table is saved', savedFee === 0.35, String(savedFee));
    check('row switches to the with-fee state', /^דמי הניהול שלך 0\.35% · ממוצע בקבוצה/.test((await ind(withFeePeers)).trim()), await ind(withFeePeers));
    // דמי הניהול המשוקללים מוצגים רק כשהוזנו לכל המוצרים; המוצר השלישי משלים אותם.
    await fresh.click(`[data-toggle-uid="${noPeers}"]`);
    await fresh.click(`.product[data-product-uid="${noPeers}"] [data-fee-edit][data-fee-field="managementFee"]`);
    await fresh.fill(`.product[data-product-uid="${noPeers}"] .product-fee-input[data-fee-field="managementFee"]`, '0.2');
    await fresh.keyboard.press('Enter');
    const expectedFee = ((300000 * 0.5 + 200000 * 0.35 + 100000 * 0.2) / 600000).toFixed(2);
    check('portfolio fee metric updates once every product has a fee', (await fresh.textContent('#feeSavings')) === expectedFee, await fresh.textContent('#feeSavings'));
    await fresh.click(`[data-toggle-uid="${noPeers}"]`);
    check('fee edit keeps the balance age', /עודכנה? היום|עודכנו היום/.test(await fresh.textContent('#balanceAge')));

    // 13א. דמי ניהול מוצגים כערך; לחיצה פותחת שדה, Escape מבטל בלי לשמור.
    await fresh.click(`[data-toggle-uid="${withFeePeers}"]`);
    const feeBtn = `.product[data-product-uid="${withFeePeers}"] [data-fee-edit]`;
    check('fee shows as a value, not a form field', /^0\.35%/.test((await fresh.textContent(feeBtn)).trim())
      && (await fresh.locator(`.product[data-product-uid="${withFeePeers}"] .product-fee-input`).count()) === 0);
    await fresh.click(feeBtn);
    await fresh.keyboard.type('9');
    await fresh.keyboard.press('Escape');
    const afterEsc = await fresh.evaluate(u => JSON.parse(localStorage.getItem(STORAGE_KEY)).find(r => r.uid === u).management_fee, withFeePeers);
    check('Escape cancels a fee edit', afterEsc === 0.35 && /^0\.35%/.test((await fresh.textContent(feeBtn)).trim()), String(afterEsc));
    await fresh.click(`[data-toggle-uid="${withFeePeers}"]`);

    // 14. PDF: כל המוצרים פתוחים, בלי שדות ובלי פעולות.
    await fresh.evaluate(u => { window.__withFee = u; }, withFeePeers);
    await fresh.evaluate(() => preparePrintLayout());
    await fresh.emulateMedia({ media: 'print' });
    const printView = await fresh.evaluate(() => ({
      details: Array.from(document.querySelectorAll('#detailsRows .product-detail')).filter(el => getComputedStyle(el).display !== 'none').length,
      inputs: Array.from(document.querySelectorAll('#detailsRows .product-fee-input')).filter(el => getComputedStyle(el).display !== 'none').length,
      actions: Array.from(document.querySelectorAll('#detailsRows .product-actions')).filter(el => getComputedStyle(el).display !== 'none').length,
      tables: Array.from(document.querySelectorAll('#detailsRows .print-only')).filter(el => getComputedStyle(el).display !== 'none').length,
      fee: (document.querySelector(`#detailsRows .product[data-product-uid="${CSS.escape(window.__withFee)}"] .print-only`) || {}).textContent || ''
    }));
    await fresh.emulateMedia({ media: 'screen' });
    await fresh.evaluate(() => restorePrintLayout());
    check('PDF shows every product in full, without inputs or actions', printView.details === 3 && printView.inputs === 0 && printView.actions === 0 && printView.tables === 3, JSON.stringify(printView));
    check('PDF full table reflects a fee typed in the list', /0\.35%/.test(printView.fee));

    // 15. הסבר למונחים בכרטיסי החשיפה.
    await fresh.click('.exposure-help');
    check('one link explains the three exposures', await fresh.isVisible('#infoDialog') && /מטבעות זרים/.test(await fresh.textContent('#infoDialogBody')));
    await fresh.keyboard.press('Escape');
    // 15א. פירוט פתוח נשאר ברוחב המסך במובייל.
    await fresh.setViewportSize({ width: 390, height: 844 });
    await fresh.click(`[data-toggle-uid="${pick.a.uid}"]`);
    const widths = await fresh.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    check('open product fits the mobile screen', widths[0] <= widths[1], JSON.stringify(widths));
    await fresh.click(`[data-toggle-uid="${pick.a.uid}"]`);
    await fresh.keyboard.press('Escape');

    // 15ב. נגישות: מקלדת בלבד, ומטרות לחיצה של 44px לפחות.
    await fresh.focus(`[data-toggle-uid="${pick.a.uid}"]`);
    await fresh.keyboard.press('Enter');
    check('keyboard: Enter opens a product', (await fresh.getAttribute(`[data-toggle-uid="${pick.a.uid}"]`, 'aria-expanded')) === 'true');
    const sizes = await fresh.evaluate(u => Array.from(document.querySelectorAll(`.product[data-product-uid="${CSS.escape(u)}"] .product-action`))
      .map(el => Math.round(el.getBoundingClientRect().height)), pick.a.uid);
    check('tap targets are at least 44px tall', sizes.length >= 2 && sizes.every(h => h >= 44), JSON.stringify(sizes));
    await fresh.keyboard.press('Enter');
    check('keyboard: Enter closes it again', (await fresh.getAttribute(`[data-toggle-uid="${pick.a.uid}"]`, 'aria-expanded')) === 'false');
    const minFont = await fresh.evaluate(() => Math.min(...Array.from(document.querySelectorAll('#detailsSection .products-def, #detailsSection .product-ind, #detailsSection .product-amt span, #detailsSection .product-track-line'))
      .map(el => parseFloat(getComputedStyle(el).fontSize))));
    check('secondary text in the list is at least 13px', minFont >= 13, String(minFont));

    // 16. באשף: דמי הניהול מקופלים, אלא אם כבר הוזנו.
    await fresh.click('.total-actions >> text=הוספת חיסכון');
    await fresh.evaluate(u => wizSet({ step: 'balance', pickUid: u }), pick.n.uid);
    check('wizard fee fields start collapsed', !(await fresh.isVisible('#quickFeeInput')) && await fresh.isVisible('.wiz-fees-toggle'));
    await fresh.click('.wiz-fees-toggle');
    check('toggle reveals the fee fields', await fresh.isVisible('#quickFeeInput'));
    await fresh.evaluate(u => wizSet({ step: 'balance', pickUid: u }), pick.a.uid);
    check('fee fields open when a fee is already saved', await fresh.isVisible('#quickFeeInput') && (await fresh.locator('.wiz-fees-toggle').count()) === 0);
    await fresh.click('#wizBar >> text=חזרה לתיק');

    // 12. מחיקת הכל היא קישור משני מחוץ לסרגל הפעולות.
    check('delete-all is outside the action toolbar', (await fresh.locator('.action-toolbar >> text=איפוס הכל').count()) === 0 && (await fresh.locator('.reset-link').count()) === 1);

    // 17. תווית המסלול: המילה "מניות" בשם אינה הופכת מסלול למנייתי.
    const cls = await fresh.evaluate(() => {
      const byUid = uid => DATA.find(r => r.uid === uid);
      const sel = DATA.filter(isSelectableFund);
      const namedCap = sel.filter(r => /עד \d+ ?%|ללא מניות/.test(r.fund_name));
      const equityLabelled = sel.filter(r => trackLabel(r) === 'מסלול מנייתי');
      const equityChip = sel.filter(r => trackTags(r).includes('equity'));
      return {
        harel: trackLabel(byUid('gemelnet:416')), harelCmp: byUid('gemelnet:416')._cmpCategory,
        harelChips: trackTags(byUid('gemelnet:416')),
        equity: trackLabel(byUid('gemelnet:763')), general: trackLabel(byUid('gemelnet:154')),
        sp500: trackLabel(byUid('gemelnet:13502')), indexEq: trackLabel(byUid('gemelnet:15300')),
        indexBond: trackLabel(byUid('gemelnet:15298')), noStock: trackLabel(byUid('gemelnet:1374')),
        pensionEq: trackLabel(byUid('pensia:2175')), pensionCap: trackLabel(byUid('pensia:9980')),
        ira: trackLabel(byUid('gemelnet:1541')), ambiguous: trackLabel(byUid('gemelnet:124')),
        mixed: trackLabel(byUid('gemelnet:1034')), mixedNote: trackNote(byUid('gemelnet:1034')),
        annuity: trackLabel(byUid('pensia:8588')), noBonds: trackLabel(byUid('bituach:12981')),
        generalCap: trackLabel(byUid('gemelnet:384')), generalNoStockSub: trackLabel(byUid('gemelnet:1372')),
        // חשיפה מדווחת חריגה (30%) אינה מסתירה סיווג רשמי ברור.
        oddExposure: trackLabel(byUid('gemelnet:15962')), oddStock: byUid('gemelnet:15962').stock_pct,
        cappedAsEquity: namedCap.filter(r => trackLabel(r) === 'מסלול מנייתי').map(r => r.uid),
        nonEquityOfficial: equityLabelled.filter(r => r.source === 'gemelnet' && !/מניות|s&p|מדד/i.test(r.sub_specialization + r.specialization)).map(r => r.uid),
        chipLeak: equityChip.filter(r => /עד \d+ ?%|ללא מניות|אג"ח/.test(r.fund_name)).map(r => r.uid)
      };
    });
    check('bond track with up to 25% stocks is not labelled equity', cls.harel === 'מסלול אג״ח · עד 25% מניות', cls.harel);
    check('no capped / no-stock track is labelled equity', cls.cappedAsEquity.length === 0, cls.cappedAsEquity.join(','));
    check('every Gemel-Net "מסלול מנייתי" has an equity official class', cls.nonEquityOfficial.length === 0, cls.nonEquityOfficial.join(','));
    check('reported exposure alone does not hide an official label', cls.oddExposure === 'מסלול עוקב מדד S&P 500' && cls.oddStock < 50, cls.oddExposure + ' / ' + cls.oddStock);
    check('equity filter chip excludes bond / capped tracks', cls.chipLeak.length === 0 && !cls.harelChips.includes('equity') && cls.harelChips.includes('bond'), cls.chipLeak.join(','));
    check('labels for equity, general, index and no-stock tracks',
      cls.equity === 'מסלול מנייתי' && cls.general === 'מסלול כללי' && cls.sp500 === 'מסלול עוקב מדד S&P 500'
      && cls.indexEq === 'מסלול עוקב מדדי מניות' && cls.indexBond === 'מסלול עוקב מדדי אג״ח' && cls.noStock === 'מסלול כללי · ללא מניות'
      && cls.pensionEq === 'מסלול מנייתי' && cls.pensionCap === 'מסלול אג״ח · עד 25% מניות', JSON.stringify(cls));
    check('official "כללי" with a stock cap stays general, not bonds', cls.generalCap === 'מסלול כללי · עד 15% מניות' && cls.generalNoStockSub === 'מסלול כללי · ללא מניות', cls.generalCap + ' / ' + cls.generalNoStockSub);
    check('IRA shows "בניהול אישי" only', cls.ira === 'מסלול בניהול אישי', cls.ira);
    check('"משולב סחיר" and existing-annuity tracks are labelled, with a note for the term',
      cls.mixed === 'מסלול משולב סחיר' && /נסחרים בבורסה/.test(cls.mixedNote) && cls.annuity === 'מסלול קצבה לזכאים קיימים', JSON.stringify([cls.mixed, cls.annuity]));
    check('"ללא אג״ח" is not labelled a bond track', cls.noBonds === '', cls.noBonds);
    check('track without a reliable type gets no label', cls.ambiguous === '', cls.ambiguous);
    check('comparison group is unchanged by the label fix', cls.harelCmp === 'bonds_equity_sleeve', cls.harelCmp);

    // 17א. קבוצות ההשוואה: מקרי הקצה שתוקנו. בודקים את הקבוצה עצמה, לא רק שהבדיקות עוברות.
    const grp = await fresh.evaluate(() => {
      const r = uid => DATA.find(x => x.uid === uid);
      const peersOf = uid => { const x = withRuntimeFlags(r(uid)); const c = compareToPeers(x, null, null); return c ? c.feeCount : 0; };
      const pitzuimEquity = CMP_YIELD_GROUPS['pitzuim|equity'] || [];
      return {
        noStockSub: r('gemelnet:1372')._cmpCategory, cap10Sub: r('gemelnet:1276')._cmpCategory,
        generalCapName: r('gemelnet:384')._cmpCategory, generalNoStockName: r('gemelnet:1374')._cmpCategory,
        typo: r('pensia:2242')._cmpCategory, noBonds: r('bituach:12981')._cmpCategory,
        bondsNoStock: r('gemelnet:1107')._cmpCategory, harel: r('gemelnet:416')._cmpCategory,
        equityHasNoLimited: pitzuimEquity.every(x => !/ללא מניות|עד \d+ ?% ?מניות/.test(normalizeText(x.fund_name + ' ' + x.sub_specialization))),
        smallGroupHidden: compareToPeers(withRuntimeFlags(r('gemelnet:1374')), null, null) === null,
        bondsPeers: peersOf('gemelnet:1107')
      };
    });
    check('cmp: official "ללא מניות" / "עד 10% מניות" are not equity peers',
      grp.noStockSub === 'general_no_stock' && grp.cap10Sub === 'general_capped' && grp.equityHasNoLimited, JSON.stringify(grp));
    check('cmp: official "כללי" with a cap in the name is not a bond peer', grp.generalCapName === 'general_capped' && grp.generalNoStockName === 'general_no_stock');
    check('cmp: typo "במנית" joins the bonds-with-stocks group', grp.typo === 'bonds_equity_sleeve', grp.typo);
    check('cmp: "ללא אג״ח" is not a bond peer', grp.noBonds === 'unclassified', grp.noBonds);
    check('cmp: bond tracks keep their groups', grp.bondsNoStock === 'bonds_credit' && grp.harel === 'bonds_equity_sleeve');
    check('cmp: a group below the minimum shows no comparison', grp.smallGroupHidden && grp.bondsPeers >= 5, String(grp.bondsPeers));

    // 17ב. ממוצע התשואה והחשיפה: קבוצת מדיניות, אותו חודש, התאמת חשיפה גם למסלול הנבחן.
    const pol = await fresh.evaluate(() => {
      const sel = DATA.filter(r => isSelectableFund(r) && cmpIsFresh(r));
      const withAvg = sel.map(r => ({ r, c: compareToPeers(withRuntimeFlags(r), null, null) }))
        .filter(x => x.c && x.c.rows.some(row => row.key === 'yield' || row.key === 'stock'));
      const peersOk = withAvg.every(({ r }) => {
        const peers = cmpPolicyPeers(r);
        return peers && peers.length >= CMP_MIN_PEERS && peers.every(p => p.uid !== r.uid && p._cmpPolicy === r._cmpPolicy
          && Number(p.report_period) === Number(r.report_period) && typeof p._cmpExposure === 'number');
      });
      const med = r => cmpMedian((CMP_POLICY_GROUPS[r._cmpPolicy] || []).filter(p => Number(p.report_period) === Number(r.report_period)).map(p => p._cmpExposure).filter(v => typeof v === 'number'));
      const subjectFar = withAvg.filter(({ r }) => typeof r._cmpExposure !== 'number' || Math.abs(r._cmpExposure - med(r)) > CMP_EXPOSURE_GAP).length;
      const u = uid => DATA.find(x => x.uid === uid);
      const pc = uid => { const c = compareToPeers(withRuntimeFlags(u(uid)), null, null); return c ? c.rows.map(row => row.key) : []; };
      return {
        n: withAvg.length, peersOk, subjectFar,
        personal: pc('gemelnet:1541').filter(k => k === 'yield' || k === 'stock').length,
        unclear: pc('gemelnet:124').filter(k => k === 'yield' || k === 'stock').length,
        tradableSplit: u('gemelnet:15302')._cmpPolicy !== u('gemelnet:763')._cmpPolicy,
        capSplit: u('gemelnet:416')._cmpPolicy !== u('gemelnet:15303')._cmpPolicy && /cap25/.test(u('gemelnet:416')._cmpPolicy),
        ageSplit: new Set(['age50', 'age5060', 'age60'].map(k => DATA.find(x => isSelectableFund(x) && trackKindOf(x).kind === k && x._cmpProduct === 'gemel')._cmpPolicy)).size === 3,
        childSplit: new Set(DATA.filter(x => x._product === 'child' && isSelectableFund(x)).map(x => x._cmpPolicy)).size >= 3,
        pensionersSplit: /pensioners/.test(u('pensia:13226')._cmpPolicy),
        targetYears: new Set(DATA.filter(x => trackKindOf(x).kind === 'target' && isSelectableFund(x)).map(x => x._cmpPolicy.split('|').pop())).size >= 5,
        halachaSplit: u('gemelnet:2058')._cmpPolicy !== u('gemelnet:1523')._cmpPolicy,
        feeUnchanged: u('gemelnet:416')._cmpCategory === 'bonds_equity_sleeve'
      };
    });
    check('policy average: ≥5 same-policy, same-month peers with history, self excluded', pol.n > 0 && pol.peersOk, JSON.stringify(pol));
    check('policy average: the track itself passes the exposure match', pol.subjectFar === 0, String(pol.subjectFar));
    check('no yield/exposure average for personal or unclear tracks', pol.personal === 0 && pol.unclear === 0);
    check('separate groups: tradable, caps, ages, child risk, pensioners, target years, halacha',
      pol.tradableSplit && pol.capSplit && pol.ageSplit && pol.childSplit && pol.pensionersSplit && pol.targetYears && pol.halachaSplit, JSON.stringify(pol));
    check('fee comparison keeps its own grouping', pol.feeUnchanged);

    // 18. חיסכון עם יתרה בלבד, ושני מסלולים מאותו סוג באותה חברה.
    await seed(fresh, [
      { uid: 'gemelnet:416', balance: 84000, updated_at: new Date().toISOString() },
      { uid: 'gemelnet:154', balance: 126000, management_fee: 0.62, updated_at: new Date().toISOString() }
    ]);
    await fresh.reload(); await ready(fresh);
    await fresh.waitForFunction(() => document.body.classList.contains('dashboard-reached'));
    const lines = await fresh.evaluate(() => Array.from(document.querySelectorAll('#detailsRows .product')).map(el => ({
      title: el.querySelector('.product-title').textContent, track: (el.querySelector('.product-track-line') || {}).textContent || '' })));
    check('twins are told apart by the track name', lines.length === 2 && lines.every(l => l.title === 'קרן השתלמות בהראל')
      && lines[0].track !== lines[1].track && lines.some(l => /עד 25% מניות/.test(l.track)), JSON.stringify(lines));
    check('fee not entered shows "לא הוזנו", never 0 or the average', /^לא הוזנו$/.test((await fresh.textContent('#feeSavings')).trim())
      && /הוזנו ל-1 מתוך 2/.test(await fresh.textContent('#feeSavingsNote')));
    await fresh.click('[data-toggle-uid="gemelnet:416"]');
    const card416 = fresh.locator('.product[data-product-uid="gemelnet:416"]');
    check('open product: missing fee reads "לא הוזנו"', /לא הוזנו/.test(await card416.locator('[data-fee-edit]').first().textContent()));
    await card416.locator('.product-actions >> text=השוואה מלאה').click();
    const dlg = await fresh.textContent('#infoDialogBody');
    check('full table: track return with period, entered fee, and averages kept apart',
      /תשואת המסלול שלךמצטברת ל־3 שנים, לפני דמי ניהול/.test(dlg) && /דמי הניהול שלךלא הוזנו/.test(dlg)
      && /דמי ניהול ממוצעים במסלול/.test(dlg) && /קבוצת ההשוואה/.test(dlg) && /אינה תשואה שנתית/.test(dlg), dlg.slice(0, 200));
    await fresh.keyboard.press('Escape');
    const pageText = await fresh.evaluate(() => document.body.innerText + buildShareText('full'));
    check('no blanket "not your personal return" wording', !/לא התשואה האישית שלך|אינה התשואה האישית שלך/.test(pageText));
    check('performance section has a plain title', (await fresh.textContent('#perfSection summary')).includes('תשואות המסלולים שלך'));

    // 19. חשיפות: הסבר פשוט, והבהרה שאין לחבר את האחוזים.
    check('exposure overlap note is visible', await fresh.isVisible('.exposure-overlap'));
    const tipClosed = await fresh.evaluate(() => Array.from(document.querySelectorAll('.metric-tip-text')).every(el => !el.offsetParent));
    await fresh.click('.metric-tip');
    const tipOpen = await fresh.isVisible('#tipStock');
    await fresh.click('.metric-tip');
    await fresh.mouse.move(0, 0);   // במחשב הטולטיפ פתוח גם כל עוד העכבר על הכרטיס
    check('exposure explanation is a tooltip: no text under the number, "?" toggles it',
      (await fresh.locator('.metric-explain').count()) === 0 && !(await fresh.isVisible('.exposure-explain')) && tipClosed && tipOpen && !(await fresh.isVisible('#tipStock'))
      && /שוק המניות/.test(await fresh.textContent('#tipStock')));
    await fresh.click('.exposure-help');
    const expo = await fresh.textContent('#infoDialogBody');
    check('exposure dialog: plain first, jargon under "הרחבה"', /אינם מדידה מלאה של רמת הסיכון/.test(expo)
      && !(await fresh.isVisible('#infoDialogBody .method-details p')));
    await fresh.keyboard.press('Escape');

    // 20. רוחבי מסך: בלי גלילה אופקית ובלי טקסט זעיר.
    for (const width of [360, 390, 1280]) {
      await fresh.setViewportSize({ width, height: 800 });
      await fresh.click('[data-toggle-uid="gemelnet:416"]');
      const m = await fresh.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth,
        min: Math.min(...Array.from(document.querySelectorAll('#dashboard *, #detailsSection *')).filter(el => el.offsetParent && el.childNodes.length
          && Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim())).map(el => parseFloat(getComputedStyle(el).fontSize))) }));
      check(`${width}px: no horizontal scroll, text ≥ 12px`, m.sw <= m.w && m.min >= 12, JSON.stringify(m));
      await fresh.click('[data-toggle-uid="gemelnet:416"]');
    }

    // 21. מסך הפתיחה: הסבר קצר, החברות, ו"לא יודע" מתחת להן — סימן השאלה משמאל.
    const opener = await newPage();
    await opener.setViewportSize({ width: 360, height: 780 });
    const op = await opener.evaluate(() => {
      const top = sel => document.querySelector(sel).getBoundingClientRect().top;
      return { lead: document.querySelector('.wiz-lead').textContent, sub: document.querySelector('.wiz-sub').textContent,
        order: top('.wiz-lead') < top('.wiz-title') && top('.wiz-company-grid') < top('.wiz-unknown-top'),
        markLeft: getComputedStyle(document.querySelector('.wiz-unknown-top'), '::after').content === '"?"'
          && getComputedStyle(document.querySelector('.wiz-unknown-top'), '::before').content === 'none' };
    });
    check('opening screen explains, then companies, then "don\'t know" with the mark on the left', op.order && op.markLeft
      && /חשיפה למניות, לחו״ל ולמטבע חוץ/.test(op.lead) && /אפשר להתחיל מחיסכון אחד/.test(op.sub) && /בלי הרשמה/.test(op.sub), JSON.stringify(op));
    await opener.keyboard.press('Tab');
    let reached = false;
    for (let k = 0; k < 20 && !reached; k++) {
      reached = await opener.evaluate(() => document.activeElement && document.activeElement.classList.contains('wiz-unknown-top'));
      if (!reached) await opener.keyboard.press('Tab');
    }
    const ring = await opener.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    check('keyboard reaches "don\'t know" with a visible focus ring', reached && ring !== 'none', ring);
    await opener.keyboard.press('Enter');
    check('"don\'t know" opens the help screen', /איפה אפשר למצוא/.test(await opener.textContent('#wizScreen')));
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
