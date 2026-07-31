/* === לוגיקת הדשבורד הראשית: טעינת נתונים, חיפוש, תיק אישי, סימולציה === */
let DATA = [];
let META = {};
let DATASET_MAX_PERIOD = null;
let activeFilter = 'all';
let userFunds = [];
let missingSavedFunds = [];
let CURRENT_EDIT_FUND = null;
let LAST_FOCUSED_UID = null;
let QUICK_RETURN_VISIBLE = false;
const balanceInputTimers = {};
const feeInputTimers = {};
const STORAGE_KEY = 'pension_dashboard_funds_v3';

const SOURCE_LABEL = {
  gemelnet: 'גמל',
  pensia: 'פנסיה',
  bituach: 'ביטוח מנהלים',
};
const SOURCE_DOT_COLOR = {
  gemelnet: '#102743',
  pensia: '#7488a1',
  bituach: '#dcaf61',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
function fmtPeriod(yyyymm) {
  if (!yyyymm) return '-';
  const s = String(yyyymm);
  return s.slice(4, 6) + '/' + s.slice(0, 4);
}
function fmtPeriodHebrew(yyyymm) {
  if (!yyyymm) return '-';
  const s = String(yyyymm);
  const y = s.slice(0, 4);
  const m = parseInt(s.slice(4, 6), 10);
  const months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  return `${months[m - 1] || fmtPeriod(yyyymm)} ${y}`;
}
function monthDiff(periodA, periodB) {
  if (!periodA || !periodB) return 0;
  const a = String(periodA), b = String(periodB);
  const yA = parseInt(a.slice(0, 4), 10), mA = parseInt(a.slice(4, 6), 10);
  const yB = parseInt(b.slice(0, 4), 10), mB = parseInt(b.slice(4, 6), 10);
  return (yB - yA) * 12 + (mB - mA);
}
function fmtPct(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) + '%' : '-';
}
function fmtNum(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : '-';
}
function fmtCurrency(value) {
  return '₪' + Math.round(value).toLocaleString('he-IL');
}
function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[״"'`׳]/g, '')
    .replace(/[&]/g, ' and ')
    .replace(/[.,()\/\_]/g, ' ')
    .replace(/[-\u2013\u2014]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function compactText(value) {
  return normalizeText(value).replace(/[^a-z0-9א-ת]/g, '');
}
let LAST_SEARCH_TOTAL = 0;
function withRuntimeFlags(rec) {
  const monthsBehind = monthDiff(rec.report_period, DATASET_MAX_PERIOD);
  return {
    ...rec,
    months_behind: monthsBehind,
    is_stale: monthsBehind > 3,
    is_micro_fund: (Number(rec.total_assets) || 0) < 10,
  };
}
function metricClass(value) {
  if (!Number.isFinite(value)) return '';
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return '';
}


function getGemelSubProduct(rec) {
  const cls = normalizeText(rec.classification || '');
  if (cls.includes('קרנות השתלמות')) return 'hishtalmut';
  if (cls.includes('גמל להשקעה')) return 'gemel-invest';
  if (rec.source === 'gemelnet') return 'gemel';
  return '';
}
function getBituachSubProduct(rec) {
  const name = normalizeText(rec.fund_name || '');
  const cls = normalizeText(rec.classification || '');
  const isOldPolicy = cls.includes('1990') || cls.includes('1991') || cls.includes('1992') || cls.includes('2003');
  const looksLikeManagerPolicy = isOldPolicy || name.includes('משתתף ברווחים') || name.includes('מקבלי קצבה') || name.includes('לבני 50') || name.includes('לבני 60') || name.includes('קרן ט') || name.includes('קרן י');
  return looksLikeManagerPolicy ? 'manager-insurance' : 'savings-policy';
}
function recMatchesSubProduct(rec, subtype) {
  if (!subtype) return true;
  if (rec.source === 'gemelnet') return getGemelSubProduct(rec) === subtype;
  if (rec.source === 'bituach') return getBituachSubProduct(rec) === subtype;
  return true;
}
function subProductLabel(subtype) {
  const labels = {
    'gemel': 'קופת גמל',
    'hishtalmut': 'קרן השתלמות',
    'gemel-invest': 'גמל להשקעה',
    'manager-insurance': 'ביטוח מנהלים',
    'savings-policy': 'פוליסות חיסכון'
  };
  return labels[subtype] || '';
}


function companyFieldsText(rec) {
  return normalizeText([
    rec.managing_corp,
    rec.parent_company_name,
    rec.controlling_corp
  ].filter(Boolean).join(' '));
}

function textTokens(value) {
  return normalizeText(value)
    .replace(/[^֐-׿a-z0-9]+/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function companyAliasTokens(query) {
  const q = normalizeText(query);
  const map = {
    'כלל': ['כלל'],
    'מור': ['מור'],
    'מנורה': ['מנורה'],
    'מנורה מבטחים': ['מנורה'],
    'הראל': ['הראל'],
    'הפניקס': ['הפניקס', 'פניקס'],
    'פניקס': ['הפניקס', 'פניקס'],
    'מגדל': ['מגדל'],
    'מיטב': ['מיטב'],
    'אלטשולר': ['אלטשולר'],
    'אלטשולר שחם': ['אלטשולר']
  };
  return map[q] || textTokens(q);
}

function recMatchesSelectedCompany(rec, query) {
  const fieldsText = companyFieldsText(rec);
  const tokens = new Set(textTokens(fieldsText));
  const aliases = companyAliasTokens(query);
  if (!aliases.length) return true;

  // חשוב: סינון יצרן מתבצע רק לפי שדות החברה, ולא לפי שם הקופה/המסלול.
  // כך "כלל" לא יתפוס מסלולים עם המילה "כללי", ו"מור" לא יתפוס "מורים".
  return aliases.some(alias => tokens.has(alias));
}
function getSubProductOptions(filter) {
  if (filter === 'gemelnet') {
    return [
      { type: 'gemel', label: 'קופת גמל' },
      { type: 'hishtalmut', label: 'קרן השתלמות' },
      { type: 'gemel-invest', label: 'גמל להשקעה' }
    ];
  }
  if (filter === 'bituach') {
    return [
      { type: 'manager-insurance', label: 'ביטוח מנהלים' },
      { type: 'savings-policy', label: 'פוליסות חיסכון' }
    ];
  }
  return [];
}

const COMPANY_OPTIONS = [
  { query: 'מנורה', label: 'מנורה מבטחים' },
  { query: 'הראל', label: 'הראל' },
  { query: 'הפניקס', label: 'הפניקס' },
  { query: 'כלל', label: 'כלל' },
  { query: 'מגדל', label: 'מגדל' },
  { query: 'מיטב', label: 'מיטב' },
  { query: 'מור', label: 'מור' },
  { query: 'אלטשולר', label: 'אלטשולר שחם' }
];

function recMatchesCurrentProductScope(rec) {
  const filter = selectedProductFilter || activeFilter || 'all';
  if (filter !== 'all' && rec.source !== filter) return false;
  if (selectedSubProductType && !recMatchesSubProduct(rec, selectedSubProductType)) return false;
  if (!rec.is_active || (Number(rec.total_assets) || 0) <= 0) return false;
  return true;
}

function getCompanyAssetsForCurrentScope() {
  return COMPANY_OPTIONS.map(company => {
    let totalAssets = 0;
    let count = 0;
    for (const rec of DATA) {
      if (!recMatchesCurrentProductScope(rec)) continue;
      if (!recMatchesSelectedCompany(rec, company.query)) continue;
      totalAssets += Number(rec.total_assets) || 0;
      count += 1;
    }
    return { ...company, totalAssets, count };
  })
  .filter(company => company.count > 0 && company.totalAssets > 0)
  .sort((a, b) => {
    if (b.totalAssets !== a.totalAssets) return b.totalAssets - a.totalAssets;
    return a.label.localeCompare(b.label, 'he');
  });
}

function handleCompanySelection(btn) {
  const query = btn.dataset.query || '';
  const isAlreadySelected = btn.classList.contains('is-selected') && selectedCompanyQuery === query;

  if (isAlreadySelected) {
    selectedCompanyQuery = '';
    btn.classList.remove('is-selected');
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    resetSearchResultsOnly();
    return;
  }

  selectedCompanyQuery = query;
  document.querySelectorAll('.company-btn').forEach(b => b.classList.remove('is-selected'));
  btn.classList.add('is-selected');

  const input = document.getElementById('searchInput');
  if (input) input.value = query;
  currentInsideResultsQuery = '';
  resultVisibleLimit = 5;

  showResults(query);
  const resultsWrap = document.getElementById('searchResults');
  if (resultsWrap && resultsWrap.scrollIntoView) {
    resultsWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const insideInput = document.getElementById('insideResultsInput');
  if (insideInput) setTimeout(() => insideInput.focus(), 120);
}

function attachCompanyButtonEvents() {
  document.querySelectorAll('.company-btn').forEach(btn => {
    btn.addEventListener('click', () => handleCompanySelection(btn));
  });
}

function searchFunds(query, limit = Infinity, filterOverride = activeFilter, allowEmptyAll = false) {
  const q = normalizeText(query);
  const qCompact = compactText(query);
  LAST_SEARCH_TOTAL = 0;
  const filter = filterOverride || 'all';
  if (!q && filter === 'all' && !allowEmptyAll) return [];
  const scored = [];
  for (const rec of DATA) {
    if (filter !== 'all' && rec.source !== filter) continue;
    if (selectedSubProductType && !recMatchesSubProduct(rec, selectedSubProductType)) continue;

    const isCompanyChoiceSearch = selectedCompanyQuery && q === normalizeText(selectedCompanyQuery) && filter !== 'all';
    if (isCompanyChoiceSearch && !recMatchesSelectedCompany(rec, selectedCompanyQuery)) continue;

    // בגרסת הדשבורד מציגים רק מוצרים פעילים עם נכסים, כדי שלא ייכנסו חישובי חשיפה ריקים.
    if (!rec.is_active || (Number(rec.total_assets) || 0) <= 0) continue;

    const name = normalizeText(rec.fund_name);
    const mgr = normalizeText(rec.managing_corp + ' ' + rec.parent_company_name + ' ' + rec.controlling_corp);
    const cls = normalizeText(rec.classification + ' ' + rec.specialization + ' ' + rec.sub_specialization);
    const idText = normalizeText(rec.fund_id);
    const fullText = `${name} ${mgr} ${cls} ${idText}`;
    const fullCompact = compactText(fullText);

    let score = 0;
    if (!q) {
      score = 1;
    } else {
      if (name === q) score += 30;
      else if (name.startsWith(q)) score += 18;
      else if (name.includes(q)) score += 12;

      if (mgr === q) score += 35;
      else if (mgr.startsWith(q)) score += 22;
      else if (mgr.includes(q)) score += 16;
      if (cls.includes(q)) score += 4;
      if (idText === q) score += 25;

      // מאפשר חיפוש גם כאשר המשתמש מקליד S&P500 / SP500 / אס אנד פי בצורה לא זהה לשם במאגר.
      if (qCompact && fullCompact.includes(qCompact)) score += 10;

      const parts = q.split(' ').filter(Boolean);
      if (parts.length > 1 && parts.every(p => fullText.includes(p) || fullCompact.includes(compactText(p)))) score += 8;

      if (score === 0) continue;
    }
    scored.push({ rec, score, total: Number(rec.total_assets) || 0 });
  }

  const sourceRank = { gemelnet: 1, pensia: 2, bituach: 3 };
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const sr = (sourceRank[a.rec.source] || 9) - (sourceRank[b.rec.source] || 9);
    if (sr !== 0) return sr;
    const ma = normalizeText(a.rec.managing_corp || a.rec.parent_company_name || a.rec.controlling_corp || '');
    const mb = normalizeText(b.rec.managing_corp || b.rec.parent_company_name || b.rec.controlling_corp || '');
    if (ma !== mb) return ma.localeCompare(mb, 'he');
    const ca = normalizeText(a.rec.classification || a.rec.specialization || '');
    const cb = normalizeText(b.rec.classification || b.rec.specialization || '');
    if (ca !== cb) return ca.localeCompare(cb, 'he');
    return normalizeText(a.rec.fund_name).localeCompare(normalizeText(b.rec.fund_name), 'he');
  });
  LAST_SEARCH_TOTAL = scored.length;
  return scored.slice(0, Number.isFinite(limit) ? limit : scored.length).map(x => withRuntimeFlags(x.rec));
}

function normalizeUserFee(value) {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}
function fmtUserFee(value) {
  return Number.isFinite(value) ? value.toFixed(2) + '%' : 'לא הוזן';
}
function saveState() {
  const minimal = userFunds.map(item => ({
    uid: item.fund.uid,
    fund_name: item.fund.fund_name || '',
    balance: item.balance || 0,
    management_fee: Number.isFinite(item.managementFee) ? item.managementFee : null,
    updated_at: item.updated_at || new Date().toISOString()
  }));
  // קופות שנעלמו מהמאגר נשמרות כפי שהן, כדי שהיתרה שהוזנה לא תימחק בשקט.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal.concat(missingSavedFunds)));
}
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    userFunds = [];
    missingSavedFunds = [];
    for (const item of saved) {
      const rec = DATA.find(r => r.uid === item.uid);
      if (rec) userFunds.push({
        fund: withRuntimeFlags(rec),
        balance: Number(item.balance) || 0,
        managementFee: normalizeUserFee(item.management_fee),
        updated_at: item.updated_at
      });
      else if (item.uid) missingSavedFunds.push(item);
    }
  } catch (e) {
    userFunds = [];
    missingSavedFunds = [];
  }
}

function describeMissingFund(item) {
  if (item.fund_name) return item.fund_name;
  const [source, fundId] = String(item.uid).split(':');
  const label = SOURCE_LABEL[source] || source || '';
  return `קופה מספר ${fundId || item.uid}${label ? ' (' + label + ')' : ''}`;
}
function renderMissingFunds() {
  const section = document.getElementById('missingFundsSection');
  const list = document.getElementById('missingFundsList');
  if (!section || !list) return;
  if (!missingSavedFunds.length) {
    section.hidden = true;
    list.innerHTML = '';
    return;
  }
  list.innerHTML = missingSavedFunds.map(item => `
    <div class="missing-fund-item">
      <div>
        <div class="missing-fund-name">${escapeHtml(describeMissingFund(item))}</div>
        <div class="missing-fund-meta">יתרה שהוזנה: ${fmtCurrency(Number(item.balance) || 0)} • דמי ניהול: ${fmtUserFee(normalizeUserFee(item.management_fee))}</div>
      </div>
      <button type="button" class="missing-fund-remove" onclick="removeMissingFund('${escapeHtml(item.uid)}')">הסר</button>
    </div>
  `).join('');
  section.hidden = false;
}
function removeMissingFund(uid) {
  missingSavedFunds = missingSavedFunds.filter(item => item.uid !== uid);
  saveState();
  renderMissingFunds();
}
window.removeMissingFund = removeMissingFund;

function renderDatasetMeta() {
  const el = document.getElementById('dataUpdateMeta');
  if (el) {
    el.textContent = `תאריך עדכון נתוני המאגר: ${fmtPeriod(DATASET_MAX_PERIOD)}`;
  }
  const perfPeriod = document.getElementById('perfReportPeriod');
  if (perfPeriod) {
    perfPeriod.textContent = `נתוני התשואה מוצגים לפי הדיווח האחרון הזמין במאגר: ${fmtPeriodHebrew(DATASET_MAX_PERIOD)}`;
  }
}

function renderFunds() {
  const section = document.getElementById('portfolioSection');
  const wrap = document.getElementById('fundsList');
  if (section) section.style.display = 'none';
  if (wrap) wrap.innerHTML = '';
  QUICK_RETURN_VISIBLE = false;
  updateFloatingSearchButton();
  renderDashboard();
}

function weightedMetric(key, totalBalance) {
  let covered = 0;
  let sum = 0;
  for (const item of userFunds) {
    const balance = Number(item.balance) || 0;
    const value = Number(item.fund[key]);
    if (balance > 0 && Number.isFinite(value)) {
      covered += balance;
      sum += balance * value;
    }
  }
  return covered > 0 ? sum / covered : null;
}
function weightedUserManagementFee(totalBalance) {
  let sum = 0;
  let covered = 0;
  for (const item of userFunds) {
    const balance = Number(item.balance) || 0;
    if (balance <= 0) continue;
    if (!Number.isFinite(item.managementFee)) return null;
    covered += balance;
    sum += balance * item.managementFee;
  }
  return covered > 0 ? sum / covered : null;
}
function setFeeMetric(value) {
  const el = document.getElementById('feeSavings');
  const pct = document.getElementById('feeSavingsPct');
  if (Number.isFinite(value)) {
    el.textContent = value.toFixed(2);
    if (pct) pct.style.display = '';
  } else {
    el.textContent = 'לא הוזן';
    if (pct) pct.style.display = 'none';
  }
  el.className = '';
}
function setMetric(id, value, digits = 1) {
  const el = document.getElementById(id);
  el.textContent = Number.isFinite(value) ? value.toFixed(digits) : '-';
  el.className = metricClass(value);
}

function renderDashboard() {
  const activeItems = userFunds.filter(item => (Number(item.balance) || 0) > 0);
  const totalBalance = activeItems.reduce((sum, item) => sum + (Number(item.balance) || 0), 0);
  if (totalBalance <= 0) {
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('detailsSection').style.display = 'none';
    const historySection = document.getElementById('historySection');
    if (historySection) historySection.style.display = 'none';
    const bottomActions = document.getElementById('bottomActions');
    if (bottomActions) bottomActions.style.display = 'none';
    const simulationTabSection = document.getElementById('simulationTabSection');
    if (simulationTabSection) simulationTabSection.style.display = 'none';
    return;
  }

  const aggStock = weightedMetric('stock_pct', totalBalance);
  const aggForeign = weightedMetric('foreign_pct', totalBalance);
  const aggFx = weightedMetric('fx_pct', totalBalance);
  const aggLiquid = weightedMetric('liquid_pct', totalBalance);
  const perfMonth = weightedMetric('monthly_yield', totalBalance);
  const perfYtd = weightedMetric('ytd_yield', totalBalance);
  const perf3y = weightedMetric('yield_trailing_3yrs', totalBalance);
  const feeSavings = weightedUserManagementFee(totalBalance);

  document.getElementById('totalBalance').textContent = fmtCurrency(totalBalance);
  setMetric('aggStock', aggStock, 1);
  setMetric('aggForeign', aggForeign, 1);
  setMetric('aggFx', aggFx, 1);
  setMetric('aggLiquid', aggLiquid, 1);
  setMetric('perfMonth', perfMonth, 2);
  setMetric('perfYtd', perfYtd, 2);
  setMetric('perf3y', perf3y, 2);
  setFeeMetric(feeSavings);

  const barPairs = [
    ['aggStockBar', aggStock],
    ['aggForeignBar', aggForeign],
    ['aggFxBar', aggFx],
    ['aggLiquidBar', aggLiquid],
  ];
  for (const [id, value] of barPairs) {
    document.getElementById(id).style.width = Math.max(0, Math.min(100, Number(value) || 0)) + '%';
  }

  const sourceTotals = {};
  for (const item of activeItems) {
    const src = item.fund.source;
    sourceTotals[src] = (sourceTotals[src] || 0) + (Number(item.balance) || 0);
  }
  document.getElementById('sourceMix').innerHTML = Object.entries(sourceTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([src, val]) => `<div class="source-mix-item"><span class="dot" style="background:${SOURCE_DOT_COLOR[src]}"></span>${SOURCE_LABEL[src]}: ${(val / totalBalance * 100).toFixed(0)}%</div>`)
    .join('');

  const rows = activeItems
    .slice()
    .sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0))
    .map(item => {
      const f = item.fund;
      const balance = Number(item.balance) || 0;
      const weight = balance / totalBalance * 100;
      return `
        <tr>
          <td><span class="source-tag ${escapeHtml(f.source)}">${SOURCE_LABEL[f.source]}</span> ${escapeHtml(f.fund_name)}</td>
          <td class="num">${weight.toFixed(1)}%</td>
          <td class="num">${fmtPct(f.stock_pct, 1)}</td>
          <td class="num">${fmtPct(f.foreign_pct, 1)}</td>
          <td class="num">${fmtPct(f.fx_pct, 1)}</td>
          <td class="num">${fmtPct(f.liquid_pct, 1)}</td>
          <td class="num ${metricClass(f.monthly_yield)}">${fmtPct(f.monthly_yield, 2)}</td>
          <td class="num ${metricClass(f.ytd_yield)}">${fmtPct(f.ytd_yield, 2)}</td>
          <td class="num ${metricClass(f.yield_trailing_3yrs)}">${fmtPct(f.yield_trailing_3yrs, 2)}</td>
          <td class="num">${fmtUserFee(item.managementFee)}</td>
        </tr>
      `;
    }).join('');
  document.getElementById('detailsRows').innerHTML = rows;
  document.getElementById('dashboard').style.display = 'block';
  document.getElementById('detailsSection').style.display = 'block';
  renderHistorySection(activeItems);
  // v3.87: when the dashboard is shown, all dashboard accordion tabs start closed by default
  const perfToggle = document.querySelector('.perf-toggle-section');
  const detailsToggle = document.querySelector('.details-toggle-section');
  const simulationToggle = document.getElementById('simulationDetails');
  [perfToggle, detailsToggle, simulationToggle].forEach(section => {
    if (section) section.open = false;
  });
  const simulationResults = document.getElementById('simResults');
  if (simulationResults) simulationResults.hidden = true;
  const simulationTabSection = document.getElementById('simulationTabSection');
  if (simulationTabSection) simulationTabSection.style.display = 'block';
  const bottomActions = document.getElementById('bottomActions');
  if (bottomActions) bottomActions.style.display = 'block';
  refreshSimulationDefaults();
}

const SIM_RAW_YIELDS = {
  low:    [22.66, 6.42, 13.62, 15.60, 0.18, 9.39, 1.67, 5.01, 6.11, 5.12, 3.33, 5.27, 8.12, -0.30, -0.37, 7.07, 10.05, 5.98, 0.61, 9.16, 1.05, 2.83, 6.99, -0.06, 13.25, 10.47, 3.05, -13.89, 8.60, 5.03],
  medium: [30.82, 14.37, 23.60, 22.47, 9.89, 0.71, -4.99, -7.81, 17.20, 8.09, 4.06, 10.29, 6.78, -14.72, 11.58, 11.81, 6.85, 10.61, 15.11, 11.89, 1.21, 7.30, 14.10, -2.55, 22.29, 14.80, 15.54, -16.96, 17.26, 14.61],
  high:   [35.83, 20.56, 30.78, 27.00, 17.98, -6.46, -10.11, -18.26, 25.56, 10.11, 4.63, 14.24, 5.95, -30.89, 22.23, 14.18, 3.49, 14.60, 28.03, 13.24, 1.37, 10.66, 19.73, -3.81, 29.05, 17.35, 25.18, -18.02, 23.84, 22.23]
};
const SIM_RISK_LABELS = { low: 'סיכון נמוך', medium: 'סיכון בינוני', high: 'סיכון גבוה' };

function getSimulationRiskTrack(stockPct) {
  const pct = Number(stockPct) || 0;
  if (pct <= 10) return 'low';
  if (pct <= 70) return 'medium';
  return 'high';
}
function fmtSimCurrency(value) {
  return Math.round(Number(value) || 0).toLocaleString('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
}
function refreshSimulationDefaults() {
  const totalBalance = getTotalBalance();
  const stockPct = weightedMetric('stock_pct', totalBalance);
  const fee = weightedUserManagementFee(totalBalance);
  const track = getSimulationRiskTrack(stockPct);

  const initialEl = document.getElementById('simInitialDisplay');
  const stockEl = document.getElementById('simStockDisplay');
  const riskEl = document.getElementById('simRiskDisplay');
  const feeDisplayEl = document.getElementById('simFeeDisplay');
  const feeInput = document.getElementById('simFeeInput');

  if (initialEl) initialEl.textContent = totalBalance > 0 ? fmtSimCurrency(totalBalance) : '-';
  if (stockEl) stockEl.textContent = Number.isFinite(stockPct) ? stockPct.toFixed(1) + '%' : '-';
  if (riskEl) riskEl.textContent = totalBalance > 0 ? SIM_RISK_LABELS[track] : '-';
  if (feeDisplayEl) feeDisplayEl.textContent = Number.isFinite(fee) ? fee.toFixed(2) + '%' : 'לא הוזן';
  if (feeInput && !feeInput.dataset.userEdited && Number.isFinite(fee)) feeInput.value = fee.toFixed(2);
}
function runHistoricalSimulation() {
  const totalBalance = getTotalBalance();
  if (totalBalance <= 0) return;

  const stockPct = weightedMetric('stock_pct', totalBalance);
  const track = getSimulationRiskTrack(stockPct);
  const yields = SIM_RAW_YIELDS[track];
  const monthly = Math.max(0, Number(document.getElementById('simMonthlyInput')?.value) || 0);
  const yearsInput = Number(document.getElementById('simYearsInput')?.value) || 10;
  const years = Math.max(1, Math.min(30, Math.round(yearsInput)));
  const feeInput = document.getElementById('simFeeInput');
  const feePct = Math.max(0, Number(feeInput?.value) || 0);
  if (feeInput) feeInput.value = feePct ? feePct.toFixed(2) : '';

  // יתרה קיימת היא הון התחלתי בלבד, לא הפקדה נוספת.
  // לכן סך ההפקדות שמוצג בתוצאות כולל רק הפקדות עתידיות שהמשתמש הזין.
  let amount = totalBalance;
  let futureContributions = 0;
  const monthlyFee = (feePct / 100) / 12;

  for (let y = 0; y < years; y++) {
    const annualYield = (yields[y % yields.length] || 0) / 100;
    const monthlyYield = annualYield / 12;
    for (let m = 0; m < 12; m++) {
      amount += amount * monthlyYield;
      amount -= amount * monthlyFee;
      if (monthly > 0) {
        amount += monthly;
        futureContributions += monthly;
      }
    }
  }

  const gain = amount - totalBalance - futureContributions;
  const finalEl = document.getElementById('simFinalAmount');
  const contribEl = document.getElementById('simTotalContrib');
  const gainEl = document.getElementById('simGainAmount');
  const resultsEl = document.getElementById('simResults');

  if (finalEl) finalEl.textContent = fmtSimCurrency(amount);
  if (contribEl) contribEl.textContent = fmtSimCurrency(futureContributions);
  if (gainEl) {
    gainEl.textContent = fmtSimCurrency(gain);
    gainEl.classList.toggle('sim-positive', gain >= 0);
    gainEl.classList.toggle('sim-negative', gain < 0);
  }
  if (resultsEl) resultsEl.hidden = false;
}
function initSimulationCalculator() {
  const runBtn = document.getElementById('simRunBtn');
  if (runBtn && !runBtn.dataset.bound) {
    runBtn.addEventListener('click', runHistoricalSimulation);
    runBtn.dataset.bound = '1';
  }
  const feeInput = document.getElementById('simFeeInput');
  if (feeInput && !feeInput.dataset.bound) {
    feeInput.addEventListener('input', () => { feeInput.dataset.userEdited = '1'; });
    feeInput.dataset.bound = '1';
  }
  const details = document.getElementById('simulationDetails');
  if (details && !details.dataset.bound) {
    details.addEventListener('toggle', () => { if (details.open) refreshSimulationDefaults(); });
    details.dataset.bound = '1';
  }
  refreshSimulationDefaults();
}



/* === מגמה חודשית של התיק — גרפים מתוך היסטוריית המאגר === */

const CHART_COLORS = { pos: '#102743', neg: '#c53637', line: '#102743', spark: '#8d949e' };

/* המדדים הזמינים לגרפי המגמה. הצבעים תואמים את צבעי הישויות בדשבורד
   ועברו בדיקת ניגודיות מול המשטח. */
const HIST_METRICS = [
  { id: 'yield', field: 'hist_yield', label: 'תשואה חודשית משוקללת', type: 'column', color: null, digits: 2 },
  { id: 'stock', field: 'hist_stock', label: 'חשיפה למניות של התיק', type: 'line', color: '#102743', digits: 1 },
  { id: 'foreign', field: 'hist_foreign', label: 'חשיפה לחו״ל', type: 'line', color: '#dcaf61', digits: 1 },
  { id: 'fx', field: 'hist_fx', label: 'חשיפה למט״ח', type: 'line', color: '#7488a1', digits: 1 },
  { id: 'liquid', field: 'hist_liquid', label: 'נכסים סחירים', type: 'line', color: '#8a6b1f', digits: 1 },
];
const HIST_DEFAULT_SELECTED = ['yield', 'stock'];
const HIST_PREFS_KEY = 'pension_dashboard_hist_charts_v1';

function loadHistSelection() {
  try {
    const saved = JSON.parse(localStorage.getItem(HIST_PREFS_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) {
      return saved.filter(id => HIST_METRICS.some(m => m.id === id));
    }
  } catch (e) { /* בחירה פגומה — חוזרים לברירת המחדל */ }
  return HIST_DEFAULT_SELECTED.slice();
}
function saveHistSelection(ids) {
  localStorage.setItem(HIST_PREFS_KEY, JSON.stringify(ids));
}

function periodAddJs(period, months) {
  const idx = Math.floor(period / 100) * 12 + (period % 100 - 1) + months;
  return Math.floor(idx / 12) * 100 + (idx % 12) + 1;
}
function fmtShortPeriod(period) {
  const s = String(period);
  return s.slice(4, 6) + '/' + s.slice(2, 4);
}

function computePortfolioHistory(activeItems) {
  const acc = {};
  for (const item of activeItems) {
    const f = item.fund;
    const balance = Number(item.balance) || 0;
    if (!f.hist_start || balance <= 0) continue;
    const length = Math.max(...HIST_METRICS.map(m => Array.isArray(f[m.field]) ? f[m.field].length : 0));
    for (let i = 0; i < length; i++) {
      const period = periodAddJs(f.hist_start, i);
      const a = acc[period] || (acc[period] = {});
      for (const m of HIST_METRICS) {
        const v = Array.isArray(f[m.field]) ? f[m.field][i] : null;
        if (!Number.isFinite(v)) continue;
        const s = a[m.id] || (a[m.id] = { sum: 0, weight: 0 });
        s.sum += balance * v;
        s.weight += balance;
      }
    }
  }
  return Object.keys(acc).map(Number).sort((a, b) => a - b).map(p => {
    const values = {};
    for (const m of HIST_METRICS) {
      const s = acc[p][m.id];
      values[m.id] = s && s.weight > 0 ? s.sum / s.weight : null;
    }
    return { period: p, values };
  });
}

function chartTooltipEl() {
  let el = document.getElementById('chartTooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chartTooltip';
    el.className = 'chart-tooltip';
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}
function showChartTooltip(x, y, valueText, labelText) {
  const el = chartTooltipEl();
  el.textContent = '';
  const v = document.createElement('span');
  v.className = 'tooltip-value';
  v.textContent = valueText;
  el.appendChild(v);
  el.appendChild(document.createTextNode(labelText));
  el.hidden = false;
  const pad = 14;
  const rect = el.getBoundingClientRect();
  let left = x + pad;
  if (left + rect.width > window.innerWidth - 8) left = x - rect.width - pad;
  let top = y - rect.height - pad;
  if (top < 8) top = y + pad;
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}
function hideChartTooltip() {
  const el = document.getElementById('chartTooltip');
  if (el) el.hidden = true;
}

function niceTicks(minV, maxV, targetCount, includeZero) {
  const lo = includeZero ? Math.min(0, minV) : minV;
  const hi = includeZero ? Math.max(0, maxV) : maxV;
  const span = (hi - lo) || 1;
  const rawStep = span / (targetCount || 3);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  let step = mag * 10;
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (rawStep <= m * mag) { step = m * mag; break; }
  }
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let t = start; t <= end + step * 0.001; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return ticks;
}

/* עמודות סביב ציר אפס: תשואה חודשית. הסימן מקודד גם במיקום וגם בצבע. */
function renderColumnChart(container, points, fmtValue, ariaLabel) {
  if (!container) return;
  const W = 560, H = 230, mL = 44, mR = 12, mT = 20, mB = 28;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const values = points.map(p => p.value).filter(Number.isFinite);
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 3, true);
  const lo = Math.min(...ticks), hi = Math.max(...ticks);
  const yOf = v => mT + (hi - v) / (hi - lo || 1) * plotH;
  const band = plotW / points.length;
  const barW = Math.min(24, Math.max(6, band - Math.max(2, band * 0.35)));
  const zeroY = yOf(0);
  const maxV = Math.max(...values), minV = Math.min(...values);

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(ariaLabel || 'גרף עמודות')}">`;
  for (const t of ticks) {
    s += `<line class="grid-line" x1="${mL}" x2="${W - mR}" y1="${yOf(t)}" y2="${yOf(t)}"></line>`;
    s += `<text class="axis-text" x="${mL - 6}" y="${yOf(t) + 3.5}" text-anchor="end">${t}%</text>`;
  }
  s += `<line class="zero-line" x1="${mL}" x2="${W - mR}" y1="${zeroY}" y2="${zeroY}"></line>`;

  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  points.forEach((p, i) => {
    const cx = mL + band * i + band / 2;
    if (i % labelEvery === 0 || i === points.length - 1) {
      s += `<text class="axis-text" x="${cx}" y="${H - 8}" text-anchor="middle">${escapeHtml(p.label)}</text>`;
    }
    if (!Number.isFinite(p.value)) return;
    const x = cx - barW / 2;
    const yTop = Math.min(zeroY, yOf(p.value));
    const h = Math.max(1.5, Math.abs(yOf(p.value) - zeroY));
    const r = Math.min(4, h);
    const color = p.value >= 0 ? CHART_COLORS.pos : CHART_COLORS.neg;
    // קצה מעוגל בצד הנתון, ישר בצד ציר האפס
    const path = p.value >= 0
      ? `M${x},${yTop + h} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${yTop + h} Z`
      : `M${x},${yTop} V${yTop + h - r} Q${x},${yTop + h} ${x + r},${yTop + h} H${x + barW - r} Q${x + barW},${yTop + h} ${x + barW},${yTop + h - r} V${yTop} Z`;
    const valText = fmtValue(p.value);
    s += `<g><rect class="hit-target" data-idx="${i}" tabindex="0" role="img" aria-label="${escapeHtml(p.tooltip + ': ' + valText)}" x="${mL + band * i}" y="${mT}" width="${band}" height="${plotH}"></rect>`;
    s += `<path class="bar-mark" d="${path}" fill="${color}" pointer-events="none"></path></g>`;
    // תווית ערך רק על הקיצונים — לא מספר על כל עמודה
    if (p.value === maxV || p.value === minV) {
      const ly = p.value >= 0 ? yTop - 5 : yTop + h + 12;
      s += `<text class="value-label" x="${cx}" y="${ly}" text-anchor="middle">${escapeHtml(valText)}</text>`;
    }
  });
  s += '</svg>';
  container.innerHTML = s;

  container.querySelectorAll('.hit-target').forEach(rect => {
    const p = points[Number(rect.dataset.idx)];
    const valText = fmtValue(p.value);
    rect.addEventListener('pointermove', e => { rect.classList.add('is-hover'); showChartTooltip(e.clientX, e.clientY, valText, p.tooltip); });
    rect.addEventListener('pointerleave', () => { rect.classList.remove('is-hover'); hideChartTooltip(); });
    rect.addEventListener('focus', () => { const b = rect.getBoundingClientRect(); showChartTooltip(b.left + b.width / 2, b.top + b.height / 3, valText, p.tooltip); });
    rect.addEventListener('blur', hideChartTooltip);
  });
}

/* קו יחיד למדד אחד לאורך זמן. */
function renderLineChart(container, points, fmtValue, ariaLabel, color) {
  if (!container) return;
  const lineColor = color || CHART_COLORS.line;
  const W = 560, H = 230, mL = 44, mR = 46, mT = 20, mB = 28;
  const plotW = W - mL - mR, plotH = H - mT - mB;
  const finite = points.filter(p => Number.isFinite(p.value));
  if (finite.length < 2) { container.innerHTML = '<div class="perf-note">אין עדיין מספיק חודשים להצגת מגמה.</div>'; return; }
  const vals = finite.map(p => p.value);
  let loV = Math.min(...vals), hiV = Math.max(...vals);
  const padV = Math.max((hiV - loV) * 0.25, 1);
  loV = Math.max(0, loV - padV); hiV = hiV + padV;
  const ticks = niceTicks(loV, hiV, 3, false).filter(t => t >= 0);
  const lo = Math.min(...ticks), hi = Math.max(...ticks);
  const yOf = v => mT + (hi - v) / (hi - lo || 1) * plotH;
  const xOf = i => points.length === 1 ? mL + plotW / 2 : mL + plotW * i / (points.length - 1);

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(ariaLabel || 'גרף קו')}">`;
  for (const t of ticks) {
    s += `<line class="grid-line" x1="${mL}" x2="${W - mR}" y1="${yOf(t)}" y2="${yOf(t)}"></line>`;
    s += `<text class="axis-text" x="${mL - 6}" y="${yOf(t) + 3.5}" text-anchor="end">${t}%</text>`;
  }
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  points.forEach((p, i) => {
    if (i % labelEvery === 0 || i === points.length - 1) {
      s += `<text class="axis-text" x="${xOf(i)}" y="${H - 8}" text-anchor="middle">${escapeHtml(p.label)}</text>`;
    }
  });
  const coords = [];
  points.forEach((p, i) => { if (Number.isFinite(p.value)) coords.push([xOf(i), yOf(p.value), i]); });
  const lineD = coords.map((c, j) => (j ? 'L' : 'M') + c[0] + ',' + c[1]).join(' ');
  const areaD = lineD + ` L${coords[coords.length - 1][0]},${yOf(lo)} L${coords[0][0]},${yOf(lo)} Z`;
  s += `<path d="${areaD}" fill="${lineColor}" opacity="0.1"></path>`;
  s += `<path d="${lineD}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>`;
  s += `<line class="crosshair line-crosshair" x1="0" x2="0" y1="${mT}" y2="${mT + plotH}" visibility="hidden"></line>`;
  const last = coords[coords.length - 1];
  s += `<circle cx="${last[0]}" cy="${last[1]}" r="6.5" fill="var(--card, #fff)"></circle>`;
  s += `<circle cx="${last[0]}" cy="${last[1]}" r="4.5" fill="${lineColor}"></circle>`;
  s += `<text class="value-label" x="${last[0] + 9}" y="${last[1] + 4}" text-anchor="start">${escapeHtml(fmtValue(last ? points[last[2]].value : null))}</text>`;
  s += `<circle class="line-hover-dot" r="4.5" fill="${lineColor}" stroke="var(--card, #fff)" stroke-width="2" visibility="hidden"></circle>`;
  s += `<rect class="line-overlay" x="${mL}" y="${mT}" width="${plotW}" height="${plotH}" fill="transparent"></rect>`;
  // נקודות מיקוד למקלדת
  coords.forEach(c => {
    const p = points[c[2]];
    s += `<circle class="hit-target" data-idx="${c[2]}" data-cx="${c[0]}" data-cy="${c[1]}" tabindex="0" role="img" aria-label="${escapeHtml(p.tooltip + ': ' + fmtValue(p.value))}" cx="${c[0]}" cy="${c[1]}" r="12"></circle>`;
  });
  s += '</svg>';
  container.innerHTML = s;

  const svg = container.querySelector('svg');
  const crosshair = container.querySelector('.line-crosshair');
  const hoverDot = container.querySelector('.line-hover-dot');
  const overlay = container.querySelector('.line-overlay');
  const showAt = (idx, clientX, clientY) => {
    const c = coords.find(cc => cc[2] === idx);
    if (!c) return;
    crosshair.setAttribute('x1', c[0]); crosshair.setAttribute('x2', c[0]);
    crosshair.setAttribute('visibility', 'visible');
    hoverDot.setAttribute('cx', c[0]); hoverDot.setAttribute('cy', c[1]);
    hoverDot.setAttribute('visibility', 'visible');
    const p = points[idx];
    showChartTooltip(clientX, clientY, fmtValue(p.value), p.tooltip);
  };
  const hideHover = () => {
    crosshair.setAttribute('visibility', 'hidden');
    hoverDot.setAttribute('visibility', 'hidden');
    hideChartTooltip();
  };
  overlay.addEventListener('pointermove', e => {
    const box = svg.getBoundingClientRect();
    const sx = (e.clientX - box.left) / box.width * W;
    let best = coords[0];
    for (const c of coords) if (Math.abs(c[0] - sx) < Math.abs(best[0] - sx)) best = c;
    showAt(best[2], e.clientX, e.clientY);
  });
  overlay.addEventListener('pointerleave', hideHover);
  container.querySelectorAll('.hit-target').forEach(dot => {
    dot.addEventListener('focus', () => {
      const b = dot.getBoundingClientRect();
      showAt(Number(dot.dataset.idx), b.left + b.width / 2, b.top);
    });
    dot.addEventListener('blur', hideHover);
  });
}

function renderHistorySection(activeItems) {
  const section = document.getElementById('historySection');
  if (!section) return;
  const hist = computePortfolioHistory(activeItems);
  const monthName = typeof fmtPeriodHebrew === 'function' ? fmtPeriodHebrew : fmtPeriod;
  const fmtOf = m => (v => Number.isFinite(v) ? v.toFixed(m.digits) + '%' : '-');

  // מדד זמין רק כשיש לו לפחות שני חודשים עם ערך
  const available = HIST_METRICS.filter(m => hist.filter(h => Number.isFinite(h.values[m.id])).length >= 2);
  if (!available.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  let selected = loadHistSelection().filter(id => available.some(m => m.id === id));
  if (!selected.length) selected = [available[0].id];

  const options = document.getElementById('historyOptions');
  if (options) {
    options.innerHTML = '';
    for (const m of available) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'history-option-pill';
      btn.setAttribute('aria-pressed', String(selected.includes(m.id)));
      const dot = document.createElement('span');
      dot.className = 'pill-dot';
      dot.style.background = m.type === 'column' ? CHART_COLORS.pos : m.color;
      btn.appendChild(dot);
      btn.appendChild(document.createTextNode(m.label));
      btn.addEventListener('click', () => {
        const current = loadHistSelection();
        const next = current.includes(m.id) ? current.filter(id => id !== m.id) : current.concat(m.id);
        if (!next.length) return; // תמיד נשאר גרף אחד לפחות
        saveHistSelection(next);
        renderHistorySection(activeItems);
      });
      options.appendChild(btn);
    }
  }

  const grid = document.getElementById('historyGrid');
  if (grid) {
    grid.innerHTML = '';
    for (const m of HIST_METRICS) {
      if (!selected.includes(m.id) || !available.includes(m)) continue;
      const fig = document.createElement('figure');
      fig.className = 'history-card';
      const cap = document.createElement('figcaption');
      cap.className = 'history-title';
      cap.textContent = m.label;
      const chart = document.createElement('div');
      chart.className = 'history-chart';
      chart.dir = 'ltr';
      fig.appendChild(cap);
      fig.appendChild(chart);
      grid.appendChild(fig);
      const points = hist.map(h => ({ label: fmtShortPeriod(h.period), tooltip: monthName(h.period), value: h.values[m.id] }));
      if (m.type === 'column') {
        renderColumnChart(chart, points, fmtOf(m), 'גרף עמודות של ' + m.label);
      } else {
        renderLineChart(chart, points, fmtOf(m), 'גרף קו של ' + m.label + ' לאורך זמן', m.color);
      }
    }
  }

  const tbody = document.getElementById('historyTableRows');
  if (tbody) {
    tbody.innerHTML = hist.map(h => `
      <tr>
        <td>${escapeHtml(monthName(h.period))}</td>
        <td class="num ${metricClass(h.values.yield)}">${fmtOf(HIST_METRICS[0])(h.values.yield)}</td>
        <td class="num">${fmtOf(HIST_METRICS[1])(h.values.stock)}</td>
        <td class="num">${fmtOf(HIST_METRICS[2])(h.values.foreign)}</td>
        <td class="num">${fmtOf(HIST_METRICS[3])(h.values.fx)}</td>
        <td class="num">${fmtOf(HIST_METRICS[4])(h.values.liquid)}</td>
      </tr>
    `).join('');
  }
}

/* ספארקליין קטן של תשואת הקופה בעורך המהיר */
function renderQuickSpark(container, fund) {
  if (!container || !fund || !fund.hist_start || !Array.isArray(fund.hist_yield)) return;
  const pts = fund.hist_yield.map((y, i) => ({ period: periodAddJs(fund.hist_start, i), value: y }))
    .filter(p => Number.isFinite(p.value));
  if (pts.length < 2) return;
  const W = 130, H = 34, m = 4;
  const vals = pts.map(p => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const yOf = v => m + (hi - v) / (hi - lo || 1) * (H - 2 * m);
  const xOf = i => m + (W - 2 * m) * i / (pts.length - 1);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + xOf(i).toFixed(1) + ',' + yOf(p.value).toFixed(1)).join(' ');
  const lx = xOf(pts.length - 1), ly = yOf(pts[pts.length - 1].value);
  container.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" dir="ltr" role="img" aria-label="תשואה חודשית, ${pts.length} חודשים אחרונים">
      <path d="${d}" fill="none" stroke="${CHART_COLORS.spark}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>
      <circle cx="${lx}" cy="${ly}" r="5" fill="var(--card, #fff)"></circle>
      <circle cx="${lx}" cy="${ly}" r="3.5" fill="${CHART_COLORS.line}"></circle>
    </svg>
    <span class="spark-caption">תשואה חודשית · ${pts.length} חודשים אחרונים</span>
  `;
}

function getTotalBalance() {
  return userFunds.reduce((sum, item) => sum + (Number(item.balance) || 0), 0);
}
function hasReportData() {
  return userFunds.length > 0 && getTotalBalance() > 0;
}
function buildShareText() {
  const totalBalance = getTotalBalance();
  const aggStock = weightedMetric('stock_pct', totalBalance);
  const aggForeign = weightedMetric('foreign_pct', totalBalance);
  const aggFx = weightedMetric('fx_pct', totalBalance);
  const aggLiquid = weightedMetric('liquid_pct', totalBalance);
  const perfYtd = weightedMetric('ytd_yield', totalBalance);
  const feeSavings = weightedUserManagementFee(totalBalance);
  const lines = [
    'דשבורד חשיפות חיסכון',
    `יתרה כוללת שהוזנה: ${fmtCurrency(totalBalance)}`,
    `חשיפה למניות: ${fmtPct(aggStock, 1)}`,
    `חשיפה לחו״ל: ${fmtPct(aggForeign, 1)}`,
    `חשיפה למט״ח: ${fmtPct(aggFx, 1)}`,
    `נכסים סחירים: ${fmtPct(aggLiquid, 1)}`,
    `תשואה מתחילת שנה לפי מסלולים, משוקללת: ${fmtPct(perfYtd, 2)}`,
    `תשואה 3 שנים מצטברת לפי מסלולים, משוקללת: ${fmtPct(weightedMetric('yield_trailing_3yrs', totalBalance), 2)}`,
    `דמי ניהול אישיים משוקללים: ${Number.isFinite(feeSavings) ? fmtPct(feeSavings, 2) : 'לא הוזן'}`,
    '',
    'פירוט מוצרים:'
  ];
  const sorted = userFunds.slice().sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0));
  for (const item of sorted) {
    const balance = Number(item.balance) || 0;
    if (balance <= 0) continue;
    const f = item.fund;
    const weight = totalBalance > 0 ? balance / totalBalance * 100 : 0;
    lines.push(`- ${SOURCE_LABEL[f.source]} | ${f.fund_name} | ${fmtCurrency(balance)} | משקל ${weight.toFixed(1)}% | מניות ${fmtPct(f.stock_pct, 1)} | חו״ל ${fmtPct(f.foreign_pct, 1)} | מט״ח ${fmtPct(f.fx_pct, 1)} | דמי ניהול ${fmtUserFee(item.managementFee)}`);
  }
  lines.push('');
  lines.push('הבהרה: הנתונים מבוססים על נתונים ציבוריים ויתרות שהוזנו ידנית. זה אינו ייעוץ או המלצה.');
  if (window.location && window.location.href) lines.push(`קישור לדשבורד: ${window.location.href}`);
  return lines.join('\n');
}
// Remembers which collapsible sections were open before printing, so the
// on-screen view can be restored exactly after the print dialog closes.
let PRINT_PREV_OPEN = null;
function preparePrintLayout() {
  // Expand every collapsible section so the printed report contains all the
  // information. Closed <details> are hidden by the browser via
  // content-visibility, which CSS overrides cannot reliably defeat, so we open
  // them explicitly here.
  const sections = document.querySelectorAll('.dashboard-toggle-section, .history-table-details');
  PRINT_PREV_OPEN = [];
  sections.forEach(section => {
    PRINT_PREV_OPEN.push([section, section.open]);
    section.open = true;
  });
  // Stamp the generation date into the print-only report header.
  const dateEl = document.getElementById('pdfGenDate');
  if (dateEl) {
    try {
      dateEl.textContent = new Date().toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) {
      dateEl.textContent = '';
    }
  }
}
function restorePrintLayout() {
  if (!PRINT_PREV_OPEN) return;
  PRINT_PREV_OPEN.forEach(([section, wasOpen]) => { section.open = wasOpen; });
  PRINT_PREV_OPEN = null;
}
function saveAsPDF() {
  if (!hasReportData()) {
    alert('כדי לשמור PDF צריך להוסיף לפחות מוצר אחד ולהזין יתרה.');
    return;
  }
  renderDashboard();

  // Mobile Safari and some in-app browsers generate the PDF from the currently
  // rendered page before fully applying @media print. Force a visible light
  // report mode first, then open the print dialog.
  document.body.classList.add('pdf-mode');
  preparePrintLayout();
  const dashboard = document.getElementById('dashboard');
  if (dashboard) dashboard.scrollIntoView({ behavior: 'auto', block: 'start' });

  window.setTimeout(() => {
    window.print();
    // Fallback: if afterprint does not fire on mobile, restore the screen later.
    window.setTimeout(() => { document.body.classList.remove('pdf-mode'); restorePrintLayout(); }, 3500);
  }, 650);
}
window.addEventListener('afterprint', () => {
  window.setTimeout(() => { document.body.classList.remove('pdf-mode'); restorePrintLayout(); }, 250);
});
async function shareWhatsApp() {
  if (!hasReportData()) {
    alert('כדי לשלוח לווטסאפ צריך להוסיף לפחות מוצר אחד ולהזין יתרה.');
    return;
  }
  const text = buildShareText();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'דשבורד חשיפות חיסכון', text });
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
    }
  }
  const url = 'https://wa.me/?text=' + encodeURIComponent(text);
  window.open(url, '_blank', 'noopener,noreferrer');
}
function goToDashboard() {
  if (!hasReportData()) {
    alert('כדי לעבור לדשבורד צריך להוסיף לפחות מוצר אחד ולהזין יתרה.');
    return;
  }
  renderDashboard();
  if (typeof window.enterDashboardView === 'function') {
    window.enterDashboardView();
  }
  const dashboard = document.getElementById('dashboard');
  if (dashboard) dashboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function resetAllData() {
  const hasData = userFunds.length > 0 || localStorage.getItem(STORAGE_KEY);
  if (!hasData) {
    prepareAnotherFund();
    return;
  }
  const ok = window.confirm('לאפס את כל הקופות, היתרות ודמי הניהול שהוזנו?');
  if (!ok) return;
  userFunds = [];
  missingSavedFunds = [];
  CURRENT_EDIT_FUND = null;
  LAST_FOCUSED_UID = null;
  QUICK_RETURN_VISIBLE = false;
  localStorage.removeItem(STORAGE_KEY);
  renderMissingFunds();
  const editor = document.getElementById('quickEditor');
  if (editor) {
    editor.classList.remove('active');
    editor.innerHTML = '';
  }
  const results = document.getElementById('searchResults');
  if (results) {
    results.classList.remove('active');
    results.innerHTML = '';
  }
  const input = document.getElementById('searchInput');
  if (input) input.value = '';
  renderDashboard();
  const section = document.getElementById('searchSection');
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => { if (input) input.focus({ preventScroll: true }); }, 350);
}
window.saveAsPDF = saveAsPDF;
window.shareWhatsApp = shareWhatsApp;
window.goToDashboard = goToDashboard;
window.resetAllData = resetAllData;

function findUserFundIndex(uid) {
  return userFunds.findIndex(item => item.fund && item.fund.uid === uid);
}
function openQuickEditor(fund) {
  CURRENT_EDIT_FUND = withRuntimeFlags(fund);
  const existingIndex = findUserFundIndex(CURRENT_EDIT_FUND.uid);
  const existing = existingIndex >= 0 ? userFunds[existingIndex] : null;
  const balanceValue = existing && Number(existing.balance) > 0 ? Number(existing.balance) : '';
  const feeValue = existing && Number.isFinite(existing.managementFee) ? existing.managementFee : '';
  const sub = [CURRENT_EDIT_FUND.managing_corp, CURRENT_EDIT_FUND.classification, CURRENT_EDIT_FUND.specialization, CURRENT_EDIT_FUND.sub_specialization].filter(Boolean).join(' • ');
  const editor = document.getElementById('quickEditor');
  if (!editor) return;
  editor.innerHTML = `
    <div class="quick-editor-card">
      <div class="quick-editor-title"><span class="source-tag ${escapeHtml(CURRENT_EDIT_FUND.source)}">${SOURCE_LABEL[CURRENT_EDIT_FUND.source]}</span>${escapeHtml(CURRENT_EDIT_FUND.fund_name)}</div>
      <div class="quick-editor-meta">${escapeHtml(sub || '-')} • מספר קופה: ${escapeHtml(CURRENT_EDIT_FUND.fund_id || '')}</div>
      <div class="quick-editor-spark" id="quickEditorSpark" dir="ltr"></div>
      <div class="quick-editor-form">
        <label class="field-group">
          <span class="field-label">יתרה</span>
          <span class="inline-input">
            <input type="number" class="balance-input" id="quickBalanceInput" value="${escapeHtml(balanceValue)}" placeholder="0" min="0" inputmode="numeric" />
            <span class="currency">₪</span>
          </span>
        </label>
        <label class="field-group">
          <span class="field-label">דמי ניהול מצבירה</span>
          <span class="inline-input">
            <input type="number" class="fee-input" id="quickFeeInput" value="${escapeHtml(feeValue)}" placeholder="לא הוזן" min="0" step="0.01" inputmode="decimal" />
            <span class="currency">%</span>
          </span>
        </label>
        <button type="button" class="update-dashboard-btn" onclick="commitQuickUpdate()">עדכן בדשבורד</button>
        ${existing ? '<button type="button" class="quick-remove-btn" onclick="removeCurrentQuickFund()">הסר מהדשבורד</button>' : ''}
      </div>
      <div class="quick-editor-message" id="quickEditorMessage"></div>
    </div>
  `;
  editor.classList.add('active');
  renderQuickSpark(document.getElementById('quickEditorSpark'), CURRENT_EDIT_FUND);
  editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => {
    const input = document.getElementById('quickBalanceInput');
    if (input) { input.focus({ preventScroll: true }); input.select(); }
  }, 120);
}
function commitQuickUpdate() {
  if (!CURRENT_EDIT_FUND) return;
  const balanceInput = document.getElementById('quickBalanceInput');
  const feeInput = document.getElementById('quickFeeInput');
  const balance = Math.max(0, Number(balanceInput ? balanceInput.value : 0) || 0);
  const fee = normalizeUserFee(feeInput ? feeInput.value : null);
  if (balance <= 0) {
    alert('יש להזין יתרה גבוהה מאפס כדי לעדכן את הדשבורד.');
    if (balanceInput) balanceInput.focus();
    return;
  }
  const idx = findUserFundIndex(CURRENT_EDIT_FUND.uid);
  const payload = {
    fund: CURRENT_EDIT_FUND,
    balance,
    managementFee: fee,
    updated_at: new Date().toISOString()
  };
  if (idx >= 0) userFunds[idx] = payload;
  else userFunds.push(payload);
  saveState();
  renderDashboard();
  const msg = document.getElementById('quickEditorMessage');
  if (msg) {
    msg.innerHTML = `
      <div>עודכן בדשבורד.</div>
      <div class="quick-action-row">
        <button type="button" class="add-another-btn" onclick="prepareAnotherFund()">הוסף קופה נוספת</button>
        <button type="button" class="go-dashboard-btn" onclick="goToDashboard()">עבור לדשבורד</button>
        <button type="button" class="reset-all-btn" onclick="resetAllData()">איפוס הכל</button>
      </div>
    `;
  }
  showResults(document.getElementById('searchInput').value || '');
  const wrap = document.getElementById('searchResults');
  if (wrap) wrap.classList.add('active');
  const input = document.getElementById('searchInput');
  if (input) input.focus({ preventScroll: true });
}
function removeCurrentQuickFund() {
  if (!CURRENT_EDIT_FUND) return;
  const idx = findUserFundIndex(CURRENT_EDIT_FUND.uid);
  if (idx >= 0) {
    userFunds.splice(idx, 1);
    saveState();
    renderDashboard();
    const msg = document.getElementById('quickEditorMessage');
    if (msg) msg.textContent = 'הוסר מהדשבורד.';
    showResults(document.getElementById('searchInput').value || '');
  }
}
function prepareAnotherFund() {
  CURRENT_EDIT_FUND = null;
  selectedCompanyQuery = '';

  const editor = document.getElementById('quickEditor');
  if (editor) {
    editor.classList.remove('active');
    editor.innerHTML = '';
  }

  const results = document.getElementById('searchResults');
  if (results) {
    results.classList.remove('active');
    results.innerHTML = '';
  }

  const productPanel = document.getElementById('productTypePanel');
  if (productPanel) productPanel.classList.add('active');

  const subProductPanel = document.getElementById('subProductPanel');
  const subProductGrid = document.getElementById('subProductGrid');
  if (subProductPanel) subProductPanel.style.display = 'none';
  if (subProductGrid) subProductGrid.innerHTML = '';

  const companyLabel = document.getElementById('companyGridLabel');
  const companyGrid = document.getElementById('companyGrid');
  if (companyLabel) companyLabel.style.display = 'none';
  if (companyGrid) companyGrid.style.display = 'none';

  selectedSubProductType = '';
  document.querySelectorAll('.company-btn').forEach(btn => btn.classList.remove('is-selected'));
  document.querySelectorAll('.product-type-btn').forEach(btn => btn.classList.remove('active'));
  setActiveProductFilter('all');

  const input = document.getElementById('searchInput');
  if (input) input.value = '';

  const hero = document.querySelector('.hero');
  const productPanelTarget = document.getElementById('productTypePanel');
  const target = hero || productPanelTarget || document.getElementById('searchSection');

  if (target && target.scrollIntoView) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
window.prepareAnotherFund = prepareAnotherFund;
window.openQuickEditor = openQuickEditor;
window.commitQuickUpdate = commitQuickUpdate;
window.removeCurrentQuickFund = removeCurrentQuickFund;

function updateFloatingSearchButton() {
  // אין יותר כפתור צף קבוע. החזרה לחיפוש מופיעה רק בתוך שורת הקופה לאחר הזנת סכום.
}

function returnToSearch() {
  QUICK_RETURN_VISIBLE = false;
  updateFloatingSearchButton();
  const section = document.getElementById('searchSection');
  const input = document.getElementById('searchInput');
  const query = input ? input.value : '';
  if (query.trim()) showResults(query);
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => {
    if (input) {
      input.focus({ preventScroll: true });
      if (!input.value.trim()) input.select();
    }
  }, 350);
}
window.returnToSearch = returnToSearch;

function focusFundInput(uid) {
  LAST_FOCUSED_UID = uid;
  renderFunds();
  window.setTimeout(() => {
    const card = document.querySelector(`.fund-card[data-uid="${CSS.escape(uid)}"]`);
    const input = document.querySelector(`.balance-input[data-uid="${CSS.escape(uid)}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (input) {
      input.focus({ preventScroll: true });
      input.select();
    }
  }, 50);
}

function addFund(fund) {
  openQuickEditor(fund);
}
function removeFund(idx) {
  if (balanceInputTimers[idx]) clearTimeout(balanceInputTimers[idx]);
  if (feeInputTimers[idx]) clearTimeout(feeInputTimers[idx]);
  if (userFunds[idx] && userFunds[idx].fund.uid === LAST_FOCUSED_UID) LAST_FOCUSED_UID = null;
  userFunds.splice(idx, 1);
  saveState();
  renderFunds();
}
function handleBalanceInput(idx, value, immediate = false) {
  if (balanceInputTimers[idx]) clearTimeout(balanceInputTimers[idx]);
  const run = () => updateBalance(idx, value);
  if (immediate) run();
  else balanceInputTimers[idx] = setTimeout(run, 650);
}
function updateBalance(idx, value) {
  if (!userFunds[idx]) return;
  const balance = Math.max(0, Number(value) || 0);
  userFunds[idx].balance = balance;
  userFunds[idx].updated_at = new Date().toISOString();
  saveState();
  const returnBtn = document.querySelector(`.return-search-btn[data-return-idx="${idx}"]`);
  if (returnBtn) returnBtn.style.display = balance > 0 ? 'inline-block' : 'none';
  QUICK_RETURN_VISIBLE = balance > 0;
  updateFloatingSearchButton();
  renderDashboard();
}
function handleFeeInput(idx, value, immediate = false) {
  if (feeInputTimers[idx]) clearTimeout(feeInputTimers[idx]);
  const run = () => updateManagementFee(idx, value);
  if (immediate) run();
  else feeInputTimers[idx] = setTimeout(run, 500);
}
function updateManagementFee(idx, value) {
  if (!userFunds[idx]) return;
  userFunds[idx].managementFee = normalizeUserFee(value);
  userFunds[idx].updated_at = new Date().toISOString();
  saveState();
  renderDashboard();
}
window.removeFund = removeFund;
window.updateBalance = updateBalance;
window.updateManagementFee = updateManagementFee;
window.handleBalanceInput = handleBalanceInput;
window.handleFeeInput = handleFeeInput;

function buildResultSummary(query, results, totalCount = results.length, visibleCount = results.length) {
  const q = (query || '').trim();
  const counts = results.reduce((acc, r) => {
    acc.total += 1;
    acc[r.source] = (acc[r.source] || 0) + 1;
    return acc;
  }, { total: 0 });
  const countPills = ['gemelnet', 'pensia', 'bituach']
    .filter(src => counts[src])
    .map(src => `<span class="result-count-pill">${SOURCE_LABEL[src]}: ${counts[src]}</span>`)
    .join('');
  const isFocusedCompanySearch = selectedCompanyQuery && q === selectedCompanyQuery && selectedProductFilter !== 'all';
  const title = isFocusedCompanySearch
    ? `נמצאו ${totalCount} קופות/מסלולים של ${escapeHtml(q)}`
    : q
      ? `נמצאו ${totalCount} מוצרים עבור החיפוש: "${escapeHtml(q)}"`
      : `מציג ${totalCount} מוצרים`;
  const visibleNote = totalCount > visibleCount
    ? `<span>מוצגות ${visibleCount} תוצאות ראשונות מתוך ${totalCount}. אפשר לצמצם באמצעות החיפוש הפנימי.</span>`
    : `<span>כל התוצאות הרלוונטיות מוצגות בעמוד</span>`;
  return `
    <div class="result-item result-summary">
      <div class="result-name">${title}</div>
      <div class="result-meta">
        <span>לחיצה על “עדכן” פותחת אזור מהיר להזנת יתרה ודמי ניהול</span>
        ${visibleNote}
      </div>
      <div class="result-counts">${countPills}</div>
    </div>
  `;
}

function updateFilterCounts(query) {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    const label = btn.dataset.label || btn.textContent.trim();
    btn.innerHTML = escapeHtml(label);
  });
}

function resultMatchesInternalSearch(rec, term) {
  const q = normalizeText(term);
  const qCompact = compactText(term);
  if (!q && !qCompact) return true;
  const searchable = [
    rec.fund_name,
    rec.fund_id,
    rec.classification,
    rec.specialization,
    rec.sub_specialization,
    rec.target_population,
    rec.managing_corp,
    rec.parent_company_name
  ].join(' ');
  const text = normalizeText(searchable);
  const compact = compactText(searchable);
  const parts = q.split(' ').filter(Boolean);
  return text.includes(q) || (qCompact && compact.includes(qCompact)) || parts.every(p => text.includes(p) || compact.includes(compactText(p)));
}

function preferredTrackRank(rec) {
  const rawText = [
    rec.fund_name,
    rec.classification,
    rec.specialization,
    rec.sub_specialization,
    rec.target_population
  ].filter(Boolean).join(' ');

  const text = normalizeText(rawText);
  const compact = compactText(rawText);

  // סדר מועדף להצגת תוצאות אחרי בחירת מוצר + יצרן:
  // 1. כללי, 2. עד גיל 50, 3. מניות, 4. כל השאר.
  // הבדיקה רחבה כדי לתפוס ניסוחים שונים במאגר: "עד גיל 50", "50 ומטה", "לבני 50 ומטה" וכו'.
  const isGeneral =
    text.includes('מסלול כללי') ||
    text.includes('כללי') ||
    text.includes('כללית') ||
    compact.includes('מסלולכללי');

  const isUpTo50 =
    text.includes('עד גיל 50') ||
    text.includes('עד גיל50') ||
    text.includes('עד 50') ||
    text.includes('עד-50') ||
    text.includes('לבני עד 50') ||
    text.includes('לבני 50 ומטה') ||
    text.includes('בני 50 ומטה') ||
    text.includes('גילאי 50 ומטה') ||
    text.includes('50 ומטה') ||
    compact.includes('עדגיל50') ||
    compact.includes('עד50') ||
    compact.includes('לבני50ומטה') ||
    compact.includes('בני50ומטה') ||
    compact.includes('גילאי50ומטה') ||
    compact.includes('50ומטה');

  const isEquity =
    text.includes('מסלול מניות') ||
    text.includes('מניות') ||
    text.includes('מנייתי') ||
    text.includes('מניתי') ||
    compact.includes('מסלולמניות');

  if (isGeneral) return 0;
  if (isUpTo50) return 1;
  if (isEquity) return 2;
  return 3;
}

function sortByPreferredTrack(results) {
  // v3.56: אחרי בחירת מוצר / תת-מוצר / יצרן,
  // התוצאות מסודרות לפי שווי נכסים בקטגוריה, מהגדול לקטן.
  return results.slice().sort((a, b) => {
    const assetDiff = (Number(b.total_assets) || 0) - (Number(a.total_assets) || 0);
    if (assetDiff !== 0) return assetDiff;

    const periodDiff = (Number(b.report_period) || 0) - (Number(a.report_period) || 0);
    if (periodDiff !== 0) return periodDiff;

    const nameA = normalizeText(a.fund_name || '');
    const nameB = normalizeText(b.fund_name || '');
    return nameA.localeCompare(nameB, 'he');
  });
}

function buildInsideResultsSearch(query, baseCount) {
  if (!(selectedCompanyQuery && query === selectedCompanyQuery && selectedProductFilter !== 'all')) return '';
  const productLabel = (document.querySelector(`.product-type-btn[data-filter="${selectedProductFilter}"]`) || {}).textContent || '';
  const subtypeText = subProductLabel(selectedSubProductType);
  const scopeLabel = subtypeText || productLabel.trim();
  return `
    <div class="inside-results-search">
      <p class="inside-results-title">חפש מסלול בתוך התוצאות של ${escapeHtml(selectedCompanyQuery)}</p>
      <p class="inside-results-subtitle">נמצאו ${baseCount} קופות/מסלולים בתחום ${escapeHtml(scopeLabel)}. אפשר לצמצם לפי מסלול, גיל, מדד או מספר קופה.</p>
      <input type="text" class="inside-results-input" id="insideResultsInput" value="${escapeHtml(currentInsideResultsQuery)}" placeholder="לדוגמה: כללי, מניות, S&P 500, 50 עד 60, מספר קופה" autocomplete="off" />
    </div>
  `;
}

function showResults(query) {
  updateFilterCounts(query);
  const baseResults = searchFunds(query);
  const wrap = document.getElementById('searchResults');
  const focusedCompanyMode = Boolean(selectedCompanyQuery && query === selectedCompanyQuery && selectedProductFilter !== 'all');
  const filteredResults = focusedCompanyMode
    ? baseResults.filter(r => resultMatchesInternalSearch(r, currentInsideResultsQuery))
    : baseResults;
  const orderedResults = focusedCompanyMode ? sortByPreferredTrack(filteredResults) : filteredResults;
  const visibleLimit = focusedCompanyMode ? resultVisibleLimit : Infinity;
  const displayedResults = orderedResults.slice(0, Number.isFinite(visibleLimit) ? visibleLimit : orderedResults.length);
  if (!baseResults.length) {
    wrap.innerHTML = query.trim()
      ? '<div class="result-item result-summary"><div class="result-name">לא נמצאו תוצאות</div><div class="result-meta"><span>נסה לבחור סוג מוצר אחר או להשתמש בחיפוש הידני.</span></div></div>'
      : '';
    wrap.classList.toggle('active', Boolean(query.trim()));
    return;
  }
  const insideSearch = buildInsideResultsSearch(query, baseResults.length);
  if (!orderedResults.length) {
    wrap.innerHTML = insideSearch + '<div class="result-item result-summary"><div class="result-name">לא נמצאה קופה שמתאימה לחיפוש הפנימי</div><div class="result-meta"><span>נסה לחפש מילה קצרה יותר, לדוגמה: כללי / מניות / 50 / מספר קופה.</span></div></div>';
    wrap.classList.add('active');
    attachInsideResultsEvents(query);
    return;
  }
  const summary = buildResultSummary(query, orderedResults, orderedResults.length, displayedResults.length);
  const resultItems = displayedResults.map(r => {
    const stale = r.is_stale ? `<span class="stale-badge">${r.months_behind} ח׳ ישן</span>` : '';
    const micro = r.is_micro_fund ? `<span class="micro-badge">קטנה</span>` : '';
    const exposure = `מניות ${fmtPct(r.stock_pct, 0)} • חו״ל ${fmtPct(r.foreign_pct, 0)} • מט״ח ${fmtPct(r.fx_pct, 0)}`;
    const manager = r.managing_corp || r.parent_company_name || '-';
    const alreadySelected = userFunds.some(item => item.fund.uid === r.uid);
    const selectedBadge = alreadySelected ? '<span class="selected-badge">כבר נוסף</span>' : '';
    return `
      <div class="result-item ${alreadySelected ? 'selected' : ''}" data-uid="${escapeHtml(r.uid)}">
        <div class="result-main-row">
          <div>
            <div class="result-name"><span class="source-tag ${escapeHtml(r.source)}">${SOURCE_LABEL[r.source]}</span>${escapeHtml(r.fund_name)} ${selectedBadge} ${stale} ${micro}</div>
            <div class="result-meta">
              <span>${escapeHtml(manager)}</span>
              <span>${escapeHtml(r.classification || '')}</span>
              <span>${exposure}</span>
              <span>נכסים: ₪${Math.round(Number(r.total_assets) || 0).toLocaleString('he-IL')} מיליון</span>
              <span>מספר: ${escapeHtml(r.fund_id || '')}</span>
            </div>
          </div>
          <button type="button" class="select-btn" data-uid="${escapeHtml(r.uid)}">עדכן</button>
        </div>
      </div>
    `;
  }).join('');
  const canToggleMore = focusedCompanyMode && orderedResults.length > 5;
  const expandedResults = canToggleMore && resultVisibleLimit !== 5 && displayedResults.length >= orderedResults.length;
  const showMore = canToggleMore
    ? `<button type="button" class="show-more-results-btn" id="showMoreResultsBtn">${expandedResults ? 'סגור תוצאות נוספות' : `הצג עוד ${orderedResults.length - 5} תוצאות`}</button>`
    : '';
  wrap.innerHTML = insideSearch + summary + resultItems + showMore;
  wrap.classList.add('active');
  wrap.querySelectorAll('.select-btn[data-uid]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const found = orderedResults.find(x => x.uid === btn.dataset.uid);
      if (found) addFund(found);
    });
  });
  attachInsideResultsEvents(query);
  const showMoreBtn = document.getElementById('showMoreResultsBtn');
  if (showMoreBtn) {
    showMoreBtn.addEventListener('click', () => {
      resultVisibleLimit = expandedResults ? 5 : Infinity;
      showResults(query);
      const nextBtn = document.getElementById('showMoreResultsBtn');
      if (nextBtn && nextBtn.scrollIntoView) {
        nextBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }
}

function attachInsideResultsEvents(query) {
  const insideInput = document.getElementById('insideResultsInput');
  if (!insideInput) return;
  insideInput.addEventListener('input', e => {
    currentInsideResultsQuery = e.target.value;
    resultVisibleLimit = 5;
    showResults(query);
    const nextInput = document.getElementById('insideResultsInput');
    if (nextInput) {
      nextInput.focus();
      const len = nextInput.value.length;
      try { nextInput.setSelectionRange(len, len); } catch (_) {}
    }
  });
}

document.getElementById('searchInput').addEventListener('input', e => showResults(e.target.value));
document.getElementById('searchInput').addEventListener('focus', e => {
  if (activeFilter !== 'all' || e.target.value.trim()) showResults(e.target.value);
});
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedSubProductType = '';
    activeFilter = btn.dataset.filter;
    selectedProductFilter = activeFilter;
    showResults(document.getElementById('searchInput').value);
  });
});


const manualSearchToggle = document.getElementById('manualSearchToggle');
const manualSearchControls = document.getElementById('manualSearchControls');
if (manualSearchToggle && manualSearchControls) {
  manualSearchToggle.addEventListener('click', () => {
    const willOpen = manualSearchControls.hasAttribute('hidden');
    if (willOpen) {
      selectedSubProductType = '';
      manualSearchControls.removeAttribute('hidden');
      manualSearchToggle.setAttribute('aria-expanded', 'true');
      manualSearchToggle.textContent = 'סגור חיפוש ידני';
      const input = document.getElementById('searchInput');
      if (input) {
        setTimeout(() => input.focus(), 80);
      }
    } else {
      manualSearchControls.setAttribute('hidden', '');
      manualSearchToggle.setAttribute('aria-expanded', 'false');
      manualSearchToggle.textContent = 'חיפוש ידני';
    }
  });
}

// v3.48: זרימה פשוטה יותר — בחירת סוג מוצר, אחר כך יצרן, ואז קופה
let selectedCompanyQuery = '';
let selectedProductFilter = 'all';
let selectedSubProductType = '';
let currentInsideResultsQuery = '';
let resultVisibleLimit = 5;

function setActiveProductFilter(filter) {
  activeFilter = filter || 'all';
  selectedProductFilter = activeFilter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  const matchingFilterBtn = document.querySelector(`.filter-btn[data-filter="${activeFilter}"]`);
  if (matchingFilterBtn) matchingFilterBtn.classList.add('active');
  document.querySelectorAll('.product-type-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === activeFilter));
}

function resetSearchResultsOnly() {
  currentInsideResultsQuery = '';
  resultVisibleLimit = 5;
  const resultsWrap = document.getElementById('searchResults');
  if (resultsWrap) {
    resultsWrap.innerHTML = '';
    resultsWrap.classList.remove('active');
  }
  const editor = document.getElementById('quickEditor');
  if (editor) {
    editor.classList.remove('active');
    editor.innerHTML = '';
  }
}

function hideCompanyChooser() {
  const companyLabel = document.getElementById('companyGridLabel');
  const companyGrid = document.getElementById('companyGrid');
  if (companyLabel) companyLabel.style.display = 'none';
  if (companyGrid) companyGrid.style.display = 'none';
  document.querySelectorAll('.company-btn').forEach(b => b.classList.remove('is-selected'));
}

function hideSubProductChooser() {
  const panel = document.getElementById('subProductPanel');
  const grid = document.getElementById('subProductGrid');
  if (panel) panel.style.display = 'none';
  if (grid) {
    grid.innerHTML = '';
    grid.querySelectorAll?.('.sub-product-btn').forEach(b => b.classList.remove('active'));
  }
  selectedSubProductType = '';
}

function clearGuidedSelectionState() {
  selectedCompanyQuery = '';
  selectedSubProductType = '';
  selectedProductFilter = 'all';
  activeFilter = 'all';
  const input = document.getElementById('searchInput');
  if (input) input.value = '';
  document.querySelectorAll('.product-type-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  const allFilterBtn = document.querySelector('.filter-btn[data-filter="all"]');
  if (allFilterBtn) allFilterBtn.classList.add('active');
  hideCompanyChooser();
  hideSubProductChooser();
  resetSearchResultsOnly();
}

function showCompanyChooser() {
  const companyLabel = document.getElementById('companyGridLabel');
  const companyGrid = document.getElementById('companyGrid');
  if (!companyGrid) return;

  const companies = getCompanyAssetsForCurrentScope();
  companyGrid.innerHTML = companies.length
    ? companies.map(company => `
        <button type="button" class="company-btn" data-query="${escapeHtml(company.query)}" title="${Math.round(company.totalAssets).toLocaleString('he-IL')} מיליון ₪">
          <span>${escapeHtml(company.label)}</span>
        </button>
      `).join('')
    : '<div class="result-item result-summary"><div class="result-name">לא נמצאו חברות רלוונטיות בקטגוריה שנבחרה</div><div class="result-meta"><span>נסה לבחור סוג מוצר אחר או להשתמש בחיפוש הידני.</span></div></div>';

  if (companyLabel) {
    companyLabel.style.display = '';
    companyLabel.textContent = companies.length
      ? 'באיזו חברה מנוהל המוצר? החברות מסודרות לפי שווי נכסים בקטגוריה שנבחרה.'
      : 'לא נמצאו חברות רלוונטיות';
  }
  companyGrid.style.display = 'grid';
  attachCompanyButtonEvents();
  if (companyGrid.scrollIntoView) {
    companyGrid.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
function renderSubProductOptions(filter) {
  const panel = document.getElementById('subProductPanel');
  const grid = document.getElementById('subProductGrid');
  const title = document.getElementById('subProductTitle');
  const subtitle = document.getElementById('subProductSubtitle');
  const options = getSubProductOptions(filter);
  selectedSubProductType = '';
  if (!panel || !grid) return false;
  grid.innerHTML = '';
  if (!options.length) {
    panel.style.display = 'none';
    return false;
  }
  if (title) title.textContent = filter === 'gemelnet' ? 'איזה סוג גמל יש לך?' : 'איזה סוג ביטוח / פוליסה יש לך?';
  if (subtitle) subtitle.textContent = 'בחר תת-סוג כדי לצמצם את רשימת החברות והמסלולים.';
  grid.innerHTML = options.map(opt => `<button type="button" class="product-type-btn sub-product-btn" data-subtype="${escapeHtml(opt.type)}">${escapeHtml(opt.label)}</button>`).join('');
  panel.style.display = 'block';
  grid.querySelectorAll('.sub-product-btn').forEach(button => {
    button.addEventListener('click', () => {
      const subtype = button.dataset.subtype || '';
      const isAlreadySelected = button.classList.contains('active') && selectedSubProductType === subtype;
      if (isAlreadySelected) {
        selectedSubProductType = '';
        selectedCompanyQuery = '';
        button.classList.remove('active');
        hideCompanyChooser();
        const input = document.getElementById('searchInput');
        if (input) input.value = '';
        resetSearchResultsOnly();
        return;
      }
      selectedSubProductType = subtype;
      grid.querySelectorAll('.sub-product-btn').forEach(b => b.classList.remove('active'));
      button.classList.add('active');
      selectedCompanyQuery = '';
      const input = document.getElementById('searchInput');
      if (input) input.value = '';
      resetSearchResultsOnly();
      showCompanyChooser();
    });
  });
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return true;
}

document.querySelectorAll('.product-type-btn:not(.sub-product-btn)').forEach(btn => {
  btn.addEventListener('click', () => {
    const filter = btn.dataset.filter || 'all';
    const isAlreadySelected = btn.classList.contains('active') && selectedProductFilter === filter;

    if (isAlreadySelected) {
      clearGuidedSelectionState();
      return;
    }

    selectedCompanyQuery = '';
    setActiveProductFilter(filter);
    hideCompanyChooser();

    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    resetSearchResultsOnly();

    const needsSubProduct = renderSubProductOptions(filter);
    if (!needsSubProduct) {
      selectedSubProductType = '';
      showCompanyChooser();
    }
  });
});

// כפתורי החברות נוצרים דינמית לפי שווי נכסים בקטגוריה שנבחרה.

// חיפוש ידני מוסתר כברירת מחדל ונפתח רק בלחיצה, כדי לא להעמיס על המשתמש.


(async function init() {
  try {
    const res = await fetch('./funds_unified.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const payload = await res.json();
    DATA = Array.isArray(payload.funds) ? payload.funds : [];
    META = payload.meta || {};
    DATASET_MAX_PERIOD = META.dataset_max_period || Math.max(...DATA.map(x => Number(x.report_period) || 0));
    document.getElementById('loadingState').style.display = 'none';
    renderDatasetMeta();
    loadState();
    renderMissingFunds();
    updateFilterCounts('');
    renderFunds();
  } catch (error) {
    document.getElementById('loadingState').textContent = 'שגיאה בטעינת הנתונים: ' + error.message;
    console.error(error);
  }
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSimulationCalculator);
} else {
  initSimulationCalculator();
}


/* === v3.29: טולטיפים של ריבועי המידע === */
/* v3.29: info cube tooltips - works on hover (desktop) and tap (mobile) */
(function() {
  const cubes = document.querySelectorAll('.info-cube');
  const tooltip = document.getElementById('cubeTooltip');
  if (!cubes.length || !tooltip) return;

  const tips = {
    exposure: '<strong>חשיפה למניות ולמט״ח</strong>חשיפה למניות = החלק מההשקעה שלך המושקע במניות (חשוף לתנודות שוק, פוטנציאל תשואה וסיכון גבוהים יותר). חשיפה למט״ח = החלק מההשקעה הצמוד למטבעות זרים (בעיקר דולר). שני המדדים האלה מאפשרים לך להבין במבט אחד את רמת הסיכון בחיסכון שלך.',
    privacy: '<strong>הנתונים שלך נשארים אצלך</strong>היתרות ודמי הניהול שהזנת נשמרים בדפדפן שלך. הם אינם נשמרים בשרת, ואינם משויכים לפרטים אישיים.',
    workflow: '<strong>איך עובדים עם הכלי</strong>1. חפש את שם החברה שמנהלת את הקופה שלך (אפשר למצוא בדוח השנתי שמגיע בדואר/מייל). 2. לחץ "עדכן" על הקופה הרצויה. 3. הזן יתרה ודמי ניהול בפועל. 4. לחץ "עדכן בדשבורד" כדי לראות את החשיפה הכוללת של כל החסכונות יחד.',
    source: '<strong>מקור הנתונים</strong>הנתונים מבוססים על קובצי המידע הציבוריים של רשות שוק ההון, הביטוח והחיסכון, מתוך מאגרי גמל נט, פנסיה נט וביטוח נט, כפי שפורסמו ב-data.gov.il. הדשבורד אינו מושך נתונים אישיים ממסלקה פנסיונית, אלא משתמש ביתרות ודמי ניהול שהמשתמש מזין ידנית.'
  };

  let activeCube = null;

  function closeTooltip() {
    cubes.forEach(c => c.setAttribute('aria-expanded', 'false'));
    tooltip.hidden = true;
    activeCube = null;
  }

  function openTooltip(cube) {
    const id = cube.dataset.tip;
    if (!tips[id]) return;
    cubes.forEach(c => c.setAttribute('aria-expanded', 'false'));
    cube.setAttribute('aria-expanded', 'true');
    tooltip.innerHTML = tips[id];
    tooltip.hidden = false;
    activeCube = cube;
  }

  cubes.forEach(cube => {
    cube.addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeCube === cube) {
        closeTooltip();
      } else {
        openTooltip(cube);
      }
    });
  });

  // click outside closes tooltip
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.info-cube') && !e.target.closest('.info-cube-tooltip')) {
      if (activeCube) closeTooltip();
    }
  });

  // ESC key closes tooltip
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeCube) closeTooltip();
  });
})();


/* === חזרה לראש העמוד === */
window.backToTop = function() { const hero = document.querySelector('.premium-hero') || document.body; hero.scrollIntoView({ behavior: 'smooth', block: 'start' }); };


/* === פאנלים נפתחים בעמוד הנחיתה === */
(function() {
  function closeLandingPanels(exceptId) {
    ['landingAboutPanel', 'landingDisclosurePanel', 'landingPrivacyPanel'].forEach(function(id) {
      const panel = document.getElementById(id);
      const btn = document.querySelector('[aria-controls="' + id + '"]');
      if (!panel || id === exceptId) return;
      panel.hidden = true;
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }
  function togglePanel(btnId, panelId) {
    const btn = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    if (!btn || !panel) return;
    btn.addEventListener('click', function() {
      const willOpen = panel.hidden;
      closeLandingPanels(panelId);
      panel.hidden = !willOpen;
      btn.setAttribute('aria-expanded', String(willOpen));
      if (willOpen && panel.scrollIntoView) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }
  togglePanel('landingAboutBtn', 'landingAboutPanel');
  togglePanel('landingDisclosureBtn', 'landingDisclosurePanel');
  togglePanel('landingPrivacyBtn', 'landingPrivacyPanel');

  const startBtn = document.getElementById('landingStartBtn');
  const searchSection = document.getElementById('searchSection');
  function returnToLanding() {
    if (!searchSection) return;
    searchSection.classList.add('landing-hidden');
    document.body.classList.remove('landing-started');
    document.body.classList.remove('dashboard-reached');
    if (startBtn) startBtn.setAttribute('aria-expanded', 'false');
    const hero = document.querySelector('.premium-hero');
    if (hero) hero.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  window.returnToLanding = returnToLanding;
  window.closeLandingPanels = closeLandingPanels;

  window.enterDashboardView = function() {
    closeLandingPanels('');
    document.body.classList.remove('landing-started');
    document.body.classList.add('dashboard-reached');
    if (startBtn) startBtn.setAttribute('aria-expanded', 'false');
    if (searchSection) searchSection.classList.add('landing-hidden');

    const editor = document.getElementById('quickEditor');
    if (editor) { editor.classList.remove('active'); editor.innerHTML = ''; }

    const results = document.getElementById('searchResults');
    if (results) { results.classList.remove('active'); results.innerHTML = ''; }

    const portfolio = document.getElementById('portfolioSection');
    if (portfolio) portfolio.style.display = 'none';

    const productPanel = document.getElementById('productTypePanel');
    if (productPanel) productPanel.classList.add('active');

    const subProductPanel = document.getElementById('subProductPanel');
    const subProductGrid = document.getElementById('subProductGrid');
    if (subProductPanel) subProductPanel.style.display = 'none';
    if (subProductGrid) subProductGrid.innerHTML = '';

    const companyLabel = document.getElementById('companyGridLabel');
    const companyGrid = document.getElementById('companyGrid');
    if (companyLabel) companyLabel.style.display = 'none';
    if (companyGrid) { companyGrid.style.display = 'none'; companyGrid.innerHTML = ''; }

    const manual = document.getElementById('manualSearchControls');
    if (manual) manual.hidden = true;
    const manualToggle = document.getElementById('manualSearchToggle');
    if (manualToggle) manualToggle.setAttribute('aria-expanded', 'false');

    const projection = document.getElementById('projectionSection');
    if (projection) {
      projection.hidden = true;
      projection.dataset.opened = 'false';
    }
    const projToggle = document.getElementById('projToggle');
    if (projToggle) projToggle.setAttribute('aria-expanded', 'false');
    const projBody = document.getElementById('projBody');
    if (projBody) projBody.hidden = true;
    const projResults = document.getElementById('projResults');
    if (projResults) projResults.hidden = true;

    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    document.querySelectorAll('.product-type-btn.active, .company-btn.is-selected, .sub-product-btn.active').forEach(function(btn) {
      btn.classList.remove('active', 'is-selected');
    });
  };

  const returnBtn = document.getElementById('returnLandingBtn');
  if (returnBtn) returnBtn.addEventListener('click', returnToLanding);
  if (startBtn && searchSection) {
    startBtn.addEventListener('click', function() {
      const isHidden = searchSection.classList.contains('landing-hidden');
      closeLandingPanels('');
      document.querySelectorAll('.landing-card[aria-controls]').forEach(function(btn) {
        if (btn.id !== 'landingStartBtn') btn.setAttribute('aria-expanded', 'false');
      });
      if (isHidden) {
        searchSection.classList.remove('landing-hidden');
        document.body.classList.remove('dashboard-reached');
        document.body.classList.add('landing-started');
        startBtn.setAttribute('aria-expanded', 'true');
        searchSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        searchSection.classList.add('landing-hidden');
        document.body.classList.remove('landing-started');
        startBtn.setAttribute('aria-expanded', 'false');
        const hero = document.querySelector('.premium-hero');
        if (hero) hero.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }
})();

