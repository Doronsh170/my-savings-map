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


/* === v4.0: טקסונומיה נגזרת מהנתונים — מותגים, סוגי מוצר ודירוג מסלולים ===
   כל האינדקסים נבנים פעם אחת בטעינה (buildWizardIndexes) ולא בכל הקלדה. */

// סיומות משפטיות/תפקודיות שמורידות משם הגוף המנהל כדי להגיע לשם שהמשתמש מכיר.
// מסירים רק כשהביטוי אינו פותח את השם, אחרת "קרנות השתלמות למורים" היה נחתך לגמרי.
const BRAND_STRIP = [
  /בע['׳"]{0,2}מ/g, /חברה לביטוח/g, /חברה מנהלת/g, /חברה לניהול קופות גמל/g,
  /ניהול קופות גמל/g, /קרנות פנסיה וקופות גמל/g, /קופות גמל וקרנות השתלמות/g,
  /קופות גמל/g, /קופת גמל/g, /השתלמות, גמל ופנסיה/g, /גמל ופנסיה/g,
  /פנסיה וגמל/g, /גמל והשתלמות/g, /ניהול קרנות/g, /פנסיה מקיפה/g, /החזקות/g, /אחזקות/g
];
// ישויות משפטיות נפרדות שהמשתמש תופס כמותג אחד.
const BRAND_MERGE = {
  'מגדל מקפת': 'מגדל',
  'הראל פנסיה': 'הראל',
  'מנורה מבטחים פנסיה': 'מנורה מבטחים'
};
// שמות שהמשתמש עשוי לחפש אך אינם מופיעים בשדות החברה — מותגים היסטוריים
// ומסלולים בשם צד שלישי. מתוחזק ידנית: התאמת תת-מחרוזת אוטומטית הייתה
// גורמת ל"כלל" לתפוס כל "מסלול כללי".
const BRAND_ALIASES = {
  'כלל': ['תמר'],
  'הפניקס': ['אקסלנס', 'פניקס'],
  'הראל': ['גילעד'],
  'אלטשולר שחם': ['אלטשולר', 'פסגות'],
  'מנורה מבטחים': ['מנורה', 'מבטחים'],
  'מיטב': ['מיטב דש', 'דש'],
  'אינפיניטי': ['הלמן אלדובי', 'הלמן'],
  'מגדל': ['מקפת']
};
// מותג -> שם הקובץ בתיקיית logos, כולל סיומת (svg או png).
// הרשימה מתפקדת כמניפסט: מוסיפים שורה רק אחרי שהקובץ הועלה, אחרת הדפדפן
// ידווח על 404. בלי לוגו מוצגת מונוגרמה. פירוט: logos/README.md.
//
// שמונה החברות של המסך הראשון — להסיר את הערות השורות אחרי העלאת הקבצים:
// const BRAND_LOGOS = {
//   'הראל': 'harel.svg',
//   'מנורה מבטחים': 'menora.svg',
//   'הפניקס': 'phoenix.svg',
//   'מגדל': 'migdal.svg',
//   'כלל': 'clal.svg',
//   'מיטב': 'meitav.svg',
//   'אלטשולר שחם': 'altshuler.svg',
//   'מור': 'mor.svg'
// };
const BRAND_LOGOS = {};

function brandOf(rec) {
  const raw = String(rec.managing_corp || rec.parent_company_name || '').trim().replace(/[״]/g, '"').replace(/[׳]/g, "'");
  let name = raw;
  BRAND_STRIP.forEach(pattern => {
    name = name.replace(pattern, (match, offset) => (offset === 0 ? match : ' '));
  });
  name = name.replace(/[-–,]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s-]+|[\s-]+$/g, '');
  if (!name) name = raw;
  return BRAND_MERGE[name] || name;
}

// סוגי החיסכון כפי שהמשתמש מכיר אותם. הסדר הוא סדר התצוגה.
const PRODUCT_TYPES = [
  { key: 'pensia',      label: 'קרן פנסיה',        hint: 'ההפקדה שיורדת מהשכר כל חודש, כולל כיסוי לנכות ולשארים' },
  { key: 'hishtalmut',  label: 'קרן השתלמות',      hint: 'נפתחת דרך המעסיק, וניתנת למשיכה אחרי שש שנים' },
  { key: 'gemel',       label: 'קופת גמל',         hint: 'חיסכון פנסיוני שאינו קרן פנסיה, נמשך בדרך כלל כקצבה' },
  { key: 'invest',      label: 'גמל להשקעה',       hint: 'חיסכון פרטי שאפשר למשוך בכל עת' },
  { key: 'insurance',   label: 'ביטוח מנהלים / פוליסת חיסכון', hint: 'חיסכון בחברת ביטוח, לרוב דרך סוכן — ותיק או חדש' },
  { key: 'child',       label: 'חיסכון לכל ילד',   hint: 'החיסכון שנפתח לילד עם קצבת הילדים' },
  { key: 'pitzuim',     label: 'מרכזית לפיצויים',  hint: 'קופה על שם המעסיק לכיסוי פיצויי פיטורים' }
];
const PRODUCT_LABEL = {};
PRODUCT_TYPES.forEach(item => { PRODUCT_LABEL[item.key] = item.label; });
const PRODUCT_ORDER = PRODUCT_TYPES.map(item => item.key);
// עד שישה אריחים גלויים; השאר מתקפלים תחת "סוג אחר".
const PRIMARY_PRODUCTS_SHOWN = 6;

function productOf(rec) {
  const cls = String(rec.classification || '');
  if (rec.source === 'pensia') return 'pensia';
  // כל מוצרי הביטוח תחת סוג אחד: classification מתאר תקופת הנפקה ואינו מבחין
  // באמינות בין ביטוח מנהלים לפוליסת חיסכון. המשתמש מזהה את המסלול בתוצאות.
  if (rec.source === 'bituach') return 'insurance';
  if (cls.indexOf('השתלמות') > -1) return 'hishtalmut';
  if (cls.indexOf('לילד') > -1) return 'child';
  if (cls.indexOf('להשקעה') > -1) return 'invest';
  if (cls.indexOf('מרכזית') > -1) return 'pitzuim';
  return 'gemel';
}

// מסלולים שרוב המשתמשים הפרטיים אינם נמצאים בהם יורדים בדירוג — לא מוסתרים.
// 2 = כמעט תמיד לא רלוונטי, 1 = ותיק/מיוחד, 0 = רגיל.
function trackRelevanceGroup(rec) {
  const text = normalizeText([rec.fund_name, rec.classification, rec.specialization, rec.sub_specialization].filter(Boolean).join(' '));
  if (/מקבלי קצבה|לפנסיונרים|למקבלי פנסיה/.test(text)) return 2;
  if (/מרכזית לפיצויים/.test(text)) return 2;
  if (/ira|בניהול אישי|בניהול עצמי/.test(text)) return 2;
  if (/קרן ותיקה|ותיקות|קרן [יטכל]['׳]?\b|מבטיח תשואה|מנוף/.test(text)) return 1;
  if (/עתודה|נוסטרו|לעובדי מדינה בלבד/.test(text)) return 1;
  return 0;
}

function rankTracks(list) {
  return list.slice().sort((a, b) => {
    const groupDiff = trackRelevanceGroup(a) - trackRelevanceGroup(b);
    if (groupDiff !== 0) return groupDiff;
    const assetDiff = (Number(b.total_assets) || 0) - (Number(a.total_assets) || 0);
    if (assetDiff !== 0) return assetDiff;
    return normalizeText(a.fund_name).localeCompare(normalizeText(b.fund_name), 'he');
  });
}

// תגיות מסלול — משמשות גם לצ'יפים וגם לתיאור בשפה פשוטה בכרטיס.
const TRACK_CHIPS = [
  { key: 'general', label: 'כללי' },
  { key: 'age50',   label: 'עד גיל 50' },
  { key: 'age5060', label: 'גיל 50–60' },
  { key: 'age60',   label: 'גיל 60 ומעלה' },
  { key: 'equity',  label: 'מניות' },
  { key: 'index',   label: 'עוקב מדד' },
  { key: 'sp500',   label: 'S&P 500' },
  { key: 'bond',    label: 'אג״ח' },
  { key: 'money',   label: 'כספי' },
  { key: 'halacha', label: 'הלכתי' }
];
function trackTags(rec) {
  const text = normalizeText([rec.fund_name, rec.specialization, rec.sub_specialization].filter(Boolean).join(' '));
  const tags = [];
  if (/s and p|s&p|sp ?500|500/.test(text)) tags.push('sp500');
  if (/עד 50|לבני 50 ומטה|50 ומטה|גילאי 50 ומטה|עד גיל 50/.test(text)) tags.push('age50');
  if (/50 60|50 עד 60|גילאי 50 עד 60/.test(text)) tags.push('age5060');
  if (/60 ומעלה|מעל 60|לבני 60|גילאי 60/.test(text)) tags.push('age60');
  if (/מדד|עוקב/.test(text)) tags.push('index');
  if (/מני/.test(text)) tags.push('equity');
  if (/אגח|אג ח/.test(text)) tags.push('bond');
  if (/כספי|שקלי/.test(text)) tags.push('money');
  if (/הלכ|שריעה|מסורת/.test(text)) tags.push('halacha');
  if (/יעד לפרישה|יעד פרישה/.test(text)) tags.push('target');
  if (/כללי/.test(text)) tags.push('general');
  return tags;
}
function trackLabel(rec) {
  const tags = trackTags(rec);
  const has = key => tags.indexOf(key) > -1;
  if (has('sp500')) return 'מסלול עוקב מדד S&P 500';
  if (has('age50')) return 'מסלול לפי גיל · עד 50';
  if (has('age5060')) return 'מסלול לפי גיל · 50 עד 60';
  if (has('age60')) return 'מסלול לפי גיל · 60 ומעלה';
  if (has('index')) return 'מסלול עוקב מדדים';
  if (has('equity')) return 'מסלול מנייתי';
  if (has('bond')) return 'מסלול אג״ח';
  if (has('money')) return 'מסלול כספי';
  if (has('halacha')) return 'מסלול הלכתי';
  if (has('target')) return 'מסלול יעד לפרישה';
  if (has('general')) return 'מסלול כללי';
  // ברירת מחדל: שם סוג המוצר, ולא הסיווג הרגולטורי ("קרנות חדשות" וכד').
  return PRODUCT_LABEL[rec._product] || 'מסלול';
}

// --- אינדקסים שנבנים פעם אחת ---
let BRANDS = [];
let BRAND_BY_NAME = {};

function isSelectableFund(rec) {
  return rec.is_active && (Number(rec.total_assets) || 0) > 0;
}

function buildWizardIndexes() {
  const map = {};
  DATA.forEach(rec => {
    if (!isSelectableFund(rec)) return;
    rec._brand = brandOf(rec);
    rec._product = productOf(rec);
    rec._searchText = normalizeText([rec.fund_name, rec.fund_id, rec.specialization, rec.sub_specialization, rec.classification].filter(Boolean).join(' '));
    let entry = map[rec._brand];
    if (!entry) {
      entry = map[rec._brand] = {
        name: rec._brand,
        logo: BRAND_LOGOS[rec._brand] || '',
        assets: 0,
        products: {},
        corps: {},
        search: ''
      };
    }
    entry.assets += Number(rec.total_assets) || 0;
    entry.products[rec._product] = (entry.products[rec._product] || 0) + 1;
    if (rec.managing_corp) entry.corps[rec.managing_corp] = 1;
  });
  BRANDS = Object.keys(map).map(key => {
    const entry = map[key];
    const aliases = BRAND_ALIASES[entry.name] || [];
    entry.search = normalizeText([entry.name, Object.keys(entry.corps).join(' '), aliases.join(' ')].join(' '));
    entry.monogram = entry.name.replace(/["'׳״-]/g, '').trim().slice(0, 2);
    return entry;
  }).sort((a, b) => b.assets - a.assets);
  BRAND_BY_NAME = {};
  BRANDS.forEach(entry => { BRAND_BY_NAME[entry.name] = entry; });
}

function brandsForProduct(product) {
  if (!product) return BRANDS;
  return BRANDS.filter(entry => entry.products[product]);
}
function productsForBrand(name) {
  const entry = BRAND_BY_NAME[name];
  if (!entry) return [];
  return PRODUCT_ORDER.filter(key => entry.products[key]);
}
function fundsInScope(brandName, product) {
  return DATA.filter(rec => isSelectableFund(rec) &&
    (!brandName || rec._brand === brandName) &&
    (!product || rec._product === product));
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
  renderDashboard();
  document.body.classList.remove('dashboard-reached');
  wizReset();
  wizScrollIntoView();
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
  wizRender();
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
    wizRender();
  }
}
function prepareAnotherFund() {
  CURRENT_EDIT_FUND = null;
  const editor = document.getElementById('quickEditor');
  if (editor) {
    editor.classList.remove('active');
    editor.innerHTML = '';
  }
  document.body.classList.remove('dashboard-reached');
  wizReset();
  wizScrollIntoView();
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
  document.body.classList.remove('dashboard-reached');
  wizRender();
  wizScrollIntoView();
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


/* === v4.0: אשף איתור הקופה ===
   כל מצב האשף יושב באובייקט אחד. שדה החיפוש הוא קלט, לא מצב.
   חברה ← סוג חיסכון ← מסלולים נפוצים, וכל השאר נחשף רק בבקשה. */

const RESULTS_PAGE = 5;
const wizard = {
  step: 'company',      // company | allCompanies | unknown | typeFirst | product | results
  company: '',
  product: '',
  chip: '',
  query: '',
  companyQuery: '',
  expanded: false,      // נפתח רק אחרי "לא מצאת את שלך?"
  showExtraProducts: false,
  limit: RESULTS_PAGE,
  globalSearch: false
};

function wizSet(patch) {
  Object.assign(wizard, patch);
  wizRender();
}
function wizReset() {
  Object.assign(wizard, {
    step: 'company', company: '', product: '', chip: '', query: '',
    companyQuery: '', expanded: false, showExtraProducts: false, limit: RESULTS_PAGE, globalSearch: false
  });
  wizRender();
}

function wizLogo(entry) {
  const monogram = `<span class="wiz-monogram">${escapeHtml(entry.monogram || '?')}</span>`;
  const img = entry.logo
    ? `<img src="logos/${escapeHtml(entry.logo)}" alt="" loading="lazy" onerror="this.remove()" />`
    : '';
  return `<span class="wiz-logo" aria-hidden="true">${monogram}${img}</span>`;
}

/* --- מסך 1: מי מנהל את החיסכון --- */
function wizScreenCompany() {
  const list = brandsForProduct(wizard.product);
  const top = list.slice(0, 8);
  const intro = wizard.product
    ? `אילו חברות מנהלות ${escapeHtml(PRODUCT_LABEL[wizard.product] || '')}?`
    : 'בוא נמצא את החיסכון שלך. מי מנהל אותו?';
  return `
    <h2 class="wiz-title">${intro}</h2>
    <p class="wiz-sub">בחר את החברה שאליה שייך החיסכון. אפשר לזהות אותה בדוח או באזור האישי.</p>
    <div class="wiz-company-grid">
      ${top.map(entry => `
        <button type="button" class="wiz-company" data-wiz="company" data-value="${escapeHtml(entry.name)}">
          ${wizLogo(entry)}<span class="wiz-company-name">${escapeHtml(entry.name)}</span>
        </button>`).join('')}
    </div>
    <div class="wiz-links">
      <button type="button" class="wiz-link" data-wiz="allCompanies">כל החברות</button>
      <button type="button" class="wiz-link" data-wiz="unknown">אני לא יודע איפה הכסף מנוהל</button>
    </div>`;
}

/* --- מסך 2: כל החברות --- */
function wizScreenAllCompanies() {
  const term = normalizeText(wizard.companyQuery);
  const list = brandsForProduct(wizard.product)
    .filter(entry => !term || entry.search.indexOf(term) > -1);
  const rows = list.length
    ? list.map(entry => `
        <button type="button" class="wiz-company-row" data-wiz="company" data-value="${escapeHtml(entry.name)}">
          ${wizLogo(entry)}<span class="wiz-company-name">${escapeHtml(entry.name)}</span>
        </button>`).join('')
    : `<p class="wiz-empty-note">לא מצאנו חברה בשם הזה. אפשר לנסות חלק מהשם, או לחזור ולבחור מהחברות המרכזיות.</p>`;
  return `
    <h2 class="wiz-title">חפש את החברה שלך</h2>
    <div class="wiz-field">
      <input type="text" id="wizCompanySearch" class="wiz-input" placeholder="שם החברה" value="${escapeHtml(wizard.companyQuery)}" autocomplete="off" />
    </div>
    <div class="wiz-company-list">${rows}</div>
    <div class="wiz-links">
      <button type="button" class="wiz-link" data-wiz="backToCompanies">חזרה לחברות המרכזיות</button>
    </div>`;
}

/* --- מסך 3: אני לא יודע --- */
function wizScreenUnknown() {
  return `
    <h2 class="wiz-title">איפה אפשר למצוא את שם החברה?</h2>
    <ul class="wiz-hints">
      <li><strong>תלוש השכר</strong> — בשורת ההפרשות לפנסיה ולהשתלמות מופיע שם החברה המנהלת.</li>
      <li><strong>הדוח התקופתי</strong> — מגיע בדואר או במייל, ושם החברה מופיע בראש העמוד.</li>
      <li><strong>האזור האישי</strong> — באתר חברת הביטוח, קרן הפנסיה או בית ההשקעות.</li>
    </ul>
    <p class="wiz-note">הכלי אינו מתחבר למסלקה הפנסיונית ואינו מושך נתונים אישיים — הוא עוזר לך לאתר את הקופה במאגר הציבורי ולהזין את היתרה בעצמך.</p>
    <div class="wiz-links">
      <button type="button" class="wiz-link wiz-link-strong" data-wiz="typeFirst">אני יודע רק מה סוג החיסכון</button>
      <a class="wiz-link" href="https://www.gov.il/he/service/pension_savings_search" target="_blank" rel="noopener noreferrer">איתור חסכונות בהר הכסף</a>
      <button type="button" class="wiz-link" data-wiz="backToCompanies">חזרה</button>
    </div>`;
}

/* --- מסך 4: סוג החיסכון --- */
function wizProductButton(key) {
  const item = PRODUCT_TYPES.filter(entry => entry.key === key)[0];
  if (!item) return '';
  return `
    <button type="button" class="wiz-choice" data-wiz="product" data-value="${escapeHtml(item.key)}">
      <span class="wiz-choice-title">${escapeHtml(item.label)}</span>
      <span class="wiz-choice-hint">${escapeHtml(item.hint)}</span>
    </button>`;
}
function wizScreenProduct() {
  const keys = wizard.company ? productsForBrand(wizard.company) : PRODUCT_ORDER.slice();
  const primary = keys.slice(0, PRIMARY_PRODUCTS_SHOWN);
  const extra = keys.slice(PRIMARY_PRODUCTS_SHOWN);
  const title = wizard.company ? 'מה סוג החיסכון?' : 'מה סוג החיסכון שלך?';
  const sub = wizard.company
    ? `אלה סוגי החיסכון שמנוהלים ב${escapeHtml(wizard.company)}.`
    : 'נמצא לפי הסוג, ואחר כך נבחר את החברה.';
  return `
    <h2 class="wiz-title">${title}</h2>
    <p class="wiz-sub">${sub}</p>
    <div class="wiz-choices">
      ${primary.map(wizProductButton).join('')}
      ${extra.length ? `
        <button type="button" class="wiz-choice wiz-choice-more" data-wiz="moreProducts">
          <span class="wiz-choice-title">סוג אחר</span>
          <span class="wiz-choice-hint">מוצרים נוספים שמנוהלים בחברה</span>
        </button>
        <div class="wiz-choices wiz-choices-extra" id="wizExtraProducts" ${wizard.showExtraProducts ? '' : 'hidden'}>
          ${extra.map(wizProductButton).join('')}
        </div>` : ''}
    </div>`;
}

/* --- מסך 5: מסלולים --- */
function wizResultCard(rec) {
  const chosen = userFunds.some(item => item.fund && item.fund.uid === rec.uid);
  return `
    <div class="wiz-result${chosen ? ' is-chosen' : ''}">
      <div class="wiz-result-body">
        <div class="wiz-result-name">${escapeHtml(rec.fund_name)}</div>
        <div class="wiz-result-meta">${escapeHtml(trackLabel(rec))}</div>
        <div class="wiz-result-id">מספר קופה ${escapeHtml(rec.fund_id || '')}</div>
      </div>
      <button type="button" class="wiz-pick" data-wiz="pick" data-value="${escapeHtml(rec.uid)}">${chosen ? 'ערוך' : 'בחר'}</button>
    </div>`;
}
function wizFilteredResults() {
  const scope = wizard.globalSearch
    ? DATA.filter(isSelectableFund)
    : fundsInScope(wizard.company, wizard.product);
  const term = normalizeText(wizard.query);
  let list = scope;
  if (wizard.chip) list = list.filter(rec => trackTags(rec).indexOf(wizard.chip) > -1);
  if (term) {
    list = list.filter(rec => {
      const text = rec._searchText || normalizeText(rec.fund_name);
      return text.indexOf(term) > -1 || (rec.fund_id || '') === wizard.query.trim();
    });
  }
  return rankTracks(list);
}
function wizScreenResults() {
  const results = wizFilteredResults();
  const visible = results.slice(0, wizard.limit);
  const chipCounts = {};
  fundsInScope(wizard.company, wizard.product).forEach(rec => {
    trackTags(rec).forEach(tag => { chipCounts[tag] = (chipCounts[tag] || 0) + 1; });
  });
  const chips = TRACK_CHIPS.filter(chip => chipCounts[chip.key]).slice(0, 7);

  let body;
  if (!visible.length) {
    body = `
      <div class="wiz-empty">
        <p class="wiz-empty-title">לא מצאנו מסלול שמתאים לחיפוש</p>
        <p class="wiz-empty-note">אפשר לנסות מילה קצרה יותר, לנקות את הסינון, או לחפש בכל החברות.</p>
        <div class="wiz-links">
          <button type="button" class="wiz-link" data-wiz="clearFilters">נקה סינון</button>
          ${wizard.globalSearch ? '' : '<button type="button" class="wiz-link wiz-link-strong" data-wiz="globalSearch">חפש בכל החברות</button>'}
        </div>
      </div>`;
  } else {
    body = `<div class="wiz-results">${visible.map(wizResultCard).join('')}</div>`;
  }

  const disclosure = wizard.expanded
    ? `
      <div class="wiz-disclosure">
        ${chips.length ? `<div class="wiz-chips">
          ${chips.map(chip => `<button type="button" class="wiz-chip${wizard.chip === chip.key ? ' is-on' : ''}" data-wiz="chip" data-value="${escapeHtml(chip.key)}">${escapeHtml(chip.label)}</button>`).join('')}
        </div>` : ''}
        <div class="wiz-field">
          <input type="text" id="wizTrackSearch" class="wiz-input" placeholder="חיפוש לפי שם המסלול או מספר קופה" value="${escapeHtml(wizard.query)}" autocomplete="off" />
        </div>
        ${results.length > visible.length ? '<button type="button" class="wiz-more" data-wiz="more">הצג עוד מסלולים</button>' : ''}
      </div>`
    : `<button type="button" class="wiz-link wiz-not-found" data-wiz="expand">לא מצאת את שלך?</button>`;

  const title = wizard.globalSearch ? 'חיפוש בכל החברות' : 'נתחיל מהמסלולים הנפוצים';
  return `
    <h2 class="wiz-title">${title}</h2>
    <p class="wiz-sub">בחר את המסלול שמופיע בדוח שלך, ואז נזין את היתרה.</p>
    ${body}
    ${disclosure}`;
}

/* --- פירורי לחם --- */
function wizRenderCrumbs() {
  const wrap = document.getElementById('wizCrumbs');
  if (!wrap) return;
  const parts = [];
  if (wizard.company) {
    parts.push(`<button type="button" class="wiz-crumb" data-wiz="crumbCompany">${escapeHtml(wizard.company)}</button>`);
  }
  if (wizard.product && wizard.step === 'results') {
    parts.push(`<button type="button" class="wiz-crumb" data-wiz="crumbProduct">${escapeHtml(PRODUCT_LABEL[wizard.product] || '')}</button>`);
  }
  wrap.innerHTML = parts.length
    ? `<span class="wiz-crumb-sep-wrap">${parts.join('<span class="wiz-crumb-sep" aria-hidden="true">›</span>')}</span>
       <button type="button" class="wiz-crumb wiz-crumb-reset" data-wiz="reset">התחל מחדש</button>`
    : '';
}

function wizRender() {
  const screen = document.getElementById('wizScreen');
  if (!screen) return;
  let html = '';
  if (wizard.step === 'allCompanies') html = wizScreenAllCompanies();
  else if (wizard.step === 'unknown') html = wizScreenUnknown();
  else if (wizard.step === 'product' || wizard.step === 'typeFirst') html = wizScreenProduct();
  else if (wizard.step === 'results') html = wizScreenResults();
  else html = wizScreenCompany();
  screen.innerHTML = html;
  wizRenderCrumbs();
  wizRestoreFocus();
}

// שמירת מיקוד וסמן בשדות החיפוש אחרי רינדור מחדש.
let WIZ_FOCUS_FIELD = '';
function wizRestoreFocus() {
  if (!WIZ_FOCUS_FIELD) return;
  const field = document.getElementById(WIZ_FOCUS_FIELD);
  if (!field) { WIZ_FOCUS_FIELD = ''; return; }
  field.focus({ preventScroll: true });
  const end = field.value.length;
  try { field.setSelectionRange(end, end); } catch (error) { /* שדה שאינו תומך */ }
}

function wizAfterCompany(name) {
  const products = productsForBrand(name);
  // סוג יחיד אצל החברה — אין מה לשאול, קופצים ישר למסלולים.
  if (products.length === 1) {
    wizSet({ company: name, product: products[0], step: 'results', chip: '', query: '', expanded: false, limit: RESULTS_PAGE, globalSearch: false });
    return;
  }
  wizSet({ company: name, product: '', step: 'product', expanded: false });
}

function wizHandle(action, value) {
  if (action === 'company') {
    if (wizard.product) {
      wizSet({ company: value, step: 'results', chip: '', query: '', expanded: false, limit: RESULTS_PAGE, globalSearch: false });
      return;
    }
    wizAfterCompany(value);
    return;
  }
  if (action === 'allCompanies') { WIZ_FOCUS_FIELD = 'wizCompanySearch'; wizSet({ step: 'allCompanies', companyQuery: '' }); return; }
  if (action === 'backToCompanies') { WIZ_FOCUS_FIELD = ''; wizSet({ step: 'company', companyQuery: '' }); return; }
  if (action === 'unknown') { wizSet({ step: 'unknown' }); return; }
  if (action === 'typeFirst') { wizSet({ step: 'typeFirst', company: '', product: '', expanded: false }); return; }
  if (action === 'moreProducts') { wizSet({ showExtraProducts: !wizard.showExtraProducts }); return; }
  if (action === 'product') {
    if (wizard.step === 'typeFirst') { wizSet({ product: value, step: 'company', expanded: false }); return; }
    wizSet({ product: value, step: 'results', chip: '', query: '', expanded: false, limit: RESULTS_PAGE, globalSearch: false });
    return;
  }
  if (action === 'expand') { WIZ_FOCUS_FIELD = ''; wizSet({ expanded: true }); return; }
  if (action === 'chip') { wizSet({ chip: wizard.chip === value ? '' : value, limit: RESULTS_PAGE }); return; }
  if (action === 'more') { wizSet({ limit: wizard.limit + RESULTS_PAGE }); return; }
  if (action === 'clearFilters') { WIZ_FOCUS_FIELD = ''; wizSet({ chip: '', query: '', limit: RESULTS_PAGE }); return; }
  if (action === 'globalSearch') { wizSet({ globalSearch: true, limit: RESULTS_PAGE }); return; }
  if (action === 'crumbCompany') { wizSet({ step: 'company', product: '', chip: '', query: '', expanded: false, globalSearch: false }); return; }
  if (action === 'crumbProduct') { wizSet({ step: 'product', chip: '', query: '', expanded: false, globalSearch: false }); return; }
  if (action === 'reset') { wizReset(); return; }
  if (action === 'pick') {
    const rec = DATA.filter(item => item.uid === value)[0];
    if (rec) addFund(rec);
    return;
  }
}

document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-wiz]');
  if (!trigger || !document.getElementById('wizard') || !document.getElementById('wizard').contains(trigger)) return;
  event.preventDefault();
  wizHandle(trigger.dataset.wiz, trigger.dataset.value || '');
});
document.addEventListener('input', event => {
  if (event.target.id === 'wizCompanySearch') {
    WIZ_FOCUS_FIELD = 'wizCompanySearch';
    wizSet({ companyQuery: event.target.value });
  }
  if (event.target.id === 'wizTrackSearch') {
    WIZ_FOCUS_FIELD = 'wizTrackSearch';
    wizSet({ query: event.target.value, limit: RESULTS_PAGE });
  }
});

function wizScrollIntoView() {
  const section = document.getElementById('searchSection');
  if (section && section.scrollIntoView) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


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
    buildWizardIndexes();
    wizRender();
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

  // v4.0: אין יותר מסך פתיחה נפרד — האשף הוא הדבר הראשון בעמוד.
  // אין יותר גם body.landing-started: הוא היה מסתיר את כותרת ההירו ואת כרטיסי המידע.
  function returnToLanding() {
    document.body.classList.remove('dashboard-reached');
    const hero = document.querySelector('.premium-hero');
    if (hero) hero.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  window.returnToLanding = returnToLanding;
  window.closeLandingPanels = closeLandingPanels;

  window.enterDashboardView = function() {
    closeLandingPanels('');
    document.body.classList.add('dashboard-reached');

    const editor = document.getElementById('quickEditor');
    if (editor) { editor.classList.remove('active'); editor.innerHTML = ''; }

    const portfolio = document.getElementById('portfolioSection');
    if (portfolio) portfolio.style.display = 'none';

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

    if (typeof wizReset === 'function') wizReset();
  };

  const returnBtn = document.getElementById('returnLandingBtn');
  if (returnBtn) returnBtn.addEventListener('click', returnToLanding);
})();

