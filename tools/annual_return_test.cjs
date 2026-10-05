/* Run with Playwright installed: node tools/annual_return_test.cjs */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? { channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => {
      const file = new URL(route.request().url()).pathname.slice(1) || 'index.html';
      if (!['index.html','scripts.js','styles.css','funds_unified.json'].includes(file)) return route.abort();
      return route.fulfill({ body: fs.readFileSync(path.join(root,file),'utf8'), contentType: file.endsWith('.json') ? 'application/json' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto('http://annual.local/'); await page.waitForFunction(() => DATA.length > 0 && document.getElementById('wizard').dataset.step);
    const check = (name, ok) => { if (!ok) throw Error(name); console.log('PASS '+name); };
    const synthetic = await page.evaluate(() => {
      const rec = {hist_start:202501,report_period:202512,hist_yield:Array(12).fill(1)};
      const nullMonth = [...rec.hist_yield]; nullMonth[3] = null;
      return {
        compounded: trailingYearYield(rec), zeros: trailingYearYield({...rec,hist_yield:Array(12).fill(0)}),
        short: trailingYearYield({...rec,hist_yield:Array(11).fill(1)}), missing: trailingYearYield({...rec,hist_yield:nullMonth}),
        nan: trailingYearYield({...rec,hist_yield:[NaN,...Array(11).fill(1)]}), invalid: trailingYearYield({...rec,report_period:202513}),
        future: trailingYearYield({...rec,hist_yield:[...rec.hist_yield,90]}),
        aligned: trailingYearYield({hist_start:202401,report_period:202501,hist_yield:[50,...Array(12).fill(1),90]}),
        loss: trailingYearYield({...rec,hist_yield:[-10,...Array(11).fill(0)]}),
        young: trailingYearYield({...rec,hist_start:202502}),
        old: trailingYearYield({...rec,report_period:202411}),
        impossible: trailingYearYield({...rec,hist_yield:[-101,...Array(11).fill(0)]})
      };
    });
    check('annual return compounds 12 months rather than adding them', Math.abs(synthetic.compounded - (Math.pow(1.01,12)-1)*100) < 1e-10);
    check('zero returns remain valid', synthetic.zeros === 0);
    check('short, missing, invalid and impossible histories show no annual return', [synthetic.short,synthetic.missing,synthetic.nan,synthetic.invalid,synthetic.young,synthetic.old,synthetic.impossible].every(v => v === null));
    check('history ends at the fund report period and excludes future months', Math.abs(synthetic.future-synthetic.compounded)<1e-10 && Math.abs(synthetic.aligned-synthetic.compounded)<1e-10);
    check('negative annual returns are preserved', Math.abs(synthetic.loss+10)<1e-10);
    const sample = await page.evaluate(() => {
      const funds=DATA.filter(f=>isSelectableFund(f)&&isCurrentPeriod(f)&&Number.isFinite(trailingYearYield(f)));
      const chosen=Array.from({length:10},(_,i)=>funds[Math.floor(i*(funds.length-1)/9)]);
      return chosen.map(f=>({uid:f.uid,start:f.hist_start,period:f.report_period,history:f.hist_yield,result:trailingYearYield(f),comparison:trailingYearComparison(f),peers:(cmpPolicyPeers(f)||[]).map(p=>({uid:p.uid,start:p.hist_start,period:p.report_period,history:p.hist_yield}))}));
    });
    function independentAnnual(f) {
      const a=String(f.start), b=String(f.period);
      const last=(Number(b.slice(0,4))-Number(a.slice(0,4)))*12+Number(b.slice(4))-Number(a.slice(4));
      if(last<11||!Array.isArray(f.history)||last>=f.history.length)return null;
      const months=f.history.slice(last-11,last+1);
      if(months.length!==12||months.some(y=>typeof y!=='number'||!Number.isFinite(y)||y < -100))return null;
      let factor=1;for(const y of months)factor*=1+y/100;return (factor-1)*100;
    }
    check('sample includes 10 distinct real funds', new Set(sample.map(f=>f.uid)).size===10);
    for(const fund of sample){
      check('12-month return independently verified for '+fund.uid,Math.abs(fund.result-independentAnnual(fund))<1e-10);
      const peers=fund.peers.map(independentAnnual).filter(v=>v!==null);
      const expected=peers.length>=5?peers.reduce((s,y)=>s+y,0)/peers.length:null;
      check('peer average independently verified for '+fund.uid,expected===null?fund.comparison.peers===null:Math.abs(fund.comparison.peers-expected)<1e-10);
      check('same reporting month and subject excluded for '+fund.uid,fund.peers.every(p=>p.period===fund.period&&p.uid!==fund.uid));
    }
    const ids=await page.evaluate(()=>({ordinary:DATA.find(f=>f._product==='hishtalmut'&&isCurrentPeriod(f)&&Number.isFinite(trailingYearComparison(f).peers))?.uid,
      pension:DATA.find(f=>f._product==='pensia'&&isCurrentPeriod(f)&&Number.isFinite(trailingYearComparison(f).peers))?.uid}));
    if(!ids.ordinary)ids.ordinary=sample[0].uid;
    for(const uid of [ids.ordinary,ids.pension]) {
      if(!uid)throw Error('pension fixture missing');
      await page.evaluate(uid=>{const f=withRuntimeFlags(DATA.find(f=>f.uid===uid));userFunds=[{fund:f,balance:90000,managementFee:.6,depositFee:1,updated_at:new Date().toISOString()}];goToDashboard();setProductOpen(uid);},uid);
      check('exactly three tiles for '+uid,await page.locator('.product-three-stats > .product-stat').count()===3);
      for(const width of [320,390,768,901,1280]) {
        await page.setViewportSize({width,height:950});
        const boxes=await page.locator('.product-three-stats > .product-stat').evaluateAll(es=>es.map(e=>({w:e.offsetWidth,h:e.offsetHeight,sh:e.scrollHeight,ch:e.clientHeight,x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y})));
        check(`${width}px equal square cards for ${uid}`,boxes.every(b=>Math.abs(b.w-b.h)<=1&&Math.abs(b.w-boxes[0].w)<=1&&Math.abs(b.h-boxes[0].h)<=1&&b.sh<=b.ch));
        check(`${width}px stack on mobile, row on desktop`,width<=900?boxes.every(b=>Math.abs(b.x-boxes[0].x)<=1):boxes.every(b=>Math.abs(b.y-boxes[0].y)<=1));
        check(`${width}px no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        if(process.env.DESIGN_SCREENSHOTS&&[390,1280].includes(width)){fs.mkdirSync(process.env.DESIGN_SCREENSHOTS,{recursive:true});await page.locator('#detailsSection').screenshot({path:path.join(process.env.DESIGN_SCREENSHOTS,`annual-${uid.split(':')[0]}-${width}.png`)});}
      }
      await page.locator('.product-detail [data-info="full"]').click();
      check('annual return included in full comparison', (await page.textContent('#infoDialogBody')).includes('תשואה בשנה האחרונה'));
      await page.keyboard.press('Escape');
      if(uid===ids.pension){
        await page.locator('[data-fee-edit][data-fee-field="depositFee"]').click();
        check('deposit fee retains correct accessible label',/מהפקדות/.test(await page.locator('.product-fee-input').getAttribute('aria-label')));
        await page.locator('.product-fee-input').fill('1.25');await page.keyboard.press('Enter');
        check('deposit fee can still be edited in third tile',await page.evaluate(()=>userFunds[0].depositFee===1.25));
      }
      await page.evaluate(()=>preparePrintLayout());await page.emulateMedia({media:'print'});
      check('annual return included in print table', (await page.locator('.print-only').textContent()).includes('תשואה בשנה האחרונה'));
      await page.emulateMedia({media:'screen'});await page.evaluate(()=>restorePrintLayout());
    }
    check('no browser errors',!errors.length);
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
