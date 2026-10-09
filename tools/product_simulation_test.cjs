const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const fixture = (uid, stock) => ({uid, fund_id:uid, fund_name:'קרן השתלמות לדוגמה '+uid, managing_company:'מיטב', source:'gemelnet', _product:'hishtalmut', stock_pct:stock, foreign_pct:20, fx_pct:15, liquid_pct:70, total_assets:1000, report_period:202608, hist_start:202507, hist_yield:Array(14).fill(1), hist_stock:Array(14).fill(stock), monthly_yield:1, ytd_yield:5, yield_trailing_3yrs:15});
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_BROWSER_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_BROWSER_EXECUTABLE} : process.env.PLAYWRIGHT_BROWSER_CHANNEL ? {channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL} : {})});
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const file=new URL(route.request().url()).pathname.slice(1)||'index.html';if(file==='funds_unified.json')return route.fulfill({json:{funds:[fixture('a',25),fixture('b',90)]}});if(!['index.html','scripts.js','styles.css'].includes(file))return route.abort();return route.fulfill({body:fs.readFileSync(path.join(root,file)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});});
  await page.goto('http://simulation.local');await page.waitForFunction(()=>DATA.length===2);
  await page.evaluate(()=>{userFunds=DATA.map((f,i)=>({fund:withRuntimeFlags(f),balance:100000,managementFee:i?.9:.3,updated_at:new Date().toISOString()}));goToDashboard();setProductOpen('a');});
  assert.equal(await page.locator('#simulationEntrySection').isVisible(),false);
  assert.equal(await page.locator('.product-simulation:visible').count(),1);
  const a=page.locator('[data-sim-uid="a"]');
  assert.equal(await a.getAttribute('open'),null);
  assert.equal(await a.locator('[data-product-sim="monthly"]').isVisible(),false);
  await a.locator('summary').click();
  assert.equal(await a.locator('[data-product-sim="monthly"]').isVisible(),true);
  assert.match(await a.innerText(),/מבוסס על תשואות עבר \(1995–2024\), אינו תחזית לעתיד\./);
  assert.match(await a.locator('.product-sim-note strong').innerText(),/אינה הבטחה לתשואה או לסכום עתידי/);
  assert.match(await a.locator('.product-sim-heading').innerText(),/הסכום הצפוי בחיסכון/);
  await a.locator('[data-product-sim="monthly"]').fill('1000');
  await a.locator('[data-product-sim="years"]').fill('10');
  const expected=await page.evaluate(()=>{let amount=100000;for(let y=0;y<10;y++){const r=Math.pow(1+simAnnualYield(y,25)/100,1/12);for(let m=0;m<12;m++)amount=amount*r*(1-.3/1200)+1000;}return fmtSimCurrency(amount);});
  assert.match(await a.innerText(),new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  await a.locator('[data-product-sim="years"]').fill('31');assert.match(await a.innerText(),/1–30/);
  await a.locator('[data-product-sim="years"]').fill('10');
  await page.evaluate(()=>setProductOpen('b'));const b=page.locator('[data-sim-uid="b"]');assert.equal(await b.locator('[data-product-sim="monthly"]').inputValue(),'');
  assert.equal(await b.getAttribute('open'),null);
  assert.equal(await b.locator('[data-product-sim="monthly"]').isVisible(),false);
  await page.evaluate(()=>setProductOpen('a'));assert.equal(await a.locator('[data-product-sim="monthly"]').inputValue(),'1000');
  assert.equal(await a.locator('.product-sim-today, .product-sim-assumption').count(),0);
  assert.doesNotMatch(await a.innerText(),/נומינלי|ריאלי|הפקדות עתידיות|רווח בסימולציה|עליית המחירים/);
  const beforeFee=await a.locator('.product-sim-amount').innerText();
  await page.evaluate(()=>{userFunds[0].managementFee=1;updateProductSimulation(document.querySelector('[data-sim-uid="a"]'));});assert.notEqual(await a.locator('.product-sim-amount').innerText(),beforeFee);
  await page.evaluate(()=>{userFunds[0].fund.stock_pct=null;updateProductSimulation(document.querySelector('[data-sim-uid="a"]'));});assert.match(await a.innerText(),/חסר נתון/);
  await page.evaluate(()=>{userFunds[0].fund.stock_pct=25;userFunds[0].managementFee=null;updateProductSimulation(document.querySelector('[data-sim-uid="a"]'));});assert.match(await a.innerText(),/לא הוזנו/);
  assert.equal(await page.evaluate(()=>!!(document.getElementById('historySection').compareDocumentPosition(document.getElementById('bottomActions'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
  assert.equal(await page.locator('#saveShareDetails').getAttribute('open'),null);
  assert.equal(await page.locator('#professionalDetails').getAttribute('open'),null);
  assert.equal(await page.locator('#bottomActions .action-toolbar').isVisible(),false);
  await page.locator('[data-close-product="a"]').click();
  await page.locator('#saveShareDetails > summary').click();
  assert.equal(await page.locator('#bottomActions .action-toolbar').isVisible(),true);
  assert.equal(await page.locator('#saveShareDetails .action-toolbar > button').count(),3);
  assert.equal(await page.locator('.portfolio-management').count(),0);
  await page.locator('#saveShareDetails [data-footer-close]').click();
  await page.locator('#professionalDetails > summary').click();
  for(const id of ['landingAboutPanel','landingDisclosurePanel','landingPrivacyPanel']) assert.equal(await page.locator('#'+id).isVisible(),true);
  await page.locator('#professionalDetails [data-footer-close]').click();
  for(const width of [320,360,390,768,1280]){
   await page.setViewportSize({width,height:1000});
   const rows=await page.locator('#historyDetails > summary, #saveShareDetails > summary, #professionalDetails > summary').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {w:r.width,h:r.height,x:r.x};}));
   assert.ok(rows.every(r=>Math.abs(r.w-rows[0].w)<1&&Math.abs(r.h-rows[0].h)<1&&Math.abs(r.x-rows[0].x)<1),`footer rows match at ${width}px`);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   const summary=page.locator('#historyDetails > summary');
   for(const open of [false,true]){
    await page.locator('#historyDetails').evaluate((el,open)=>el.open=open,open);
    const geometry=await summary.evaluate(el=>{const r=el.getBoundingClientRect(),t=el.querySelector('span').getBoundingClientRect();return {center:Math.abs((r.left+r.right)/2-(t.left+t.right)/2),fits:t.left>=r.left&&t.right<=r.right,minHeight:r.height};});
    assert.ok(geometry.center<1,`history text centered at ${width}px, open=${open}`);
    assert.ok(geometry.fits&&geometry.minHeight>=44);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(width===390&&open) await page.screenshot({path:path.join(root,'..','simulation-mobile-preview.png'),fullPage:true});
   }
  }
  await page.evaluate(()=>{userFunds.push({...userFunds[1],fund:{...userFunds[1].fund,uid:'c',fund_name:'מוצר שלישי לדוגמה'}});goToDashboard();});
  for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:740});
   for(const id of ['historyDetails','saveShareDetails','professionalDetails']){
    await page.locator('#'+id+' > summary').click();
    const dialog=page.locator('#'+id+' .footer-focus-dialog');
    assert.equal(await dialog.isVisible(),true);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).position),'fixed');
    const previous=await page.evaluate(()=>FOOTER_FOCUS_SCROLL);
    await dialog.locator('.footer-focus-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
    const button=await dialog.locator('[data-footer-close]').boundingBox();
    assert.ok(button.y>=0&&button.y+button.height<=740);
    assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await dialog.locator('[data-footer-close]').click();
    assert.ok(Math.abs(await page.evaluate(()=>scrollY)-previous)<2);
    assert.equal(await page.evaluate(()=>document.body.classList.contains('footer-view-open')),false);
   }
  }
  for(const width of [320,390,768,1280]){
   await page.setViewportSize({width,height:740});
   for(const uid of ['b','a','c','b']){
    await page.locator(`[data-toggle-uid="${uid}"]`).click();
    await page.waitForTimeout(100);
    const dialog=page.locator(`.product-focus-dialog[data-focus-uid="${uid}"]`);
    const bounds=await dialog.locator('.product-focus-heading').boundingBox();
    assert.ok(bounds.y>=0&&bounds.y+bounds.height<=740,`product heading visible at ${width}px (${uid})`);
    assert.equal(await page.locator('.product.is-open').getAttribute('data-product-uid'),uid);
    assert.equal(await page.locator('.product-focus-dialog[open]').count(),1);
    const returnedScroll=await page.evaluate(()=>PRODUCT_VIEW_SCROLL);
    await dialog.locator('.product-focus-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
    const closeBox=await dialog.locator('[data-close-product]').boundingBox();
    assert.ok(closeBox.y>=0&&closeBox.y+closeBox.height<=740,`close button visible at ${width}px`);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.body).position),'fixed');
    assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    if(width===390&&uid==='a')await page.screenshot({path:path.join(root,'..','focused-product-mobile.png')});
    await dialog.locator('[data-close-product]').click();
    assert.equal(await page.locator('.product-focus-dialog[open]').count(),0);
    assert.ok(Math.abs((await page.evaluate(()=>scrollY))-returnedScroll)<2);
    assert.equal(await page.evaluate(()=>document.body.classList.contains('product-view-open')),false);
   }
  }
  await page.locator('[data-toggle-uid="a"]').click();
  await page.locator('.product-focus-dialog[open] [data-info="full"]').click();
  assert.equal(await page.locator('#infoDialog').getAttribute('open'),'');
  await page.locator('#infoDialog .info-dialog-x').click();
  assert.equal(await page.locator('.product-focus-dialog[open]').count(),1);
  await page.locator('.product-focus-dialog[open] [data-edit-uid]').click();
  assert.equal(await page.locator('.product-focus-dialog[open]').count(),0);
  assert.equal(await page.evaluate(()=>document.body.classList.contains('product-view-open')),false);
  assert.equal(await page.locator('#wizard').isVisible(),true);
  await page.evaluate(()=>{goToDashboard();setProductOpen('a');});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.product-focus-dialog[open]').count(),0);
  await page.locator('#saveShareDetails > summary').click();
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('#saveShareDetails .action-delete').click();
  assert.equal(await page.evaluate(()=>userFunds.length),3);
  assert.equal(await page.locator('#saveShareDetails .footer-focus-dialog').isVisible(),true);
  await page.locator('#saveShareDetails [data-footer-close]').click();
  await page.screenshot({path:path.join(root,'..','simulation-preview.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS inline simulation: independent product inputs, historical calculation, fees, validation, missing data, secondary history, responsive layout, no runtime errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
