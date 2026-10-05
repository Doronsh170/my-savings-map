/* Browser regression tests for the simplified Hebrew dashboard.
   Run: node tools/dashboard_design_test.cjs
   Optional: PLAYWRIGHT_BROWSER_CHANNEL=msedge, DESIGN_SCREENSHOTS=<directory> */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const results = [];
function check(name, ok, detail = '') {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.resolve(ROOT, '.' + (rel === '/' ? '/index.html' : rel));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  const ready = page => page.waitForFunction(() => DATA.length > 0 && document.getElementById('wizard').dataset.step);
  const newPage = async () => {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', err => check('no browser errors', false, err.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    await page.goto(base); await ready(page); return page;
  };
  const seed = async (page, rows) => {
    await page.evaluate(r => localStorage.setItem(STORAGE_KEY, JSON.stringify(r)), rows);
    await page.reload(); await ready(page);
    await page.waitForFunction(() => document.body.classList.contains('dashboard-reached'));
  };
  try {
    const page = await newPage();
    check('new visitor starts with savings types', await page.isVisible('[data-wiz="product"][data-value="pensia"]') && !(await page.isVisible('#dashboard')));
    await page.setViewportSize({ width: 390, height: 844 });
    check('opening illustration appears on mobile', await page.isVisible('.savings-orbit'));
    await page.click('[data-wiz="product"][data-value="pensia"]');
    check('pension does not offer Analyst', !(await page.locator('.wiz-company:has-text("אנליסט")').count()));
    const links = await page.evaluate(() => ['[data-wiz="allCompanies"]', '.wiz-unknown-top'].map(s => document.querySelector(s)?.getBoundingClientRect().top));
    check('other-company option precedes the help option', links.every(Number.isFinite) && links[0] < links[1]);
    const picks = await page.evaluate(() => {
      const current = DATA.find(f => isSelectableFund(f) && isCurrentPeriod(f) && f.stock_pct != null && f.ytd_yield != null && compareToPeers(f, 0.5, 1));
      const pension = DATA.find(f => isSelectableFund(f) && f._product === 'pensia' && isCurrentPeriod(f) && compareToPeers(f, 0.3, 1));
      const missing = DATA.find(f => isSelectableFund(f) && f.stock_pct == null);
      const historical = DATA.find(f => isSelectableFund(f) && !isCurrentPeriod(f) && f.stock_pct != null);
      return { current, pension, missing, historical };
    });
    if (Object.values(picks).some(v => !v)) throw Error('dataset lacks required regression fixtures');
    const stamp = new Date().toISOString();
    const rows = [
      { uid: picks.current.uid, balance: 300000, management_fee: 0.5, updated_at: stamp },
      { uid: picks.pension.uid, balance: 200000, management_fee: 0.3, deposit_fee: 1, updated_at: stamp },
      { uid: picks.historical.uid, balance: 100000, updated_at: stamp }
    ];
    await seed(page, rows);
    check('returning user goes directly to portfolio', await page.isVisible('#dashboard') && !(await page.isVisible('#wizard')));
    check('total and count are concise', (await page.textContent('#totalBalance')).replace(/\D/g, '') === '600000' && (await page.textContent('#portfolioSummary')) === '3 חסכונות');
    check('dataset date is visible next to the balance information', await page.isVisible('#dataUpdateMeta') && /\d{2}\/\d{4}/.test(await page.textContent('#dataUpdateMeta')));
    check('historical notice uses the requested wording', (await page.textContent('#coverageNote summary')).replace(/\s+/g, ' ').trim() === 'לחלק מהחסכונות יש נתונים היסטוריים · הצג פרטים');
    check('historical details begin collapsed', !(await page.isVisible('.data-status-body')));
    await page.click('#coverageNote summary');
    check('historical details identify funds and their reporting periods', await page.isVisible('.data-status-body') && (await page.textContent('.data-status-body')).includes(picks.historical.fund_name) && /אינם נכללים בתשואות/.test(await page.textContent('.data-status-body')));
    await page.click('#coverageNote summary');
    const overviewOrder = await page.evaluate(() => ['totalBalance', 'aggStock', 'detailsRows', 'perfSection', 'feesSection', 'historySection', 'simulationEntrySection', 'bottomActions'].map(id => document.getElementById(id).getBoundingClientRect().top));
    check('overview follows the agreed order', overviewOrder.every((n, i) => !i || n > overviewOrder[i - 1]));
    const productUids = await page.locator('#detailsRows .product').evaluateAll(es => es.map(e => e.dataset.productUid));
    check('products are sorted by balance', JSON.stringify(productUids) === JSON.stringify(rows.map(r => r.uid)));
    check('closed rows show names, balances, weights without fees or logos', await page.locator('.product-row img').count() === 0 && await page.locator('.product-inds:visible').count() === 0 && await page.locator('.product-detail:visible').count() === 0);
    const stockExpected = (picks.current.stock_pct * 300000 + picks.pension.stock_pct * 200000 + picks.historical.stock_pct * 100000) / 600000;
    check('exposure weighting is unchanged', await page.textContent('#aggStock') === stockExpected.toFixed(1));
    const ytdExpected = (picks.current.ytd_yield * 300000 + picks.pension.ytd_yield * 200000) / 500000;
    check('returns still exclude historical report periods', await page.textContent('#perfYtd') === ytdExpected.toFixed(2));
    await page.click('[data-toggle-uid="' + picks.current.uid + '"]');
    await page.click('[data-toggle-uid="' + picks.pension.uid + '"]');
    check('only one product opens at a time', await page.locator('.product-detail:visible').count() === 1);
    const pensionCard = page.locator('.product[data-product-uid="' + picks.pension.uid + '"]');
    check('pension still has separate accumulation and deposit fees', await pensionCard.locator('[data-fee-edit]').count() === 2);
    await pensionCard.locator('[data-info="full"]').click();
    const headers = await page.locator('#infoDialogBody .product-cmp thead').allTextContents();
    check('full comparison separates track data from entered fees', headers.length === 2 && headers[0].includes('המסלול שלך') && headers[1].includes('דמי הניהול שלך') && headers.every(h => h.includes('ממוצע קבוצת ההשוואה')));
    await page.keyboard.press('Escape');
    await pensionCard.locator('[data-fee-edit][data-fee-field="managementFee"]').click();
    await page.locator('.product-fee-input').fill('0.42'); await page.keyboard.press('Enter');
    check('fee edit persists without changing the balance date', await page.evaluate(uid => { const r = JSON.parse(localStorage.getItem(STORAGE_KEY)).find(r => r.uid === uid); return r.management_fee === 0.42 && r.updated_at; }, picks.pension.uid));
    await pensionCard.locator('[data-fee-edit][data-fee-field="managementFee"]').click();
    await page.locator('.product-fee-input').fill('0.9'); await page.keyboard.press('Escape');
    check('Escape cancels a fee change', await page.evaluate(uid => userFunds.find(i => i.fund.uid === uid).managementFee === 0.42, picks.pension.uid));
    await page.click('#feesSection summary');
    check('fees have their own section outside returns', await page.isVisible('#feeRows') && await page.locator('#feesSection #feeSavings').count() === 1 && await page.locator('#perfSection #feeSavings').count() === 0 && await page.locator('.fee-row').count() === 3);
    check('missing fee is not displayed as zero', (await page.textContent('#feeSavings')).trim() === 'לא הוזנו' && /2 מתוך 3/.test(await page.textContent('#feeSavingsNote')));
    await page.locator('[data-fee-open-uid="' + picks.historical.uid + '"]').click();
    check('fee section update opens the right product editor', await page.locator('.product-fee-input').getAttribute('data-fee-uid') === picks.historical.uid);
    await page.locator('.product-fee-input').fill('0.2'); await page.keyboard.press('Enter');
    const feeExpected = ((300000 * 0.5 + 200000 * 0.42 + 100000 * 0.2) / 600000).toFixed(2);
    check('fee average updates correctly across both sections', await page.textContent('#feeSavings') === feeExpected && (await page.textContent('#feeRows')).includes('0.20%'));
    await page.click('.exposure-help');
    check('one exposure explanation contains definitions and overlap', await page.isVisible('#infoDialog') && /מטבעות זרים/.test(await page.textContent('#infoDialogBody')) && /אין לחבר את האחוזים/.test(await page.textContent('#infoDialogBody')));
    await page.keyboard.press('Escape');
    check('calculator is an entry point, not extra form content in the dashboard', await page.isVisible('#openSimulationBtn') && !(await page.isVisible('#simulationTabSection')));
    const storedBeforeSimulation = await page.evaluate(() => localStorage.getItem(STORAGE_KEY));
    await page.click('#openSimulationBtn');
    check('simulation opens its own view with a return button', await page.isVisible('#simulationTabSection') && await page.isVisible('#simulationBackBtn') && !(await page.isVisible('#dashboard')) && !(await page.isVisible('#bottomActions')));
    check('secondary assumptions are collapsed with their actual defaults shown', !(await page.isVisible('#simFeeInput')) && !(await page.isVisible('#simInflationInput')) && (await page.textContent('#simAdvancedSummary')).includes('אינפלציה 2.0%') && (await page.textContent('#simAdvancedSummary')).includes(`דמי ניהול ${feeExpected}%`));
    await page.locator('#simYearsInput').fill('2');
    await page.click('#simAdvanced summary'); await page.locator('#simFeeInput').fill('0');
    await page.click('#simRunBtn');
    const simulation = await page.evaluate(() => {
      const st = weightedMetric('stock_pct', getTotalBalance());
      return { expected: Math.round(getTotalBalance() * (1 + simAnnualYield(0, st) / 100) * (1 + simAnnualYield(1, st) / 100)), got: Number(document.getElementById('simFinalAmount').textContent.replace(/\D/g, '')) };
    });
    check('separate calculator preserves historical compounding', Math.abs(simulation.got - simulation.expected) <= 1, JSON.stringify(simulation));
    check('simulation does not change saved portfolio data', await page.evaluate(() => localStorage.getItem(STORAGE_KEY)) === storedBeforeSimulation);
    const shotDir = process.env.DESIGN_SCREENSHOTS;
    if (shotDir) { fs.mkdirSync(shotDir, { recursive: true }); await page.screenshot({ path: path.join(shotDir, 'simulation-mobile.png'), fullPage: true }); }
    await page.click('#simulationBackBtn'); await page.waitForFunction(() => !document.body.classList.contains('simulation-view'));
    check('return restores the portfolio and hides calculator', await page.isVisible('#dashboard') && !(await page.isVisible('#simulationTabSection')));
    await page.goForward(); await page.waitForFunction(() => document.body.classList.contains('simulation-view'));
    check('browser forward reopens simulation', await page.isVisible('#simulationTabSection'));
    await page.goBack(); await page.waitForFunction(() => !document.body.classList.contains('simulation-view'));
    check('browser back returns to portfolio', await page.isVisible('#dashboard'));
    await page.click('.total-actions >> text=עדכון יתרות');
    await page.locator('#balancesRows input').first().fill(''); await page.click('#balancesForm button[type="submit"]');
    check('empty balance is rejected', await page.isVisible('#balancesError') && await page.isVisible('#balancesDialog'));
    await page.locator('#balancesRows input').first().fill('330000'); await page.click('#balancesForm button[type="submit"]');
    check('balance update changes total', !(await page.isVisible('#balancesDialog')) && (await page.textContent('#totalBalance')).replace(/\D/g, '') === '630000');
    await page.click('.action-toolbar >> text=שיתוף בווטסאפ');
    check('sharing still defaults to no amounts with a preview', await page.isVisible('#shareDialog') && (await page.locator('[name="shareMode"][value="exposure"]').isChecked()) && !/₪/.test(await page.inputValue('#sharePreview')));
    const shareTexts = await page.evaluate(() => ({ a: buildShareText('exposure'), f: buildShareText('full'), l: buildShareText('link') }));
    check('share levels retain their information boundaries', !/₪/.test(shareTexts.a) && /₪/.test(shareTexts.f) && !shareTexts.f.includes('#p=') && shareTexts.l.includes('#p='));
    await page.evaluate(() => cancelShare());
    check('delete-all stays collapsed inside management', !(await page.isVisible('.reset-link')) && await page.locator('.action-toolbar .reset-link').count() === 0);
    await page.click('.portfolio-management summary');
    let asked = false; page.once('dialog', async d => { asked = true; await d.dismiss(); });
    await page.click('.reset-link');
    check('deletion still requires the existing confirmation and cancel preserves data', asked && await page.evaluate(() => userFunds.length === 3));
    await page.click('.portfolio-management summary');
    await seed(page, [{ uid: picks.current.uid, balance: 100000, updated_at: stamp }, { uid: picks.missing.uid, balance: 100000, updated_at: stamp }]);
    check('missing exposure is excluded instead of counted as zero', await page.textContent('#aggStock') === picks.current.stock_pct.toFixed(1));
    check('partial coverage is visible beside the affected metric', await page.isVisible('#aggStockCoverage') && await page.textContent('#aggStockCoverage') === 'לפי 50% מהתיק');
    await page.click('#coverageNote summary');
    check('full coverage details remain available', (await page.textContent('#coverageNote')).includes('חשיפה למניות — 50% מהתיק'));
    await page.click('#coverageNote summary');
    await seed(page, [{ uid: picks.current.uid, balance: 100000, management_fee: 0.5, updated_at: stamp }]);
    check('complete current data does not show a historical warning', !(await page.isVisible('#coverageNote')));
    const sharedUrl = await page.evaluate(() => buildShareUrl());
    const recipient = await newPage();
    await seed(recipient, [{ uid: picks.pension.uid, balance: 50000 }]);
    const recipientSaved = await recipient.evaluate(() => localStorage.getItem(STORAGE_KEY));
    await recipient.goto(sharedUrl); await ready(recipient); await recipient.waitForFunction(() => SHARED_VIEW);
    check('shared view remains separate from the saved portfolio', await recipient.isVisible('#sharedViewBanner') && await recipient.evaluate(() => localStorage.getItem(STORAGE_KEY)) === recipientSaved);
    await recipient.click('#openSimulationBtn'); await recipient.click('#simulationBackBtn'); await recipient.waitForFunction(() => !document.body.classList.contains('simulation-view'));
    check('simulation back retains the shared-view banner and own saved data', await recipient.isVisible('#sharedViewBanner') && await recipient.evaluate(() => localStorage.getItem(STORAGE_KEY)) === recipientSaved);
    await recipient.click('text=סגירה וחזרה לתיק שלי');
    check('closing shared view restores own portfolio', await recipient.evaluate(uid => userFunds.length === 1 && userFunds[0].fund.uid === uid, picks.pension.uid));
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => { document.querySelector('.perf-toggle-section').open = true; document.querySelector('.fees-toggle-section').open = true; setProductOpen(userFunds[0].fund.uid); });
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, label: document.querySelector('.exposure-grid .metric-label').getBoundingClientRect(), val: document.querySelector('.exposure-grid .metric-value').getBoundingClientRect() }));
      check(`${width}px portfolio and open panels fit without horizontal scrolling`, m.sw <= m.w, `${m.sw}/${m.w}`);
      check(`${width}px exposure label and value do not overlap`, m.label.right <= m.val.left || m.val.right <= m.label.left || m.label.bottom <= m.val.top || m.val.bottom <= m.label.top);
      await page.click('#openSimulationBtn');
      check(`${width}px separate simulation fits`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.click('#simulationBackBtn'); await page.waitForFunction(() => !document.body.classList.contains('simulation-view'));
      await page.evaluate(() => { document.querySelector('.perf-toggle-section').open = false; document.querySelector('.fees-toggle-section').open = false; OPEN_PRODUCT_UID = null; renderDashboard(); });
      if (shotDir && [390,1280].includes(width)) await page.screenshot({ path: path.join(shotDir, `portfolio-${width}.png`), fullPage: true });
    }
    await seed(page, rows);
    await page.evaluate(() => preparePrintLayout()); await page.emulateMedia({ media: 'print' });
    const print = await page.evaluate(() => ({ products: [...document.querySelectorAll('.product-detail')].filter(e => getComputedStyle(e).display !== 'none').length, coverage: getComputedStyle(document.querySelector('.data-status-body')).display, fees: getComputedStyle(document.getElementById('feesSection')).display, buttons: [...document.querySelectorAll('.product-actions')].some(e => getComputedStyle(e).display !== 'none') }));
    check('print retains all fund detail, fees and historical disclosure without actions', print.products === 3 && print.coverage !== 'none' && print.fees !== 'none' && !print.buttons, JSON.stringify(print));
    if (shotDir) await page.pdf({ path: path.join(shotDir, 'portfolio-report.pdf'), printBackground: true });
    await page.emulateMedia({ media: 'screen' }); await page.evaluate(() => restorePrintLayout());
    await page.click('.total-actions >> text=הוספת חיסכון');
    check('adding another saving still has a way back to the portfolio', await page.isVisible('#wizard') && await page.locator('#wizBar >> text=חזרה לתיק').count() === 1);
    await page.click('#wizBar >> text=חזרה לתיק');
    check('return from wizard shows the existing portfolio', await page.isVisible('#dashboard'));
  } catch (error) { check('test suite completed', false, error.stack); }
  finally { await browser.close(); server.close(); }
  const failed = results.filter(v => !v).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
})().catch(err => { console.error(err); server.close(); process.exitCode = 1; });
