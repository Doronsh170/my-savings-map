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
  bituach: 'פוליסת חיסכון',
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
// מותג -> שם הקובץ בתיקיית logos, כולל סיומת. חברה שאינה כאן, וכן כל כשל
// טעינה, מוצגות במונוגרמה. מוסיפים שורה רק אחרי שהקובץ הועלה. פירוט: logos/README.md.
const BRAND_LOGOS = {
  'מנורה מבטחים': 'menora.png',
  'מיטב': 'meitav.png',
  'מור': 'mor.png',
  'מגדל': 'migdal.png',
  'כלל': 'clal.png',
  'הראל': 'harel.png',
  'אלטשולר שחם': 'altshuler.png',
  'הפניקס': 'phoenix.png',
  'אנליסט': 'analyst.png',
  'ילין לפידות': 'yelin.png',
  'איילון': 'ayalon.png'
};

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
  { key: 'gemel',       label: 'קופת גמל',         hint: 'חיסכון פנסיוני שאינו קרן פנסיה, נמשך בדרך כלל כקצבה' },
  { key: 'hishtalmut',  label: 'קרן השתלמות',      hint: 'נפתחת דרך המעסיק, וניתנת למשיכה אחרי שש שנים' },
  { key: 'invest',      label: 'גמל להשקעה',       hint: 'חיסכון פרטי שאפשר למשוך בכל עת' },
  { key: 'insurance',   label: 'פוליסת חיסכון',    hint: 'חיסכון פיננסי בחברת ביטוח, שנפתח לרוב דרך סוכן' },
  { key: 'child',       label: 'חיסכון לכל ילד',   hint: 'החיסכון שנפתח לילד עם קצבת הילדים' },
  { key: 'pitzuim',     label: 'מרכזית לפיצויים',  hint: 'קופה על שם המעסיק לכיסוי פיצויי פיטורים' }
];
const PRODUCT_LABEL = {};
PRODUCT_TYPES.forEach(item => { PRODUCT_LABEL[item.key] = item.label; });
const PRODUCT_ORDER = PRODUCT_TYPES.map(item => item.key);
// חמשת סוגי החיסכון הראשיים גלויים; השאר מתקפלים תחת "סוג אחר".
const PRIMARY_PRODUCTS_SHOWN = 5;

function productOf(rec) {
  const cls = String(rec.classification || '');
  if (rec.source === 'pensia') return 'pensia';
  // ביטוח נט אינו מסמן אילו מסלולים שייכים לביטוח מנהלים: ה-classification מתאר
  // תקופת הנפקה בלבד. לכן הקטגוריה מציגה פוליסות חיסכון בלבד (ראו
  // isLegacyInsurancePolicy), ולא מתיימרת לזהות ביטוחי מנהלים.
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

/* === סוג המסלול לתצוגה ולסינון ===
   משמש את תווית המסלול באשף ואת צ'יפי הסינון. אינו משמש לבניית קבוצת
   ההשוואה — זו נקבעת ב-cmpCategory, בנפרד, ואינה מושפעת מכאן.
   המקור, לפי סדר העדיפות:
   1. שיעור מניות מפורש בשם או בתת-ההתמחות ("עד 25% מניות", "ללא מניות").
   2. בגמל-נט: הסיווג הרשמי (תת-התמחות, ואם אין — התמחות).
   3. בפנסיה-נט ובביטוח-נט: ביטויים מפורשים בשם המסלול בלבד.
   הופעת המילה "מניות" בשם אינה מספיקה: "אג״ח עם מניות (עד 25% מניות)" אינו
   מסלול מנייתי. מסלול בלי סיווג אמין מוצג בלי תווית — רק בשמו המקורי.
   החשיפה המדווחת אינה פוסלת תווית: היא נכונה לחודש מסוים, והמדיניות או
   הסיווג הרשמי הם שקובעים את סוג המסלול. פער ביניהם הוא סימן לבדיקת איכות
   נתונים (tools/track_report.cjs), לא הוכחה שהתווית שגויה. */
const TRACK_KIND_LABEL = {
  general: 'מסלול כללי', equity: 'מסלול מנייתי', sp500: 'מסלול עוקב מדד S&P 500',
  index_equity: 'מסלול עוקב מדדי מניות', index_flex: 'מסלול עוקב מדדים גמיש', index_bond: 'מסלול עוקב מדדי אג״ח',
  bond: 'מסלול אג״ח', bond_equity: 'מסלול אג״ח עם רכיב מניות', no_stock: 'מסלול ללא מניות',
  money: 'מסלול כספי', halacha: 'מסלול הלכתי', esg: 'מסלול קיימות', foreign: 'מסלול חו״ל',
  mixed_tradable: 'מסלול משולב סחיר', personal: 'מסלול בניהול אישי', annuity_existing: 'מסלול קצבה לזכאים קיימים',
  age50: 'מסלול לפי גיל · עד 50', age5060: 'מסלול לפי גיל · 50 עד 60', age60: 'מסלול לפי גיל · 60 ומעלה',
  target: 'מסלול יעד לפרישה', guaranteed: 'מסלול מבטיח תשואה',
  child_low: 'חיסכון לילד · סיכון מועט', child_mid: 'חיסכון לילד · סיכון בינוני', child_high: 'חיסכון לילד · סיכון גבוה'
};
// תת-ההתמחות הרשמית בגמל-נט, אחרי normalizeText. ערך שאינו כאן ("מדד",
// "ישראל", "פאסיבי") אינו מספיק כדי לקבוע סוג.
const GEMEL_KIND = {
  'כללי': 'general',
  'אשראי ואגח': 'bond', 'אגח': 'bond', 'אגח ממשלות': 'bond', 'אגח ממשלתי': 'bond', 'ממשלתי': 'bond',
  'אגח קונצרניות': 'bond', 'אגח סחיר': 'bond', 'אגח צמוד מדד': 'bond', 'אגח צמוד מדד בינוני': 'bond', 'אגח לא צמוד': 'bond',
  'משולב מניות': 'bond_equity',
  'מניות': 'equity', 'מניות סחיר': 'equity', 'מניות ישראל': 'equity',
  'עוקב מדד s and p 500': 'sp500', 'עוקב מדדי מניות': 'index_equity',
  'עוקב מדדים גמיש': 'index_flex', 'עוקב מדדי אגח': 'index_bond',
  'כספי שקלי': 'money', 'שקלי': 'money', 'שקלי טווח קצר': 'money',
  'הלכה יהודית': 'halacha', 'הלכה איסלאמית': 'halacha',
  'עד 50': 'age50', '50 60': 'age5060', '60 ומעלה': 'age60',
  'קיימות': 'esg', 'חול': 'foreign', 'מבטיח תשואה': 'guaranteed', 'משולב סחיר': 'mixed_tradable',
  'חיסכון לילד חוסכים המעדיפים סיכון מועט': 'child_low',
  'חיסכון לילד חוסכים המעדיפים סיכון בינוני': 'child_mid',
  'חיסכון לילד חוסכים המעדיפים סיכון גבוה': 'child_high'
};
// בפנסיה ובביטוח: הכלל הראשון שמתאים לשם קובע.
const TRACK_NAME_RULES = [
  ['annuity_existing', /קצבה לזכאים קיימים/],
  ['target', /יעד לפרישה|יעד פרישה/],
  ['age50', /עד 50|50 ומטה|לבני 50 ומטה|גילאי 50 ומטה|עד גיל 50/],
  ['age5060', /\b50 60\b|50 עד 60|גילאי 50 עד 60|לבני 50 60/],
  ['age60', /60 ומעלה|מעל 60|לבני 60|גילאי 60/],
  ['sp500', /s and p(?![a-z])|sp ?500/],
  ['index_equity', /עוקב מדדי מניות|מחקה מדד (תל אביב|ת ?א)|ת ?א ?35|נאסדק|msci/],
  ['index_flex', /עוקב מדדים גמיש/],
  ['index_bond', /עוקב מדדי אגח|(מחקה|עוקב) מדד.*(ממשלת|אגח|אג ח|שקלי|ריבית)/],
  ['halacha', /הלכ|שריעה|איסלאמ/],
  // "ללא אג״ח" אינו מסלול אג״ח, ואין בשם די מידע לסוג אחר.
  ['', /ללא אג ?ח/],
  ['bond', /אגח|אג ח|אשראי|ממשלת/],
  ['money', /כספי|שקלי/],
  ['equity', /(^|\s)מניות($|\s)|מנייתי/],
  ['esg', /קיימות/],
  ['mixed_tradable', /משולב סחיר/],
  ['foreign', /(^|\s)חול($|\s)/],
  ['general', /(^|\s)כללי($|\s)/]
];
const BOND_WORDS = /אגח|אג ח|אשראי|ממשלת/;
/* הסבר קצר למונח רשמי שאינו מוכר לכולם. "משולב סחיר": לפי מסמכי המדיניות
   שהחברות מפרסמות למסלול — נכסים סחירים בלבד, תמהיל מניות ואג״ח. */
const TRACK_KIND_NOTE = {
  mixed_tradable: 'משקיע רק בנכסים שנסחרים בבורסה, בתמהיל של מניות ואג״ח בישראל ובחו״ל. שיעור המניות שונה ממסלול למסלול.',
  personal: 'ההשקעות נקבעות לפי הוראות העמית, ולכן אין למסלול מדיניות השקעה אחידה.'
};
function classifyTrack(rec) {
  const name = normalizeText(rec.fund_name);
  const sub = rec.source === 'gemelnet' ? normalizeText(rec.sub_specialization) : '';
  const spec = rec.source === 'gemelnet' ? normalizeText(rec.specialization) : '';
  const text = name + ' ' + sub;
  let kind = '';
  let cap = null;
  const capMatch = text.match(/עד (\d{1,2}) ?(%|אחוז)/);
  // בניהול אישי / IRA: מציינים זאת, בלי להסיק מדיניות השקעה.
  if (/בניהול אישי|בניהול עצמי|\bira\b/.test(name)) kind = 'personal';
  else if (/ללא מניות/.test(text)) kind = 'no_stock';
  else if (capMatch && /מני/.test(text)) {
    cap = Number(capMatch[1]);
    kind = BOND_WORDS.test(name + ' ' + sub + ' ' + spec) ? 'bond_equity' : 'capped';
  } else if (rec.source === 'gemelnet') {
    kind = GEMEL_KIND[sub] || GEMEL_KIND[spec] || '';
  } else {
    const rule = TRACK_NAME_RULES.find(([, pattern]) => pattern.test(name));
    kind = rule ? rule[0] : '';
    if (kind === 'bond' && /מני/.test(name)) kind = 'bond_equity';
  }
  if (!kind) cap = null;
  // הסיווג הרשמי בגמל-נט "כללי": התקרה או "ללא מניות" מוצגות לצידו, בלי להפוך
  // את המסלול למסלול אג״ח.
  const general = rec.source === 'gemelnet' && spec === 'כללי' && (kind === 'capped' || kind === 'no_stock');
  const pensioners = /מקבלי קצבה|לפנסיונרים|למקבלי פנסיה/.test(name);
  return { kind, cap, pensioners, general };
}
function trackKindOf(rec) {
  if (!rec._trackKind) rec._trackKind = classifyTrack(rec);
  return rec._trackKind;
}
/* התווית שמוצגת ליד שם המסלול. מחרוזת ריקה = אין סיווג אמין. */
function trackLabel(rec) {
  const { kind, cap, pensioners, general } = trackKindOf(rec);
  let label = '';
  if (kind === 'bond_equity') label = cap !== null ? `מסלול אג״ח · עד ${cap}% מניות` : TRACK_KIND_LABEL.bond_equity;
  else if (general) label = kind === 'capped' ? `מסלול כללי · עד ${cap}% מניות` : 'מסלול כללי · ללא מניות';
  else if (kind === 'capped') label = `מסלול עד ${cap}% מניות`;
  else label = TRACK_KIND_LABEL[kind] || '';
  if (pensioners) label = label ? label + ' · למקבלי קצבה' : 'מסלול למקבלי קצבה';
  return label;
}

function trackNote(rec) {
  return TRACK_KIND_NOTE[trackKindOf(rec).kind] || '';
}

// צ'יפי הסינון באשף. כל צ'יפ מכיל סוגי מסלול מתוך classifyTrack.
const TRACK_CHIPS = [
  { key: 'general', label: 'כללי',          kinds: ['general'] },
  { key: 'age50',   label: 'עד גיל 50',     kinds: ['age50'] },
  { key: 'age5060', label: 'גיל 50–60',     kinds: ['age5060'] },
  { key: 'age60',   label: 'גיל 60 ומעלה',  kinds: ['age60'] },
  { key: 'equity',  label: 'מניות',         kinds: ['equity', 'index_equity'] },
  { key: 'index',   label: 'עוקב מדד',      kinds: ['sp500', 'index_equity', 'index_flex', 'index_bond'] },
  { key: 'sp500',   label: 'S&P 500',       kinds: ['sp500'] },
  { key: 'bond',    label: 'אג״ח',          kinds: ['bond', 'bond_equity', 'index_bond'] },
  { key: 'money',   label: 'כספי',          kinds: ['money'] },
  { key: 'halacha', label: 'הלכתי',         kinds: ['halacha'] }
];
function trackTags(rec) {
  const { kind } = trackKindOf(rec);
  return TRACK_CHIPS.filter(chip => chip.kinds.indexOf(kind) > -1).map(chip => chip.key);
}

// --- אינדקסים שנבנים פעם אחת ---
let BRANDS = [];
let BRAND_BY_NAME = {};

// פוליסות שהונפקו לפני 2004 ("קרן ח'/ט'/י'" ודומותיהן) הן פוליסות ביטוח מנהלים
// ותיקות, והמאגר אינו מאפשר לזהות אותן מול פוליסות חיסכון. כדי שהקטגוריה תכיל
// פוליסות חיסכון בלבד, הן אינן ניתנות לבחירה. קופה כזו שכבר נשמרה בתיק ממשיכה
// להיטען ולהיספר, כדי שיתרה שהוזנה לא תימחק.
function isLegacyInsurancePolicy(rec) {
  return rec.source === 'bituach' && String(rec.classification || '').indexOf('2004') === -1;
}

function isSelectableFund(rec) {
  return rec.is_active && (Number(rec.total_assets) || 0) > 0 && !isLegacyInsurancePolicy(rec);
}

function buildWizardIndexes() {
  const map = {};
  DATA.forEach(rec => {
    // השדות הנגזרים מחושבים גם לקופות שאינן ניתנות לבחירה, כדי שקופה שנשמרה
    // בתיק בעבר תמשיך להציג מותג וסוג מוצר; האינדקס עצמו נבנה מהבחירות בלבד.
    rec._brand = brandOf(rec);
    rec._product = productOf(rec);
    rec._trackKind = classifyTrack(rec);
    rec._searchText = normalizeText([rec.fund_name, rec.fund_id, rec.specialization, rec.sub_specialization, rec.classification].filter(Boolean).join(' '));
    if (!isSelectableFund(rec)) return;
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

/* === השוואה למסלולים דומים =======================================
   הסיווג דטרמיניסטי: לכל מסלול קטגוריית השוואה אחת, נגזרת מהשדות
   הרשמיים (גמל-נט) או משם המסלול (פנסיה-נט וביטוח-נט). שתי קבוצות
   נפרדות: תשואה נקבעת ממדיניות ההשקעה בלבד, ודמי ניהול מושווים בתוך
   אותה אוכלוסיית יעד, כי הסכם סקטוריאלי משפיע על המחיר ולא על המדיניות. */

const CMP_MIN_PEERS = 5;
const CMP_TENURE_MONTHS = 36;   // ותק נדרש כדי להיכלל בממוצע התשואה
const CMP_EXPOSURE_GAP = 20;    // נק׳ אחוז מחשיפת המסלול הנבדק, באפיקים הגמישים בלבד
const CMP_EXPOSURE_MIN_MONTHS = 18;

// סוגי מוצר שלעולם אינם מתערבבים זה בזה.
const CMP_PRODUCT_LABEL = {
  hishtalmut: 'קרן השתלמות', gemel: 'קופת גמל', invest: 'גמל להשקעה',
  child: 'חיסכון לכל ילד', pitzuim: 'מרכזית לפיצויים',
  pension_new: 'קרן פנסיה מקיפה', pension_general: 'קרן פנסיה כללית',
  policy: 'פוליסת חיסכון'
};
function cmpProduct(rec) {
  if (rec.source === 'pensia') return String(rec.classification || '').indexOf('חדשות') > -1 ? 'pension_new' : 'pension_general';
  if (rec.source === 'bituach') return 'policy';
  return rec._product === 'pensia' ? 'gemel' : rec._product;
}
function cmpPopulation(rec) {
  const t = normalizeText(rec.target_population);
  if (!t || t.indexOf('כלל האוכלוסי') > -1) return 'public';
  if (t.indexOf('סקטור') > -1) return 'sector';
  if (t.indexOf('מפעל') > -1 || t.indexOf('גוף') > -1) return 'workplace';
  return 'other';
}

// וטו על שם המסלול, לפני כל השאר: השדות הרשמיים בגמל-נט גסים מדי. קופה
// ששמה "אג״ח עד 25% מניות" מסווגת שם "מניות", ומסלול בניהול אישי "כללי".
// הווטו נבדק על השם, ובגמל-נט גם על תת-ההתמחות הרשמית: "ללא מניות" ו"עד 10%
// מניות" מופיעים שם, והכלל "מניות" היה משייך אותם למסלולים המנייתיים.
const CMP_PERSONAL = /בניהול אישי|בניהול עצמי|\bira\b/;
const CMP_STOCK_LIMIT = /ללא מניות|עד \d+ ?(%|אחוז) ?ב?(מניות|מנית)/;   // "במנית" — שגיאת כתיב במאגר
const CMP_NAME_VETO = [
  ['personal', CMP_PERSONAL],
  ['unclassified', /ללא אג ?ח/],
  ['bonds_credit', /ללא מניות/],
  ['bonds_equity_sleeve', /עד \d+ ?(%|אחוז) ?ב?(מניות|מנית)/],
  ['bonds_credit', /(מחקה|עוקב) מדד.*(ממשלת|אג ?ח|שקלי|צמוד|ריבית)/],
  ['bonds_equity_sleeve', /(אג ?ח|אשראי).*מניות/]
];
// הכלל הראשון שמתאים קובע. הסדר הוא ההגדרה.
const CMP_RULES = [
  ['pensioners', /מקבלי קצבה|לפנסיונרים|למקבלי פנסיה/],
  ['guaranteed', /מבטיח תשואה/],
  ['annuity_existing', /קצבה לזכאים/],
  ['personal', /בניהול אישי|בניהול עצמי|\bira\b/],
  ['target_date', /יעד לפרישה|יעד פרישה/],
  ['child_low', /חיסכון לילד.*סיכון מועט/],
  ['child_mid', /חיסכון לילד.*סיכון בינוני/],
  ['child_high', /חיסכון לילד.*סיכון גבוה/],
  ['age_under_50', /עד 50|50 ומטה|לבני 50 ומטה|גילאי 50 ומטה/],
  ['age_50_60', /\b50 60\b|50 עד 60|גילאי 50 עד 60|לבני 50 60/],
  ['age_60_plus', /60 ומעלה|מעל 60|לבני 60|גילאי 60/],
  ['esg', /קיימות|אחראי/],
  ['sp500', /s&p ?500|s and p ?500|sp ?500|מדד 500|s&p|s and p(?![a-z])/],
  ['index_equity', /עוקב מדדי מניות|עוקב מדד מניות|מחקה מדד|תל אביב|ת ?א 35|נאסדק|msci/],
  ['bonds_credit', /אג ?ח|אגח|אשראי|ממשלת|ממשלתי|צמוד מדד/],
  ['equity', /(^|\s)מניות($|\s)|מנייתי|משולב מניות/],
  ['money_market', /כספי|שקלי/],
  ['halacha', /הלכ|שריעה|איסלאמ|מסורת/],
  ['foreign', /(^|\s)חו ל($|\s)|(^|\s)חול($|\s)|גלובלי/],
  ['index_mixed', /עוקב מדדים/],
  ['mixed_tradable', /משולב/],
  ['general', /(^|\s)כללי($|\s)|מדרגות|חכ ?מ|גמיש/]
];
const CMP_CATEGORY_LABEL = {
  general: 'מסלול כללי', general_capped: 'כללי עם תקרת מניות', general_no_stock: 'כללי ללא מניות', equity: 'מסלול מנייתי', sp500: 'עוקב S&P 500',
  index_equity: 'עוקב מדדי מניות', index_mixed: 'עוקב מדדים', mixed_tradable: 'משולב סחיר',
  bonds_credit: 'אג״ח ואשראי', bonds_equity_sleeve: 'אג״ח עם רכיב מניות',
  money_market: 'כספי / שקלי', age_under_50: 'לפי גיל — עד 50',
  age_50_60: 'לפי גיל — 50 עד 60', age_60_plus: 'לפי גיל — 60 ומעלה',
  target_date: 'יעד לפרישה', halacha: 'מסלול הלכתי', esg: 'קיימות',
  foreign: 'חו״ל', pensioners: 'למקבלי קצבה', annuity_existing: 'קצבה לזכאים קיימים',
  guaranteed: 'מבטיח תשואה', personal: 'בניהול אישי',
  child_low: 'לילד — סיכון מועט', child_mid: 'לילד — סיכון בינוני', child_high: 'לילד — סיכון גבוה'
};

function cmpCategory(rec) {
  const name = normalizeText(rec.fund_name);
  const sub = rec.source === 'gemelnet' ? normalizeText(rec.sub_specialization) : '';
  // סיווג רשמי "כללי" עם תקרת מניות או "ללא מניות": התקרה אינה הופכת את המסלול
  // למסלול אג״ח. "ללא מניות" ו"עד N% מניות" הן מדיניות שונות, ולכן שתי קבוצות
  // נפרדות; השוואה מוצגת רק אם יש בקבוצה די מסלולים (CMP_MIN_PEERS).
  const officialGeneral = rec.source === 'gemelnet' && normalizeText(rec.specialization) === 'כללי';
  if (officialGeneral && !CMP_PERSONAL.test(name) && CMP_STOCK_LIMIT.test(name + ' ' + sub)) {
    return /ללא מניות/.test(name + ' ' + sub) ? 'general_no_stock' : 'general_capped';
  }
  for (const [key, pattern] of CMP_NAME_VETO) {
    if (pattern.test(name) || (sub && pattern.test(sub))) return key;
  }
  // גמל-נט מפרסם סיווג רשמי; בפנסיה ובביטוח השם הוא כל מה שיש.
  const texts = rec.source === 'gemelnet'
    ? [normalizeText(rec.sub_specialization), normalizeText(rec.specialization), name]
    : [name];
  for (const text of texts) {
    if (!text) continue;
    for (const [key, pattern] of CMP_RULES) {
      if (pattern.test(text)) {
        if (key !== 'target_date') return key;
        const year = text.match(/20\d\d/);
        return year ? 'target_date_' + year[0] : 'target_date';
      }
    }
  }
  return 'unclassified';
}

/* חשיפה ממוצעת לאורך עד 24 חודשים. חשיפה של חודש בודד תנודתית מדי מכדי
   להוציא מסלול מהשוואה, ולכן נדרשים לפחות 18 חודשי נתונים. */
function cmpAvgExposure(rec) {
  const series = (rec.hist_stock || []).filter(v => typeof v === 'number');
  if (series.length < CMP_EXPOSURE_MIN_MONTHS) return null;
  return series.reduce((sum, v) => sum + v, 0) / series.length;
}
/* ותק בחודשים. היכן שאין תאריך הקמה (ביטוח-נט) משמש חודש הדיווח הראשון
   שנראה במאגר, שמצטבר מעדכון לעדכון. */
function cmpTenureMonths(rec) {
  const period = Number(rec.report_period);
  if (!period) return null;
  const inception = rec.inception_date;
  if (inception && inception.length >= 7) {
    return monthDiff(Number(inception.slice(0, 4) + inception.slice(5, 7)), period);
  }
  if (rec.first_seen_period) return monthDiff(Number(rec.first_seen_period), period);
  return null;
}
function cmpHasTenure(rec) {
  const months = cmpTenureMonths(rec);
  return months !== null && months >= CMP_TENURE_MONTHS;
}
function cmpIsComparable(rec) {
  return rec._cmpCategory !== 'unclassified' && rec._cmpCategory !== 'personal';
}
/* מסלול שהפסיק לדווח לפני חודשים אינו בר־השוואה: התשואה המצטברת שלו נספרת
   עד חודש הדיווח שלו, ולא עד החודש שכל השאר מדווחים בו. */
function cmpIsFresh(rec) {
  return monthDiff(rec.report_period, DATASET_MAX_PERIOD) <= 3;
}

/* === קבוצת המדיניות: ממוצע התשואה והחשיפה ===
   ממוצע תשואה וחשיפה מוצג רק מול מסלולים עם אותה מדיניות השקעה, ולא רק אותה
   תווית: אותו סוג מוצר, אותו סוג מסלול (classifyTrack), ובנוסף ההבחנות
   שמשנות את המדיניות — תקרת המניות, "סחיר" מול מנוהל, פאסיבי מול פעיל,
   ממשלתי / אשראי באג״ח, הלכה יהודית / איסלאמית, מניות ישראל, שנת היעד,
   ומסלול למקבלי קצבה. מסלול בניהול אישי, או בלי סוג ברור, אינו מושווה.
   דמי הניהול נשארים בקבוצות _cmpCategory + אוכלוסייה, כמו קודם. */
const CMP_PASSIVE = /עוקב|מחקה|פאסיבי/;
const CMP_INHERENTLY_PASSIVE = { sp500: 1, index_equity: 1, index_flex: 1, index_bond: 1 };
const CMP_POLICY_KIND_LABEL = { base: 'מסלול למקבלי קצבה' };
function cmpPolicy(rec) {
  const { kind, cap, pensioners, general } = trackKindOf(rec);
  if (kind === 'personal' || (!kind && !pensioners)) return '';
  const name = normalizeText(rec.fund_name);
  const sub = rec.source === 'gemelnet' ? normalizeText(rec.sub_specialization) : '';
  const text = name + ' ' + sub;
  const parts = [rec._cmpProduct, kind || 'base'];
  if (cap !== null) parts.push('cap' + cap);
  if (general) parts.push('general');
  if (kind !== 'mixed_tradable' && /סחיר/.test(text)) parts.push('tradable');
  if (!CMP_INHERENTLY_PASSIVE[kind] && CMP_PASSIVE.test(text)) parts.push('passive');
  if (kind === 'equity' && /ישראל/.test(text)) parts.push('israel');
  if (kind === 'index_equity' && /תל אביב|ת ?א ?\d|ת ?א ?35/.test(text)) parts.push('israel');
  if (kind === 'bond' || kind === 'bond_equity') {
    if (/ממשל/.test(text)) parts.push('gov');
    if (/אשראי|קונצרני/.test(text)) parts.push('credit');
  }
  if (kind === 'halacha') parts.push(/איסלאמ|שריעה/.test(text) ? 'islamic' : 'jewish');
  if (kind === 'target') { const year = name.match(/20\d\d/); parts.push(year ? year[0] : 'noyear'); }
  if (pensioners) parts.push('pensioners');
  return parts.join('|');
}

let CMP_YIELD_GROUPS = {};
let CMP_FEE_GROUPS = {};
let CMP_POLICY_GROUPS = {};

function buildComparisonIndexes() {
  CMP_YIELD_GROUPS = {};
  CMP_FEE_GROUPS = {};
  CMP_POLICY_GROUPS = {};
  DATA.forEach(rec => {
    rec._cmpProduct = cmpProduct(rec);
    rec._cmpCategory = cmpCategory(rec);
    rec._cmpPopulation = cmpPopulation(rec);
    rec._cmpExposure = cmpAvgExposure(rec);
    rec._cmpPolicy = cmpPolicy(rec);
    if (isSelectableFund(rec) && cmpIsFresh(rec) && rec._cmpPolicy) {
      (CMP_POLICY_GROUPS[rec._cmpPolicy] = CMP_POLICY_GROUPS[rec._cmpPolicy] || []).push(rec);
    }
    if (!isSelectableFund(rec) || !cmpIsComparable(rec) || !cmpIsFresh(rec)) return;
    const yKey = rec._cmpProduct + '|' + rec._cmpCategory;
    const fKey = yKey + '|' + rec._cmpPopulation;
    (CMP_YIELD_GROUPS[yKey] = CMP_YIELD_GROUPS[yKey] || []).push(rec);
    (CMP_FEE_GROUPS[fKey] = CMP_FEE_GROUPS[fKey] || []).push(rec);
  });
}

function cmpMedian(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function cmpMean(values) {
  const nums = values.filter(v => typeof v === 'number' && isFinite(v));
  return nums.length ? nums.reduce((sum, v) => sum + v, 0) / nums.length : null;
}

/* רק משולב סחיר ועוקב מדדים גמיש דורשים חשיפה דומה למניות.
   משווים לחשיפת המסלול הנבדק, ולא לחציון של אפיק שהרכבו אינו אחיד. */
function cmpNeedsExposureMatch(rec) {
  const { kind } = trackKindOf(rec);
  return kind === 'mixed_tradable' || kind === 'index_flex';
}
function cmpExposurePeers(rec, members) {
  if (!cmpNeedsExposureMatch(rec)) return members;
  if (!Number.isFinite(rec._cmpExposure)) return [];
  const kind = trackKindOf(rec).kind;
  return members.filter(r => trackKindOf(r).kind === kind &&
    Number.isFinite(r._cmpExposure) &&
    Math.abs(r._cmpExposure - rec._cmpExposure) <= CMP_EXPOSURE_GAP);
}

function cmpGroupLabel(rec, withPopulation) {
  let label = (CMP_PRODUCT_LABEL[rec._cmpProduct] || '') + ' · ' + (CMP_CATEGORY_LABEL[rec._cmpCategory] || 'מסלול');
  if (withPopulation) {
    if (rec._cmpPopulation === 'sector') label += ' · לעובדי סקטור';
    if (rec._cmpPopulation === 'workplace') label += ' · לעובדי מקום עבודה';
  }
  return label;
}

/* אותה מדיניות ואותו חודש דיווח. התאמת אחוז המניות חלה רק
   במשולב סחיר ובעוקב מדדים גמיש, ודורשת לפחות 18 חודשי חשיפה. */
function cmpPolicyPeers(rec) {
  if (!rec._cmpPolicy) return null;
  const period = Number(rec.report_period);
  const members = (CMP_POLICY_GROUPS[rec._cmpPolicy] || [])
    .filter(r => Number(r.report_period) === period && r.uid !== rec.uid);
  return cmpExposurePeers(rec, members);
}

function cmpPolicyLabel(rec) {
  const { kind } = trackKindOf(rec);
  const label = trackLabel(rec) || CMP_POLICY_KIND_LABEL[kind] || 'מסלול';
  const parts = String(rec._cmpPolicy || '').split('|');
  const extra = [parts.includes('tradable') ? 'סחיר' : '', parts.includes('passive') ? 'פאסיבי' : '',
    parts.includes('islamic') ? 'הלכה איסלאמית' : '', parts.includes('israel') ? 'ישראל' : '',
    parts.includes('gov') ? 'ממשלתי' : '', parts.includes('credit') ? 'אשראי' : ''].filter(Boolean);
  return (CMP_PRODUCT_LABEL[rec._cmpProduct] || '') + ' · ' + label + (extra.length ? ' · ' + extra.join(' · ') : '');
}

/* התוצאה שהמסך מציג: הנתון שלך, ממוצע המסלולים הדומים, והפער. */
function compareToPeers(rec, userFee, userDepositFee) {
  if (!rec || !cmpIsFresh(rec)) return null;
  const self = uid => uid !== rec.uid;
  const yieldPeers = cmpPolicyPeers(rec) || [];
  const feePeers = cmpIsComparable(rec)
    ? cmpExposurePeers(rec, CMP_FEE_GROUPS[rec._cmpProduct + '|' + rec._cmpCategory + '|' + rec._cmpPopulation] || [])
      .filter(r => self(r.uid))
    : [];
  if (yieldPeers.length < CMP_MIN_PEERS && feePeers.length < CMP_MIN_PEERS) return null;

  const out = {
    yieldGroup: cmpPolicyLabel(rec), yieldCount: yieldPeers.length,
    feeGroup: cmpGroupLabel(rec, true), feeCount: feePeers.length,
    isPension: rec.source === 'pensia', rows: []
  };

  // תשואה: רק מסלולים עם שלוש שנות ותק נספרים. השדה מוגדר במקור כתשואה
  // מצטברת לשלוש שנים, ומסלול צעיר מדווח בו תקופה קצרה יותר.
  const aged = yieldPeers.filter(cmpHasTenure);
  if (cmpHasTenure(rec) && aged.length >= CMP_MIN_PEERS && typeof rec.yield_trailing_3yrs === 'number') {
    out.rows.push({
      key: 'yield', label: 'תשואה מצטברת ל־3 שנים', digits: 1,
      mine: rec.yield_trailing_3yrs,
      peers: cmpMean(aged.map(r => r.yield_trailing_3yrs)),
      annual: rec.avg_annual_yield_3yrs,
      note: 'תשואת המסלול, מצטברת ל־3 שנים, לפני דמי ניהול.'
    });
  }
  if (feePeers.length >= CMP_MIN_PEERS) {
    out.rows.push({
      key: 'fee', label: out.isPension ? 'דמי ניהול מצבירה' : 'דמי ניהול', digits: 2,
      mine: userFee, fund: rec.avg_annual_management_fee,
      peers: cmpMean(feePeers.map(r => r.avg_annual_management_fee))
    });
    if (out.isPension) {
      out.rows.push({
        key: 'deposit_fee', label: 'דמי ניהול מהפקדות', digits: 2,
        mine: userDepositFee, fund: rec.avg_deposit_fee,
        peers: cmpMean(feePeers.map(r => r.avg_deposit_fee))
      });
    }
  }
  if (yieldPeers.length >= CMP_MIN_PEERS && typeof rec.stock_pct === 'number') {
    out.rows.push({
      key: 'stock', label: 'חשיפה למניות', digits: 0,
      mine: rec.stock_pct, peers: cmpMean(yieldPeers.map(r => r.stock_pct))
    });
  }
  return out.rows.length ? out : null;
}

/* המתודולוגיה נפתחת בחלון "איך מחושבת ההשוואה?": מי שרוצה לדעת איך חושבה
   ההשוואה ימצא, ומי שרק רוצה את המספר לא נתקל בה. */
const CMP_POPULATION_LABEL = { public: 'כלל הציבור', sector: 'עובדי סקטור מסוים', workplace: 'עובדי מקום עבודה מסוים', other: 'אוכלוסייה ייעודית' };
function renderComparisonMethod(item) {
  const cmp = compareToPeers(item.fund, item.managementFee, item.depositFee);
  if (!cmp) return '';
  const f = item.fund;
  const yieldRow = cmp.rows.filter(row => row.key === 'yield')[0];
  const annual = yieldRow && typeof yieldRow.annual === 'number' ? yieldRow.annual : null;
  const fundFees = cmp.rows.filter(row => typeof row.fund === 'number')
    .map(row => `<li>${escapeHtml(row.label)} — הממוצע שנגבה בפועל מכלל העמיתים במסלול שלך: ${row.fund.toFixed(2)}%</li>`).join('');
  return `
    <div class="cmp-method">
      <p>"${CMP_PEERS_TEXT}" הוא ממוצע של קופות שעומדות בכל התנאים האלה:</p>
      <ul>
        <li>אותו סוג מוצר — ${escapeHtml(CMP_PRODUCT_LABEL[f._cmpProduct] || '')}.</li>
        <li>בתשואה ובחשיפה: אותה מדיניות השקעה — ${escapeHtml(cmp.yieldGroup)} — ואותו חודש דיווח.</li>
        <li>התאמת אחוז מניות נדרשת רק במשולב סחיר ובעוקב מדדים גמיש: החשיפה הממוצעת של כל עמית לאורך עד 24 חודשי נתונים צריכה להיות בטווח של ${CMP_EXPOSURE_GAP} נקודות אחוז מהחשיפה הממוצעת של המסלול שלך. נדרשים לפחות ${CMP_EXPOSURE_MIN_MONTHS} חודשי חשיפה לשני המסלולים. בשאר האפיקים אין סינון לפי חשיפה למניות.</li>
        <li>בדמי ניהול: אותה קטגוריית מסלול — ${escapeHtml(CMP_CATEGORY_LABEL[f._cmpCategory] || 'מסלול')} — ואותה אוכלוסיית יעד — ${escapeHtml(CMP_POPULATION_LABEL[f._cmpPopulation] || '')}. הסכם קבוצתי משפיע על המחיר.</li>
        <li>ממוצע פשוט: כל קופה נספרת פעם אחת, בלי שקלול לפי גודל.</li>
        <li>לפחות ${CMP_MIN_PEERS} קופות בקבוצה. אם יש פחות, לא מוצגת השוואה.</li>
      </ul>
      <p>בקבוצה של הקופה שלך: ${cmp.yieldCount} קופות בתשואה ובחשיפה, ${cmp.feeCount} קופות בדמי ניהול. הקופה שלך עצמה אינה נספרת.</p>
      ${fundFees ? `<ul>${fundFees}</ul>` : ''}
      <p>לא נכללות: קופות שלא דיווחו יותר משלושה חודשים ומסלולים בניהול אישי. באפיקים הגמישים בלבד — גם קופה ללא היסטוריית חשיפה מספקת או שאחוז המניות שלה אינו בטווח ההשוואה.</p>
      ${yieldRow
        ? '<p>בממוצע התשואה נכללות רק קופות בנות שלוש שנים לפחות. התשואה היא תשואת המסלול שבו החיסכון מושקע, לפני דמי ניהול.</p>'
          + (annual !== null ? `<p>התשואה המוצגת מצטברת לכל שלוש השנים יחד, ואינה תשואה שנתית. היא שווה ערך ל-${annual.toFixed(2)}% בשנה בממוצע.</p>` : '')
        : `<p>לתשואה: ${CMP_NONE_TEXT}.</p>`}
      <p>הנתונים מדיווחי גמל־נט, פנסיה־נט וביטוח־נט.</p>
    </div>`;
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
  return Number.isFinite(value) ? value.toFixed(2) + '%' : 'לא הוזנו';
}
function saveState() {
  // בתצוגת תיק ששותף שינויים נשארים בזיכרון בלבד, עד "שמירה בדפדפן".
  if (SHARED_VIEW) return;
  const minimal = userFunds.map(item => ({
    uid: item.fund.uid,
    fund_name: item.fund.fund_name || '',
    balance: item.balance || 0,
    management_fee: Number.isFinite(item.managementFee) ? item.managementFee : null,
    deposit_fee: Number.isFinite(item.depositFee) ? item.depositFee : null,
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
        depositFee: normalizeUserFee(item.deposit_fee),
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

/* נתון חסר במאגר (null) אינו אפס: Number(null) הוא 0, ולכן קופה בלי נתון
   הייתה נספרת כקופה עם 0% מניות ומושכת את הממוצע כלפי מטה. הממוצע נשקל
   רק על החלק בתיק שיש לו נתון, והחלק הזה מוצג למשתמש כשיעור כיסוי. */
function fundMetricValue(fund, key) {
  const raw = fund[key];
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
/* תשואה חודשית, מתחילת השנה ול־3 שנים נמדדת עד חודש הדיווח של המסלול.
   ממוצע של תשואות מתקופות שונות אינו תשואה של תקופה כלשהי, ולכן במדדי
   התשואה נספרים רק מסלולים שדיווחו על החודש העדכני במאגר; כל השאר נספרים
   כחסרים ומופיעים בשיעור הכיסוי. זה מחמיר מ־is_stale (פיגור של יותר
   משלושה חודשים): גם פיגור של חודש אחד מוציא מהתשואה. חשיפות משתנות לאט
   ונשארות בחישוב. */
function isCurrentPeriod(fund) {
  return Number(fund.report_period) === Number(DATASET_MAX_PERIOD);
}
const PERIOD_BOUND_METRICS = { monthly_yield: 1, ytd_yield: 1, yield_trailing_3yrs: 1 };
function weightedMetricInfo(key) {
  let total = 0;
  let covered = 0;
  let sum = 0;
  for (const item of userFunds) {
    const balance = Number(item.balance) || 0;
    if (balance <= 0) continue;
    total += balance;
    if (PERIOD_BOUND_METRICS[key] && !isCurrentPeriod(item.fund)) continue;
    const value = fundMetricValue(item.fund, key);
    if (value === null) continue;
    covered += balance;
    sum += balance * value;
  }
  return {
    value: covered > 0 ? sum / covered : null,
    coveredPct: total > 0 ? covered / total * 100 : 0
  };
}
function weightedMetric(key, totalBalance) {
  return weightedMetricInfo(key).value;
}
const COVERAGE_LABELS = [
  ['stock_pct', 'חשיפה למניות'], ['foreign_pct', 'חשיפה לחו״ל'], ['fx_pct', 'חשיפה למט״ח'],
  ['monthly_yield', 'תשואה חודשית'], ['ytd_yield', 'תשואה מתחילת השנה'],
  ['yield_trailing_3yrs', 'תשואה ל־3 שנים']
];
/* שורת עדכניות וכיסוי בראש הדוח: מתי עודכן המאגר, איזה חלק מהתיק במסלולים
   שהפסיקו לדווח, ולאיזה חלק מהתיק חסר כל נתון. */
function renderCoverageNote(activeItems, totalBalance) {
  const el = document.getElementById('coverageNote');
  if (!el) return;
  const lagging = activeItems.filter(item => !isCurrentPeriod(item.fund));
  const partial = COVERAGE_LABELS.map(([key, label]) => [label, weightedMetricInfo(key).coveredPct])
    .filter(([, pct]) => pct < 99.95);
  const open = !!el.querySelector('details[open]');
  if (!lagging.length && !partial.length) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  const heading = lagging.length ? 'לחלק מהחסכונות יש נתונים היסטוריים' : 'לחלק מהחסכונות חסרים נתונים';
  const historical = lagging.length ? `<p>המסלולים הבאים לא דיווחו על ${escapeHtml(fmtPeriodHebrew(DATASET_MAX_PERIOD))}. הנתונים ההיסטוריים שלהם נכללים בחשיפות כשיש נתון, אך אינם נכללים בתשואות התיק, כדי לא לערבב תקופות.</p>
    <ul>${lagging.map(item => `<li>${escapeHtml(item.fund.fund_name)} · דיווח ${escapeHtml(fmtPeriod(item.fund.report_period))}</li>`).join('')}</ul>` : '';
  const coverage = partial.length ? `<p>חישוב על חלק מהתיק בלבד, כי למסלולים האחרים אין נתון תקף:</p><ul>${partial.map(([label, pct]) => `<li>${label} — ${pct.toFixed(0)}% מהתיק</li>`).join('')}</ul>` : '';
  el.innerHTML = `<details class="data-status"${open ? ' open' : ''}><summary><span>${heading}</span> <span class="data-status-action">· ${open ? 'הסתר פרטים' : 'הצג פרטים'}</span></summary><div class="data-status-body">${historical}${coverage}</div></details>`;
  el.classList.toggle('coverage-warn', true);
}
function renderMetricCoverage() {
  [['Stock', 'stock_pct'], ['Foreign', 'foreign_pct'], ['Fx', 'fx_pct']].forEach(([id, key]) => {
    const el = document.getElementById('agg' + id + 'Coverage');
    const pct = weightedMetricInfo(key).coveredPct;
    if (!el) return;
    el.hidden = pct >= 99.95;
    el.textContent = pct > 0 ? `לפי ${pct.toFixed(0)}% מהתיק` : 'אין נתון זמין';
  });
}
document.addEventListener('toggle', event => {
  if (event.target.classList?.contains('data-status')) {
    event.target.querySelector('.data-status-action').textContent = event.target.open ? '· הסתר פרטים' : '· הצג פרטים';
  }
}, true);
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
/* דמי הניהול המשוקללים מוצגים רק כשהוזנו לכל החסכונות. חסר — "לא הוזנו", ולא
   אפס ולא ממוצע המסלול; כשהוזנו רק לחלק, שורה קטנה אומרת זאת. */
function setFeeMetric(value) {
  const el = document.getElementById('feeSavings');
  const pct = document.getElementById('feeSavingsPct');
  const note = document.getElementById('feeSavingsNote');
  if (Number.isFinite(value)) {
    el.textContent = value.toFixed(2);
    if (pct) pct.style.display = '';
  } else {
    el.textContent = 'לא הוזנו';
    if (pct) pct.style.display = 'none';
  }
  if (note) {
    const active = userFunds.filter(item => (Number(item.balance) || 0) > 0);
    const entered = active.filter(item => Number.isFinite(item.managementFee)).length;
    note.hidden = Number.isFinite(value) || entered === 0;
    note.textContent = `הוזנו ל-${entered} מתוך ${active.length} חסכונות`;
  }
  el.className = '';
}
/* "ממוצע בקבוצה" לכרטיסי התשואה ודמי הניהול של התיק: לכל מוצר — ממוצע
   קבוצת ההשוואה שלו (אותן קבוצות כמו בשורת המוצר), משוקלל לפי היתרות כמו
   הנתון שלך. נספרים רק המוצרים שנכללים בנתון שלך: בתשואה — מסלולים שדיווחו
   על החודש העדכני; בדמי ניהול — דמי הניהול שהזנת (בפנסיה: מצבירה). מוצר
   בלי קבוצה מתאימה אינו נספר, ואז מצוין על איזה חלק מהתיק הממוצע מחושב. */
function groupYieldAverage(fund, key) {
  if (key === 'yield_trailing_3yrs') {
    const cmp = compareToPeers(fund, null, null);
    const row = cmp && cmp.rows.find(r => r.key === 'yield');
    return row ? row.peers : null;
  }
  if (!cmpIsFresh(fund)) return null;
  const values = (cmpPolicyPeers(fund) || []).map(r => fundMetricValue(r, key)).filter(v => v !== null);
  return values.length >= CMP_MIN_PEERS ? cmpMean(values) : null;
}
function portfolioGroupAverage(key, activeItems) {
  let base = 0;
  let covered = 0;
  let sum = 0;
  let mine = 0;
  for (const item of activeItems) {
    const balance = Number(item.balance) || 0;
    let avg;
    let value;
    if (key === 'fee') {
      if (!Number.isFinite(item.managementFee)) return null;   // הנתון שלך מוצג רק כשהוזנו לכולם
      const cmp = compareToPeers(item.fund, item.managementFee, item.depositFee);
      const row = cmp && cmp.rows.find(r => r.key === 'fee');
      avg = row ? row.peers : null;
      value = item.managementFee;
    } else {
      value = fundMetricValue(item.fund, key);
      if (!isCurrentPeriod(item.fund) || value === null) continue;
      avg = groupYieldAverage(item.fund, key);
    }
    base += balance;
    if (!Number.isFinite(avg)) continue;
    covered += balance;
    sum += balance * avg;
    mine += balance * value;
  }
  return covered > 0 ? { value: sum / covered, mine: mine / covered, coveredPct: covered / base * 100 } : null;
}
function setGroupAverage(id, info, digits) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = !info;
  if (!info) return;
  // ממוצע שחושב רק על חלק מהתיק מוצג מול הנתון שלך באותו חלק — לא מול הנתון
  // הגדול שבכרטיס, שמחושב על כל התיק.
  el.textContent = `ממוצע קבוצת ההשוואה ${info.value.toFixed(digits)}%`
    + (info.coveredPct < 99.95 ? ` · לפי ${info.coveredPct.toFixed(0)}% מהתיק, שבהם שלך ${info.mine.toFixed(digits)}%` : '');
}
function renderGroupAverages(activeItems) {
  setGroupAverage('perfMonthAvg', portfolioGroupAverage('monthly_yield', activeItems), 2);
  setGroupAverage('perfYtdAvg', portfolioGroupAverage('ytd_yield', activeItems), 2);
  setGroupAverage('perf3yAvg', portfolioGroupAverage('yield_trailing_3yrs', activeItems), 2);
  setGroupAverage('feeSavingsAvg', portfolioGroupAverage('fee', activeItems), 2);
}
function setMetric(id, value, digits = 1) {
  const el = document.getElementById(id);
  el.textContent = Number.isFinite(value) ? value.toFixed(digits) : '-';
  el.className = metricClass(value);
}

/* === רשימת המוצרים: שלוש שכבות ===
   1. שורה סגורה: שם, יתרה, משקל בתיק ושורת השוואה אחת קטנה — דמי הניהול שלך
      מול הממוצע, "הזן דמי ניהול", או כלום כשאין קבוצת השוואה.
   2. מוצר פתוח: דמי ניהול מול הממוצע (עם שדה הזנה), חשיפות בשורה אחת,
      "השוואה מלאה" ו"עריכה". ההסרה נמצאת בתוך "עריכה".
   3. חלון "השוואה מלאה": הטבלה, נתוני המסלול ו"איך מחושבת ההשוואה?".
   בלי צבע ובלי "מעל" או "מתחת": המספר שלך מול הממוצע, בלי שיפוט. */
let OPEN_PRODUCT_UID = null;
/* הניסוח מתאר את קבוצת ההשוואה בפועל: אותו סוג מוצר ואותה קטגוריית מסלול
   השקעה (ראו compareToPeers) — לא "מסלולים דומים" כללי. בשורות עצמן כתוב
   רק "ממוצע", וההגדרה מופיעה פעם אחת מתחת לכותרת הרשימה. */
const CMP_PEERS_TEXT = 'ממוצע קבוצת ההשוואה';
const CMP_NONE_TEXT = 'אין כרגע ממוצע מתאים להשוואה';
/* הערה אחת כשחסר ממוצע לתשואה או לחשיפה. בלי השוואה כלל — הנוסח המלא. */
function cmpMissingNote(f, cmp) {
  if (!cmp) return `${CMP_NONE_TEXT}.`;
  const has = key => cmp.rows.some(row => row.key === key);
  if (!has('yield') && !has('stock')) return `לתשואה ולחשיפה: ${CMP_NONE_TEXT}.`;
  if (!has('yield') && typeof f.yield_trailing_3yrs === 'number') return `לתשואה: ${CMP_NONE_TEXT}.`;
  return '';
}
function fmtCmp(value, digits) {
  return typeof value === 'number' && isFinite(value) ? value.toFixed(digits) + '%' : '—';
}
function fmtWeight(weight) {
  const rounded = Math.round(weight * 10) / 10;
  return (rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)) + '%';
}
function fmtRound(value) {
  return typeof value === 'number' && isFinite(value) ? Math.round(value) + '%' : '—';
}
function isPensionFund(f) {
  return (f._product || productOf(f)) === 'pensia';
}
/* כותרת: סוג החיסכון והחברה. שם המסלול המקורי תמיד בשורת משנה, כדי שאפשר
   יהיה לזהות את המסלול שנבחר בלי לפתוח חלון — גם כשיש רק מוצר אחד מסוגו. */
function productTitleParts(item) {
  const f = item.fund;
  const product = PRODUCT_LABEL[f._product || productOf(f)];
  const brand = f._brand || brandOf(f);
  if (!product || !brand) return { title: f.fund_name || 'החיסכון', track: '' };
  return { title: `${product} ב${brand}`, track: f.fund_name || '' };
}
function feeRowsFor(item, cmp) {
  const byKey = key => cmp && cmp.rows.find(row => row.key === key);
  // "שלך" = מה שהמשתמש הזין. דמי הניהול הממוצעים במסלול ובקבוצת ההשוואה מוצגים בנפרד.
  const rows = [{ field: 'managementFee', label: isPensionFund(item.fund) ? 'דמי הניהול שלך מצבירה' : 'דמי הניהול שלך', peer: byKey('fee') }];
  if (isPensionFund(item.fund)) rows.push({ field: 'depositFee', label: 'דמי הניהול שלך מהפקדות', peer: byKey('deposit_fee') });
  return rows;
}
// השורה הסגורה מציגה רק זיהוי, יתרה ומשקל; הפרטים נמצאים בפתיחה.
function productIndicatorHtml() { return ''; }
/* דמי ניהול בשכבה 2 מוצגים כערך — לא כשדה טופס. לחיצה הופכת את הערך לשדה
   הזנה במקום; Enter או יציאה מהשדה שומרים, Escape מבטל. */
function feeValueHtml(item, field, label) {
  const value = item[field];
  const uid = escapeHtml(item.fund.uid);
  return Number.isFinite(value)
    ? `<button type="button" class="stat-value stat-edit" data-fee-edit data-fee-uid="${uid}" data-fee-field="${field}" aria-label="${escapeHtml(label)}: ${value.toFixed(2)}%. לחיצה לשינוי">${value.toFixed(2)}%<span class="stat-edit-icon" aria-hidden="true">✎</span></button>`
    : `<button type="button" class="stat-value stat-add" data-fee-edit data-fee-uid="${uid}" data-fee-field="${field}" aria-label="${escapeHtml(label)}: לא הוזנו. לחיצה להזנה">לא הוזנו<span class="stat-edit-icon" aria-hidden="true">✎</span></button>`;
}
function openFeeEditor(button) {
  const idx = findUserFundIndex(button.getAttribute('data-fee-uid'));
  if (idx < 0) return;
  const field = button.getAttribute('data-fee-field') === 'depositFee' ? 'depositFee' : 'managementFee';
  const value = userFunds[idx][field];
  const label = button.closest('[data-fee-label]')?.dataset.feeLabel || button.closest('.product-stat').querySelector('.product-stat-label').textContent;
  const wrap = document.createElement('span');
  wrap.className = 'stat-value stat-input';
  wrap.innerHTML = `<input type="number" class="product-fee-input" data-fee-uid="${escapeHtml(button.getAttribute('data-fee-uid'))}" data-fee-field="${field}"
      value="${Number.isFinite(value) ? value.toFixed(2) : ''}" placeholder="0.00" min="0" max="10" step="0.01" inputmode="decimal" enterkeyhint="done"
      aria-label="${escapeHtml(label)}, באחוזים" /><span aria-hidden="true">%</span>`;
  button.replaceWith(wrap);
  const input = wrap.querySelector('input');
  input.focus();
  input.select();
}
/* תשואה מצטברת של 12 חודשי דיווח רצופים, עד חודש הדיווח של המסלול.
   חודש חסר אינו אפס, ואין להשתמש בתשואה מתחילת השנה במקום שנה אחרונה. */
function trailingYearYield(fund) {
  const validPeriod = period => /^\d{6}$/.test(String(period)) && Number(String(period).slice(4)) >= 1 && Number(String(period).slice(4)) <= 12;
  if (!fund || !validPeriod(fund.hist_start) || !validPeriod(fund.report_period) || !Array.isArray(fund.hist_yield)) return null;
  const end = monthDiff(fund.hist_start, fund.report_period);
  if (!Number.isInteger(end) || end < 11 || end >= fund.hist_yield.length) return null;
  const months = fund.hist_yield.slice(end - 11, end + 1);
  if (months.length !== 12 || months.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < -100)) return null;
  return (months.reduce((factor, value) => factor * (1 + value / 100), 1) - 1) * 100;
}
function trailingYearComparison(fund) {
  const mine = trailingYearYield(fund);
  const values = Number.isFinite(mine) && cmpIsFresh(fund)
    ? (cmpPolicyPeers(fund) || []).map(trailingYearYield).filter(Number.isFinite) : [];
  return { mine, peers: values.length >= CMP_MIN_PEERS ? cmpMean(values) : null, count: values.length };
}
function productDetailHtml(item, cmp) {
  const f = item.fund;
  const uid = escapeHtml(f.uid);
  // אריחים כמו כרטיסי החשיפה בראש הדשבורד: תווית, ערך גדול, וממוצע מתחת.
  const tile = (label, valueHtml, avg, cls, note) => `
      <div class="product-stat${cls ? ' ' + cls : ''}">
        <span class="product-stat-label">${label}</span>
        ${note ? `<span class="product-stat-note">${note}</span>` : ''}
        ${valueHtml}
        ${avg ? `<span class="product-stat-avg">ממוצע קבוצת ההשוואה ${avg}</span>` : ''}
      </div>`;
  const annual = trailingYearComparison(f);
  const annualHtml = tile('תשואה בשנה האחרונה', `<span class="stat-value">${fmtCmp(annual.mine, 1)}</span>`, Number.isFinite(annual.peers) ? fmtCmp(annual.peers, 1) : '', 'product-year-row', Number.isFinite(annual.mine) ? '12 חודשים · לפני דמי ניהול' : 'אין נתונים ל־12 חודשים מלאים');
  const yieldRow = cmp && cmp.rows.find(row => row.key === 'yield');
  const yieldValue = yieldRow ? yieldRow.mine : f.yield_trailing_3yrs;
  const yieldHtml = tile('תשואה ל־3 שנים', `<span class="stat-value">${fmtCmp(yieldValue, 1)}</span>`, yieldRow ? fmtCmp(yieldRow.peers, 1) : '', 'product-yield-row', 'מצטברת · לפני דמי ניהול');
  const fees = `<div class="product-stat product-fee-card"><span class="product-stat-label">דמי הניהול שלך</span>${feeRowsFor(item, cmp).map(row => `<div class="product-fee-entry" data-fee-label="${escapeHtml(row.label)}">
    <span class="product-stat-note">${row.field === 'depositFee' ? 'מהפקדות' : 'שנתיים · מצבירה'}</span>
    ${feeValueHtml(item, row.field, row.label)}
    ${row.peer ? `<span class="product-stat-avg">ממוצע קבוצת ההשוואה ${fmtCmp(row.peer.peers, 2)}</span>` : ''}
  </div>`).join('')}</div>`;
  const note = f.is_stale
    ? `<p class="product-note">הנתונים למסלול זה עודכנו לאחרונה ב-${escapeHtml(fmtPeriod(f.report_period))}, ולכן הוא אינו נכלל בהשוואה לקופות באותו סוג מסלול.</p>`
    : (cmpMissingNote(f, cmp) ? `<p class="product-note">${cmpMissingNote(f, cmp)}</p>` : '');
  return `
      <div class="product-fees product-stats product-three-stats">${annualHtml}${yieldHtml}${fees}</div>
      ${note}
      <p class="product-expo">מניות <b>${fmtRound(f.stock_pct)}</b> · חו״ל <b>${fmtRound(f.foreign_pct)}</b> · מט״ח <b>${fmtRound(f.fx_pct)}</b></p>
      <div class="product-actions">
        <button type="button" class="product-action product-action-main" data-info="full" data-info-uid="${uid}" aria-haspopup="dialog">${cmp ? 'השוואה מלאה' : 'פרטי המסלול'} <span aria-hidden="true">›</span></button>
        <button type="button" class="product-action" data-edit-uid="${uid}" aria-label="עריכת ${escapeHtml(f.fund_name || 'המוצר')}">עריכה</button>
      </div>
      <div class="print-only">${fullComparisonHtml(item, cmp, true)}</div>`;
}
/* התשואה היא תשואת המסלול שבו כספי המשתמש מושקעים — לא תשואה "כללית" ולא
   תשואה אישית שחושבה מתנועות החשבון. התקופה ואופן החישוב תמיד לצידה. */
const YIELD_LABEL = 'תשואת המסלול שלך';
const YIELD_PERIOD_NOTE = 'מצטברת ל־3 שנים, לפני דמי ניהול';
/* שכבה 3: הטבלה המלאה ונתוני המסלול. משמשת את החלון "השוואה מלאה", ובהדפסה
   מודפסת בתוך כל מוצר — הדוח ממשיך להציג את כל המידע. */
function fullComparisonHtml(item, cmp, forPrint) {
  const f = item.fund;
  const byKey = key => cmp && cmp.rows.find(row => row.key === key);
  const mineFee = field => Number.isFinite(item[field]) ? item[field].toFixed(2) + '%' : 'לא הוזנו';
  const rows = [];
  const fees = [];
  const yieldRow = byKey('yield');
  const annual = trailingYearComparison(f);
  if (Number.isFinite(annual.mine)) rows.push(['תשואה בשנה האחרונה<span class="cmp-row-note">12 חודשים, לפני דמי ניהול</span>', fmtCmp(annual.mine, 1), fmtCmp(annual.peers, 1)]);
  if (yieldRow) rows.push([`${YIELD_LABEL}<span class="cmp-row-note">${YIELD_PERIOD_NOTE}</span>`, fmtCmp(yieldRow.mine, 1), fmtCmp(yieldRow.peers, 1)]);
  feeRowsFor(item, cmp).forEach(row => fees.push([row.label, mineFee(row.field), fmtCmp(row.peer && row.peer.peers, 2)]));
  const stockRow = byKey('stock');
  if (stockRow) rows.push(['חשיפה למניות', fmtCmp(stockRow.mine, 0), fmtCmp(stockRow.peers, 0)]);
  const table = cmp ? `
      <table class="product-cmp">
        <thead><tr><th scope="col">נתון</th><th scope="col">המסלול שלך</th><th scope="col">${CMP_PEERS_TEXT}</th></tr></thead>
        <tbody>${rows.map(([label, mine, peers]) =>
          `<tr><th scope="row">${label}</th><td class="product-cmp-mine">${mine}</td><td class="product-cmp-peer">${peers}</td></tr>`).join('')}</tbody>
      </table>
      <h5 class="fund-facts-head">דמי ניהול</h5>
      <table class="product-cmp"><thead><tr><th scope="col">נתון</th><th scope="col">דמי הניהול שלך</th><th scope="col">${CMP_PEERS_TEXT}</th></tr></thead>
      <tbody>${fees.map(([label, mine, peers]) => `<tr><th scope="row">${label}</th><td class="product-cmp-mine">${mine}</td><td class="product-cmp-peer">${peers}</td></tr>`).join('')}</tbody></table>
      ${cmpMissingNote(f, cmp) ? `<p class="product-note">${cmpMissingNote(f, cmp)}</p>` : ''}
      ${yieldRow ? '<p class="product-note">התשואה מצטברת לכל שלוש השנים יחד, ואינה תשואה שנתית. היא מתייחסת לתקופה המוצגת; התוצאה בחיסכון שלך תלויה גם במועד ההצטרפות, בהפקדות ובמשיכות ובדמי הניהול.</p>' : ''}
      <p class="product-note">דמי הניהול שלך — כפי שהזנת. הממוצע — דמי הניהול הממוצעים בקבוצת ההשוואה. דמי הניהול הממוצעים במסלול עצמו מופיעים בנתוני המסלול.</p>`
    : `<p class="product-note">${f.is_stale ? 'המסלול אינו נכלל בהשוואה, כי נתוניו לא עודכנו.' : CMP_NONE_TEXT + '.'}</p>`;
  const fact = (label, value, wide) => `<div class="fund-fact${wide ? ' fund-fact-wide' : ''}"><dt>${label}</dt><dd>${value}</dd></div>`;
  const facts = [
    fact('תשואה חודשית', fmtPct(f.monthly_yield, 2)),
    fact('מתחילת השנה', fmtPct(f.ytd_yield, 2)),
    !cmp ? fact('תשואה בשנה האחרונה · 12 חודשים', fmtPct(annual.mine, 1), true) : '',
    yieldRow ? '' : fact('תשואת המסלול, מצטברת ל־3 שנים', fmtPct(f.yield_trailing_3yrs, 2), true),
    stockRow ? '' : fact('מניות', fmtPct(f.stock_pct, 1)),
    fact('חו״ל', fmtPct(f.foreign_pct, 1)),
    fact('מט״ח', fmtPct(f.fx_pct, 1)),
    fact('נכסים סחירים', fmtPct(f.liquid_pct, 1)),
    fact(isPensionFund(f) ? 'דמי ניהול ממוצעים במסלול, מצבירה' : 'דמי ניהול ממוצעים במסלול', fmtPct(f.avg_annual_management_fee, 2), true),
    isPensionFund(f) ? fact('דמי ניהול ממוצעים במסלול, מהפקדות', fmtPct(f.avg_deposit_fee, 2), true) : ''
  ].join('');
  const method = cmp && !forPrint
    ? `<details class="method-details"><summary>איך מחושבת ההשוואה?</summary>${renderComparisonMethod(item)}</details>`
    : '';
  return `
      ${table}
      <h5 class="fund-facts-head">נתוני המסלול</h5>
      ${trackLabel(f) ? `<p class="fund-facts-kind"><strong>${escapeHtml(trackLabel(f))}</strong>${trackNote(f) ? ' — ' + escapeHtml(trackNote(f)) : ''}</p>` : ''}
      <p class="fund-facts-sub">נתוני הדיווח הציבורי של המסלול כולו. דמי הניהול כאן הם הממוצע שנגבה מכלל העמיתים במסלול.</p>
      <dl class="fund-facts">${facts}</dl>
      ${method}`;
}
function productItemHtml(item, activeItems, totalBalance) {
  const f = item.fund;
  const uid = escapeHtml(f.uid);
  const balance = Number(item.balance) || 0;
  const cmp = compareToPeers(f, item.managementFee, item.depositFee);
  const brand = BRAND_BY_NAME[f._brand || brandOf(f)];
  const open = OPEN_PRODUCT_UID === f.uid;
  const panelId = 'product-' + String(f.uid).replace(/[^A-Za-z0-9_-]/g, '-');
  const { title, track } = productTitleParts(item);
  return `
    <article class="product${open ? ' is-open' : ''}" data-product-uid="${uid}">
      <button type="button" class="product-row" data-toggle-uid="${uid}" aria-expanded="${open}" aria-controls="${panelId}">
        
        <span class="product-mid">
          <span class="product-title">${escapeHtml(title)}</span>
          ${track ? `<span class="product-track-line">${escapeHtml(track)}</span>` : ''}
          <span class="product-inds" data-ind-uid="${uid}" hidden>${productIndicatorHtml(item, cmp)}</span>
        </span>
        <span class="product-amt">
          <b>${fmtCurrency(balance)}</b>
          <span>${fmtWeight(balance / totalBalance * 100)} מהתיק</span>
        </span>
        <span class="product-chev" aria-hidden="true"></span>
      </button>
      <div class="product-detail" id="${panelId}"${open ? '' : ' hidden'}>${productDetailHtml(item, cmp)}</div>
    </article>`;
}
function setProductOpen(uid, focusFee) {
  OPEN_PRODUCT_UID = OPEN_PRODUCT_UID === uid && !focusFee ? null : uid;
  document.querySelectorAll('#detailsRows .product').forEach(el => {
    const isOpen = el.getAttribute('data-product-uid') === OPEN_PRODUCT_UID;
    el.classList.toggle('is-open', isOpen);
    el.querySelector('.product-row').setAttribute('aria-expanded', String(isOpen));
    el.querySelector('.product-detail').hidden = !isOpen;
  });
  if (focusFee && OPEN_PRODUCT_UID) {
    const button = document.querySelector(`#detailsRows [data-fee-edit][data-fee-uid="${CSS.escape(uid)}"]`);
    if (button) openFeeEditor(button);
  }
}
document.addEventListener('click', event => {
  const row = event.target.closest('[data-toggle-uid]');
  if (!row) return;
  setProductOpen(row.getAttribute('data-toggle-uid'), !!event.target.closest('[data-ask-fee]'));
});
/* שמירת דמי ניהול מתוך המוצר הפתוח: מעדכנים את הנתון, את שורת המוצר, את
   טבלת ההדפסה ואת דמי הניהול המשוקללים — בלי לצייר מחדש את המוצר, כדי
   שהמיקוד יישאר בשדה הבא. דמי ניהול אינם משנים את "היתרות עודכנו לפני...". */
function commitProductFee(input) {
  const idx = findUserFundIndex(input.getAttribute('data-fee-uid'));
  if (idx < 0) return;
  const item = userFunds[idx];
  const field = input.getAttribute('data-fee-field') === 'depositFee' ? 'depositFee' : 'managementFee';
  const value = normalizeUserFee(input.value);
  if (value === item[field] || (value === null && !Number.isFinite(item[field]))) return;
  item[field] = value;
  saveState();
  const cmp = compareToPeers(item.fund, item.managementFee, item.depositFee);
  const product = document.querySelector(`#detailsRows .product[data-product-uid="${CSS.escape(item.fund.uid)}"]`);
  if (product) {
    product.querySelector('[data-ind-uid]').innerHTML = productIndicatorHtml(item, cmp);
    const print = product.querySelector('.print-only');
    if (print) print.innerHTML = fullComparisonHtml(item, cmp, true);
  }
  setFeeMetric(weightedUserManagementFee(getTotalBalance()));
  renderGroupAverages(userFunds.filter(i => (Number(i.balance) || 0) > 0));
  renderFeeRows(userFunds.filter(i => (Number(i.balance) || 0) > 0));
  refreshSimulationDefaults();
}
function closeFeeEditor(input, save) {
  if (input.dataset.closing) return null;
  input.dataset.closing = '1';
  if (save) commitProductFee(input);
  const idx = findUserFundIndex(input.getAttribute('data-fee-uid'));
  const wrap = input.closest('.stat-input');
  if (idx < 0 || !wrap) return;
  const field = input.getAttribute('data-fee-field') === 'depositFee' ? 'depositFee' : 'managementFee';
  const label = wrap.closest('[data-fee-label]')?.dataset.feeLabel || wrap.closest('.product-stat').querySelector('.product-stat-label').textContent;
  const holder = document.createElement('span');
  holder.innerHTML = feeValueHtml(userFunds[idx], field, label);
  const button = holder.firstElementChild;
  wrap.replaceWith(button);
  return button;
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-fee-edit]');
  if (button) openFeeEditor(button);
});
document.addEventListener('keydown', event => {
  const input = event.target;
  if (!input.classList || !input.classList.contains('product-fee-input')) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    const button = closeFeeEditor(input, true);
    if (button) button.focus();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    const button = closeFeeEditor(input, false);
    if (button) button.focus();
  }
});
// יציאה מהשדה (לחיצה במקום אחר) שומרת.
document.addEventListener('focusout', event => {
  const input = event.target;
  if (input.classList && input.classList.contains('product-fee-input') && !input.dataset.closing && input.closest('.stat-input')) {
    closeFeeEditor(input, true);
  }
});

/* טולטיפ ההסבר בכרטיסי החשיפה: הקשה על "?" פותחת וסוגרת (בטלפון אין
   מעבר עכבר); הקשה במקום אחר או Escape סוגרים. */
function setMetricTip(card, open) {
  card.classList.toggle('is-tip-open', open);
  const btn = card.querySelector('.metric-tip');
  if (btn) btn.setAttribute('aria-expanded', String(open));
}
document.addEventListener('click', event => {
  const btn = event.target.closest('.metric-tip');
  document.querySelectorAll('.metric-card.is-tip-open').forEach(card => {
    if (!btn || card !== btn.closest('.metric-card')) setMetricTip(card, false);
  });
  if (!btn) return;
  const card = btn.closest('.metric-card');
  const open = !card.classList.contains('is-tip-open');
  setMetricTip(card, open);
  if (!open) btn.blur();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  document.querySelectorAll('.metric-card.is-tip-open').forEach(card => setMetricTip(card, false));
  const btn = document.activeElement;
  if (btn && btn.classList && btn.classList.contains('metric-tip')) btn.blur();
});

/* הסבר אחד לשלושת כרטיסי החשיפה. בא במקום כפתור "?" בכל כרטיס, שבמובייל שבר
   את התוויות לשתי שורות. */
/* ההסבר הפשוט קודם; המונחים המקצועיים (נגזרים, גידור, ממוצע משוקלל) בהרחבה.
   הניסוחים תואמים את שדות המקור: STOCK_MARKET_EXPOSURE, FOREIGN_EXPOSURE
   ו-FOREIGN_CURRENCY_EXPOSURE — אחוז מנכסי המסלול. */
const EXPOSURE_TERMS = [
  ['מניות', 'עד כמה החיסכון חשוף לשינויים בשוק המניות, בישראל ובחו״ל.'],
  ['חו״ל', 'עד כמה החיסכון חשוף להשקעות מחוץ לישראל — מניות, אג״ח וקרנות.'],
  ['מט״ח (מטבע חוץ)', 'עד כמה שינויים בשערי מטבעות זרים, בעיקר הדולר, עשויים להשפיע על החיסכון.']
];
const EXPOSURE_MORE = [
  'החשיפה למניות כוללת גם השקעה דרך קרנות ודרך נגזרים — חוזים שערכם נקבע לפי מחירי מניות. לכן היא יכולה לעלות מעט על 100%.',
  'החשיפה למט״ח נמוכה בדרך כלל מהחשיפה לחו״ל, כי חלק מההשקעות בחו״ל מגודרות — מוגנות מראש מפני שינויים בשער המטבע מול השקל.',
  'איך מחושב הנתון הכולל: אחוז החשיפה של כל מסלול נספר לפי חלקו ביתרה הכוללת שהוזנה (ממוצע משוקלל). הנתונים לקוחים מהדיווח הציבורי של כל מסלול.',
  'מסלול שאין לו נתון אינו נספר כאפס: החישוב נעשה רק על החלק בתיק שיש לו נתון, והכיסוי מצוין ליד המדד. פירוט נמצא בהודעה שמעל הכרטיסים.',
  'המדדים עשויים לחפוף: אותה השקעה יכולה להיכלל ביותר ממדד אחד, ולכן אין לחבר את האחוזים.'
];
function openInfoDialog(kind, uid) {
  const dialog = document.getElementById('infoDialog');
  if (kind === 'term') {
    if (!dialog) return;
    document.getElementById('infoDialogTitle').textContent = 'מה ההבדל בין מניות, חו״ל ומט״ח?';
    document.getElementById('infoDialogSub').textContent = '';
    document.getElementById('infoDialogBody').innerHTML = EXPOSURE_TERMS
      .map(([label, text]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(text)}</p>`).join('')
      + '<p>המדדים עשויים לחפוף: השקעה במניות בחו״ל נכללת גם במניות וגם בחו״ל, ולכן אין לחבר את האחוזים.</p>'
      + '<p>הנתון הכולל מחושב לפי היתרות שהזנת: חיסכון עם יתרה גדולה יותר משפיע יותר על הנתון הכולל.</p>'
      + '<p>שלושת המדדים מתארים לאן החיסכון חשוף. הם אינם מדידה מלאה של רמת הסיכון בו.</p>'
      + `<details class="method-details"><summary>הרחבה</summary>${EXPOSURE_MORE.map(text => `<p>${escapeHtml(text)}</p>`).join('')}</details>`;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return;
  }
  const idx = findUserFundIndex(uid);
  if (!dialog || idx < 0) return;
  const item = userFunds[idx];
  const cmp = compareToPeers(item.fund, item.managementFee, item.depositFee);
  const { title } = productTitleParts(item);
  document.getElementById('infoDialogTitle').textContent = title;
  document.getElementById('infoDialogSub').textContent = `${item.fund.fund_name || ''} · קופה ${item.fund.fund_id || ''}`;
  document.getElementById('infoDialogBody').innerHTML = fullComparisonHtml(item, cmp, false);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}
function closeInfoDialog() {
  const dialog = document.getElementById('infoDialog');
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}
window.closeInfoDialog = closeInfoDialog;
document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-info]');
  if (trigger) { openInfoDialog(trigger.getAttribute('data-info'), trigger.getAttribute('data-info-uid')); return; }
  // לחיצה על הרקע מחוץ לחלון סוגרת אותו.
  if (event.target.id === 'infoDialog') closeInfoDialog();
});

function renderDashboard() {
  const activeItems = userFunds.filter(item => (Number(item.balance) || 0) > 0);
  const totalBalance = activeItems.reduce((sum, item) => sum + (Number(item.balance) || 0), 0);
  if (totalBalance <= 0) {
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('detailsSection').style.display = 'none';
    document.getElementById('perfSection').style.display = 'none';
    document.getElementById('feesSection').style.display = 'none';
    document.getElementById('simulationEntrySection').style.display = 'none';
    document.body.classList.remove('simulation-view');
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
  const perfMonth = weightedMetric('monthly_yield', totalBalance);
  const perfYtd = weightedMetric('ytd_yield', totalBalance);
  const perf3y = weightedMetric('yield_trailing_3yrs', totalBalance);
  const feeSavings = weightedUserManagementFee(totalBalance);

  document.getElementById('totalBalance').textContent = fmtCurrency(totalBalance);
  renderBalanceAge(activeItems);
  renderPortfolioSummary(activeItems, totalBalance);
  renderCoverageNote(activeItems, totalBalance);
  renderMetricCoverage();
  renderFeeRows(activeItems);
  setMetric('aggStock', aggStock, 1);
  setMetric('aggForeign', aggForeign, 1);
  setMetric('aggFx', aggFx, 1);
  setMetric('perfMonth', perfMonth, 2);
  setMetric('perfYtd', perfYtd, 2);
  setMetric('perf3y', perf3y, 2);
  setFeeMetric(feeSavings);
  renderGroupAverages(activeItems);

  const barPairs = [
    ['aggStockBar', aggStock],
    ['aggForeignBar', aggForeign],
    ['aggFxBar', aggFx],
  ];
  for (const [id, value] of barPairs) {
    document.getElementById(id).style.width = Math.max(0, Math.min(100, Number(value) || 0)) + '%';
  }

  const rows = activeItems
    .slice()
    .sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0))
    .map(item => productItemHtml(item, activeItems, totalBalance))
    .join('');
  document.getElementById('detailsRows').innerHTML = rows;
  if (OPEN_PRODUCT_UID && !activeItems.some(item => item.fund.uid === OPEN_PRODUCT_UID)) OPEN_PRODUCT_UID = null;
  document.getElementById('dashboard').style.display = 'block';
  document.getElementById('detailsSection').style.display = 'block';
  document.getElementById('perfSection').style.display = 'block';
  document.getElementById('feesSection').style.display = 'block';
  renderHistorySection(activeItems);
  // v3.87: when the dashboard is shown, all dashboard accordion tabs start closed by default
  const perfToggle = document.querySelector('.perf-toggle-section');
  const feeToggle = document.querySelector('.fees-toggle-section');
  [perfToggle, feeToggle].forEach(section => {
    if (section) section.open = false;
  });
  const simulationResults = document.getElementById('simResultsBlock');
  if (simulationResults) simulationResults.hidden = true;
  const simulationTabSection = document.getElementById('simulationTabSection');
  if (simulationTabSection) simulationTabSection.style.display = document.body.classList.contains('simulation-view') ? 'block' : 'none';
  document.getElementById('simulationEntrySection').style.display = SIMULATION_ENABLED ? 'block' : 'none';
  const bottomActions = document.getElementById('bottomActions');
  if (bottomActions) bottomActions.style.display = 'block';
  refreshSimulationDefaults();
}

/* גיל היתרות: היתרה מוזנת פעם אחת ומתיישנת, והמשתמש החוזר צריך לדעת
   שהתמונה שהוא רואה נכונה לתאריך מסוים. מוצג לפי היתרה הוותיקה ביותר. */
function fmtAgeSince(iso) {
  const then = new Date(iso);
  if (isNaN(then.getTime())) return '';
  const now = new Date();
  const days = Math.floor((now - then) / 86400000);
  if (days < 1 && now.getDate() === then.getDate()) return 'היום';
  if (days < 2) return 'אתמול';
  if (days < 30) return `לפני ${days} ימים`;
  const months = (now.getFullYear() - then.getFullYear()) * 12 + now.getMonth() - then.getMonth() - (now.getDate() < then.getDate() ? 1 : 0);
  if (months <= 1) return 'לפני חודש';
  if (months === 2) return 'לפני חודשיים';
  if (months < 12) return `לפני ${months} חודשים`;
  return months < 24 ? 'לפני שנה' : 'לפני יותר משנתיים';
}
function renderBalanceAge(activeItems) {
  const wrap = document.getElementById('balanceAge');
  if (!wrap) return;
  // בתיק ששותף התאריכים הם רגע פתיחת הקישור, לא מועד העדכון בפועל.
  const stamps = SHARED_VIEW ? [] : activeItems.map(item => item.updated_at).filter(Boolean).sort();
  if (!stamps.length) { wrap.hidden = true; return; }
  const oldest = fmtAgeSince(stamps[0]);
  const newest = fmtAgeSince(stamps[stamps.length - 1]);
  if (!oldest) { wrap.hidden = true; return; }
  const subject = activeItems.length === 1 ? 'היתרה עודכנה' : (oldest === newest ? 'היתרות עודכנו' : 'חלק מהיתרות עודכנו');
  // ב-PDF תאריך מלא: "לפני 4 חודשים" נכון רק ביום שבו הדוח הופק.
  const first = fmtDate(stamps[0]);
  const last = fmtDate(stamps[stamps.length - 1]);
  const printed = activeItems.length === 1 ? `היתרה עודכנה ב-${first}.`
    : (first === last ? `היתרות עודכנו ב-${first}.` : `היתרות עודכנו בין ${first} ל-${last}.`);
  wrap.innerHTML = `<span class="age-screen">${escapeHtml(subject + ' ' + oldest + '.')}</span><span class="age-print">${escapeHtml(printed)}</span>`;
  wrap.hidden = false;
}
function fmtDate(iso) {
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/* משפט המבנה מעל כרטיסי החשיפה: כמה חסכונות הוזנו, ואיזה מהם הגדול.
   הכרטיסים כבר מציגים את אחוזי החשיפה, ולכן המשפט לא חוזר עליהם.
   עובדתי בלבד — בלי "ריכוזי", "מפוזר" או כל שיפוט אחר. הניסוח מתייחס רק
   למה שהוזן: האתר אינו יודע על חסכונות שלא הוספת. */
function portfolioItemLabel(item, activeItems) {
  const fund = item.fund;
  const product = PRODUCT_LABEL[fund._product || productOf(fund)];
  const brand = fund._brand || brandOf(fund);
  if (!product || !brand) return fund.fund_name || 'המוצר';
  const label = `${product} ב${brand}`;
  // שני מוצרים מאותו סוג באותה חברה: רק שם המסלול מבדיל ביניהם.
  const twins = activeItems.filter(other => other !== item
    && (other.fund._product || productOf(other.fund)) === (fund._product || productOf(fund))
    && (other.fund._brand || brandOf(other.fund)) === brand);
  return twins.length ? (fund.fund_name || label) : label;
}
function portfolioSummaryText(activeItems, totalBalance) {
  return totalBalance > 0 ? (activeItems.length === 1 ? 'חיסכון אחד' : `${activeItems.length} חסכונות`) : '';
}
function renderPortfolioSummary(activeItems, totalBalance) {
  const el = document.getElementById('portfolioSummary');
  if (el) el.textContent = portfolioSummaryText(activeItems, totalBalance);
}

/* "עדכון מהיר": כל היתרות במסך אחד, במקום מעבר מוצר אחרי מוצר באשף.
   שמירה מסמנת את כל המוצרים כמעודכנים — גם יתרה שלא השתנתה אושרה עכשיו. */
function openBalancesDialog() {
  const dialog = document.getElementById('balancesDialog');
  const rows = document.getElementById('balancesRows');
  if (!dialog || !rows) return;
  const items = userFunds.slice().sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0));
  rows.innerHTML = items.map(item => {
    const uid = escapeHtml(item.fund.uid);
    const brand = BRAND_BY_NAME[item.fund._brand || brandOf(item.fund)];
    const age = item.updated_at ? fmtAgeSince(item.updated_at) : '';
    return `
      <label class="balances-row">
        ${brand ? wizLogo(brand) : ''}
        <span class="balances-row-text">
          <span class="balances-row-name">${escapeHtml(item.fund.fund_name || '')}</span>
          ${age ? `<span class="balances-row-age">עודכן ${escapeHtml(age)}</span>` : ''}
        </span>
        <span class="balances-row-input">
          <span aria-hidden="true">₪</span>
          <input type="number" min="0" step="1" inputmode="numeric" enterkeyhint="done" data-balance-uid="${uid}" value="${Math.round(Number(item.balance) || 0)}" />
        </span>
      </label>`;
  }).join('');
  document.getElementById('balancesError').hidden = true;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  const first = rows.querySelector('input');
  if (first) { first.focus(); first.select(); }
}
function closeBalancesDialog() {
  const dialog = document.getElementById('balancesDialog');
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}
function saveBalancesDialog() {
  const inputs = Array.from(document.querySelectorAll('#balancesRows input[data-balance-uid]'));
  let firstInvalid = null;
  const updates = inputs.map(input => {
    const value = Number(input.value);
    const valid = input.value.trim() !== '' && Number.isFinite(value) && value > 0;
    input.closest('.balances-row').classList.toggle('is-invalid', !valid);
    if (!valid && !firstInvalid) firstInvalid = input;
    return [input.getAttribute('data-balance-uid'), value];
  });
  document.getElementById('balancesError').hidden = !firstInvalid;
  if (firstInvalid) { firstInvalid.focus(); return; }
  const now = new Date().toISOString();
  updates.forEach(([uid, value]) => {
    const idx = findUserFundIndex(uid);
    if (idx < 0) return;
    userFunds[idx].balance = value;
    userFunds[idx].updated_at = now;
  });
  saveState();
  renderFunds();
  closeBalancesDialog();
}
window.openBalancesDialog = openBalancesDialog;
window.closeBalancesDialog = closeBalancesDialog;
window.saveBalancesDialog = saveBalancesDialog;
document.addEventListener('click', event => {
  if (event.target.id === 'balancesDialog') closeBalancesDialog();
});

/* מתג להסתרת המחשבון כולו מהגרסה הציבורית, אם יידרש שוב. */
const SIMULATION_ENABLED = true;

/* סדרות התשואה של הסימולציה: 30 תשואות שנתיות באחוזים, ברוטו, לכל אחת
   משלוש רמות סיכון. שנה 1 בסימולציה מקבלת את הערך הראשון, שנה 2 את השני
   וכן הלאה; הסימולציה מוגבלת ל־30 שנה, ולכן אין מחזור.
   השנים: 1995–2024, ערך אחד לכל שנה. המקור המקורי עדיין לא מתועד.
   פירוט: README, "סדרות התשואה ההיסטוריות". */
const SIM_RAW_YIELDS = {
  low:    [22.66, 6.42, 13.62, 15.60, 0.18, 9.39, 1.67, 5.01, 6.11, 5.12, 3.33, 5.27, 8.12, -0.30, -0.37, 7.07, 10.05, 5.98, 0.61, 9.16, 1.05, 2.83, 6.99, -0.06, 13.25, 10.47, 3.05, -13.89, 8.60, 5.03],
  medium: [30.82, 14.37, 23.60, 22.47, 9.89, 0.71, -4.99, -7.81, 17.20, 8.09, 4.06, 10.29, 6.78, -14.72, 11.58, 11.81, 6.85, 10.61, 15.11, 11.89, 1.21, 7.30, 14.10, -2.55, 22.29, 14.80, 15.54, -16.96, 17.26, 14.61],
  high:   [35.83, 20.56, 30.78, 27.00, 17.98, -6.46, -10.11, -18.26, 25.56, 10.11, 4.63, 14.24, 5.95, -30.89, 22.23, 14.18, 3.49, 14.60, 28.03, 13.24, 1.37, 10.66, 19.73, -3.81, 29.05, 17.35, 25.18, -18.02, 23.84, 22.23]
};
const SIM_RISK_LABELS = { low: 'סיכון נמוך', medium: 'סיכון בינוני', high: 'סיכון גבוה' };

/* החשיפה למניות שכל אחת משלוש סדרות התשואה מייצגת. הערכים נגזרו מהמאגר
   עצמו: חציון החשיפה במסלולי אג"ח הוא 0.3%, במסלולים הכלליים 50.1%
   ובמסלולי המניות 98.5%. */
const SIM_TRACK_ANCHORS = [
  { track: 'low', stock: 0 },
  { track: 'medium', stock: 50 },
  { track: 'high', stock: 100 }
];
/* התשואה השנתית נגזרת מהחשיפה למניות בפועל, בשקלול רציף בין הסדרות.
   סיווג לשלוש קטגוריות נתן תוצאה זהה לכל תיק באותה קטגוריה — קרן פנסיה
   מקיפה (כ-70% מניות) וקרן משלימה (כ-100%) קיבלו אותו ערך עתידי. */
function simAnnualYield(yearIndex, stockPct) {
  const pct = Math.max(0, Math.min(100, Number(stockPct) || 0));
  const yieldOf = anchor => {
    const series = SIM_RAW_YIELDS[anchor.track];
    return series[yearIndex % series.length] || 0;
  };
  for (let i = 1; i < SIM_TRACK_ANCHORS.length; i++) {
    const lower = SIM_TRACK_ANCHORS[i - 1];
    const upper = SIM_TRACK_ANCHORS[i];
    if (pct <= upper.stock) {
      const weight = (pct - lower.stock) / (upper.stock - lower.stock);
      return yieldOf(lower) + (yieldOf(upper) - yieldOf(lower)) * weight;
    }
  }
  return yieldOf(SIM_TRACK_ANCHORS[SIM_TRACK_ANCHORS.length - 1]);
}
function getSimulationRiskTrack(stockPct) {
  const pct = Number(stockPct) || 0;
  if (pct <= 10) return 'low';
  if (pct <= 70) return 'medium';
  return 'high';
}
function fmtSimCurrency(value) {
  return Math.round(Number(value) || 0).toLocaleString('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
}
/* ברירת המחדל לאינפלציה: 2% — אמצע יעד האינפלציה של בנק ישראל (1%-3%). */
const SIM_DEFAULT_INFLATION = 2;
const SIM_DEFAULT_YEARS = 10;
function fmtSimPercent(value, digits = 2) {
  const num = Number(value) || 0;
  return num.toFixed(digits) + '%';
}
/* השדות נשארים ריקים; ערך ריק פירושו ברירת המחדל שמופיעה ב-placeholder.
   כותבים חזרה לשדה רק כשהמשתמש הקליד ערך מחוץ לטווח, כדי שיראה את הקיטום. */
function readSimInflationPct() {
  const input = document.getElementById('simInflationInput');
  const raw = input && input.value !== '' ? Number(input.value) : NaN;
  if (!Number.isFinite(raw)) return SIM_DEFAULT_INFLATION;
  const pct = Math.max(0, Math.min(20, raw));
  if (pct !== raw) input.value = String(pct);
  return pct;
}
/* דמי הניהול: ריק = דמי הניהול המשוקללים שהמשתמש הזין לקופות (ה-placeholder). */
function readSimFeePct(fallbackFee) {
  const input = document.getElementById('simFeeInput');
  const raw = input && input.value !== '' ? Number(input.value) : NaN;
  if (!Number.isFinite(raw)) return Number.isFinite(fallbackFee) ? fallbackFee : 0;
  const pct = Math.max(0, Math.min(5, raw));
  if (pct !== raw) input.value = String(pct);
  return pct;
}
/* מספר השנים: ריק = 10 שנים (ה-placeholder). */
function readSimYears() {
  const input = document.getElementById('simYearsInput');
  const raw = input && input.value !== '' ? Number(input.value) : NaN;
  if (!Number.isFinite(raw)) return SIM_DEFAULT_YEARS;
  const years = Math.max(1, Math.min(30, Math.round(raw)));
  if (years !== raw) input.value = String(years);
  return years;
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
  // דמי הניהול מוצגים כ-placeholder ולא כערך, כדי שהשדה יישאר ריק.
  if (feeInput) feeInput.placeholder = Number.isFinite(fee) ? fee.toFixed(2) : '0';
}
function runHistoricalSimulation() {
  const totalBalance = getTotalBalance();
  if (totalBalance <= 0) return;

  const stockPct = weightedMetric('stock_pct', totalBalance);
  const monthly = Math.max(0, Number(document.getElementById('simMonthlyInput')?.value) || 0);
  const years = readSimYears();
  const feePct = readSimFeePct(weightedUserManagementFee(totalBalance));

  const inflationPct = readSimInflationPct();
  const monthlyInflation = Math.pow(1 + inflationPct / 100, 1 / 12) - 1;

  // יתרה קיימת היא הון התחלתי בלבד, לא הפקדה נוספת.
  // לכן סך ההפקדות שמוצג בתוצאות כולל רק הפקדות עתידיות שהמשתמש הזין.
  let amount = totalBalance;
  let futureContributions = 0;
  // ההפקדות העתידיות במונחי היום: כל הפקדה מנוכה באינפלציה שנצברה עד מועדה.
  let futureContributionsReal = 0;
  // מדד צמיחה של שקל בודד — משמש לחישוב התשואה השנתית הממוצעת נטו.
  let growthIndex = 1;
  // מקדם השחיקה המצטבר של האינפלציה.
  let priceIndex = 1;
  // תשואה ודמי ניהול מומרים לחודש בשיטות שונות, כי הם מוגדרים אחרת:
  // - התשואה בסדרות היא תשואה שנתית מצטברת (ריבית דריבית), ולכן המרה
  //   גאומטרית: 12 חודשים מחזירים בדיוק את התשואה השנתית. חלוקה ב־12
  //   ניפחה אותה (35.83% בשנה הפכו ל־42.3%).
  // - דמי ניהול מהצבירה: הנחת המודל היא ששיעור שנתי נגבה מהיתרה מדי חודש
  //   בשיעור של 1/12 ממנו. זו הנחת חישוב, לא טענה על שיטת הגבייה המדויקת
  //   בכל מוצר; שיטות הגבייה בפועל לא אומתו. (בהנחה הזו העלות האפקטיבית
  //   לשנה נמוכה במעט מהשיעור הנקוב, כי כל ניכוי מקטין את הבסיס של הבא.)
  const monthlyFee = (feePct / 100) / 12;

  for (let y = 0; y < years; y++) {
    const annualYield = simAnnualYield(y, stockPct) / 100;
    const monthlyYield = Math.pow(1 + annualYield, 1 / 12) - 1;
    for (let m = 0; m < 12; m++) {
      amount += amount * monthlyYield;
      amount -= amount * monthlyFee;
      growthIndex *= (1 + monthlyYield) * (1 - monthlyFee);
      priceIndex *= (1 + monthlyInflation);
      if (monthly > 0) {
        amount += monthly;
        futureContributions += monthly;
        futureContributionsReal += monthly / priceIndex;
      }
    }
  }

  const gain = amount - totalBalance - futureContributions;
  const realAmount = amount / priceIndex;
  const realGain = realAmount - totalBalance - futureContributionsReal;
  const nominalAnnual = (Math.pow(growthIndex, 1 / years) - 1) * 100;
  const realAnnual = ((1 + nominalAnnual / 100) / (1 + inflationPct / 100) - 1) * 100;

  const finalEl = document.getElementById('simFinalAmount');
  const contribEl = document.getElementById('simTotalContrib');
  const gainEl = document.getElementById('simGainAmount');
  const realFinalEl = document.getElementById('simRealFinalAmount');
  const realGainEl = document.getElementById('simRealGainAmount');
  const annualNominalEl = document.getElementById('simAnnualNominal');
  const annualRealEl = document.getElementById('simAnnualReal');
  const inflationLabelEl = document.getElementById('simInflationLabel');
  const resultsEl = document.getElementById('simResultsBlock');

  if (finalEl) finalEl.textContent = fmtSimCurrency(amount);
  if (contribEl) contribEl.textContent = fmtSimCurrency(futureContributions);
  if (gainEl) {
    gainEl.textContent = fmtSimCurrency(gain);
    gainEl.classList.toggle('sim-positive', gain >= 0);
    gainEl.classList.toggle('sim-negative', gain < 0);
  }
  if (realFinalEl) realFinalEl.textContent = fmtSimCurrency(realAmount);
  if (realGainEl) {
    realGainEl.textContent = fmtSimCurrency(realGain);
    realGainEl.classList.toggle('sim-positive', realGain >= 0);
    realGainEl.classList.toggle('sim-negative', realGain < 0);
  }
  if (annualNominalEl) annualNominalEl.textContent = 'נומינלית ' + fmtSimPercent(nominalAnnual);
  if (annualRealEl) annualRealEl.textContent = 'ריאלית ' + fmtSimPercent(realAnnual);
  if (inflationLabelEl) inflationLabelEl.textContent = fmtSimPercent(inflationPct, 1);
  if (resultsEl) resultsEl.hidden = false;
}
function initSimulationCalculator() {
  const runBtn = document.getElementById('simRunBtn');
  if (runBtn && !runBtn.dataset.bound) {
    runBtn.addEventListener('click', runHistoricalSimulation);
    runBtn.dataset.bound = '1';
  }
  ['simFeeInput', 'simInflationInput'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderSimulationAssumptions);
  });
  renderSimulationAssumptions();
  refreshSimulationDefaults();
}



/* === מגמה חודשית של התיק — גרפים מתוך היסטוריית המאגר === */

const CHART_COLORS = { pos: '#102743', neg: '#c53637', line: '#102743', spark: '#8d949e' };

/* המדדים הזמינים לגרפי המגמה. הצבעים תואמים את צבעי הישויות בדשבורד
   ועברו בדיקת ניגודיות מול המשטח. */
const HIST_METRICS = [
  { id: 'yield', field: 'hist_yield', label: 'שקלול תשואות המסלולים, לפי חודש', type: 'column', color: null, digits: 2 },
  { id: 'stock', field: 'hist_stock', label: 'חשיפה למניות של התיק', type: 'line', color: '#102743', digits: 1 },
  { id: 'foreign', field: 'hist_foreign', label: 'חשיפה לחו״ל', type: 'line', color: '#dcaf61', digits: 1 },
  { id: 'fx', field: 'hist_fx', label: 'חשיפה למט״ח', type: 'line', color: '#7488a1', digits: 1 },
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
/* === שיתוף תיק בקישור ===
   התיק מקודד בחלק ה-# של הכתובת: הדפדפן אינו שולח אותו לשרת, והאתר נשאר
   בלי שרת ובלי אחסון. הקישור מכיל את אותן יתרות שמופיעות ממילא בטקסט
   המשותף. פורמט: [[uid, יתרה, דמי ניהול, דמי ניהול מהפקדה], ...]. */
const SHARE_HASH_KEY = 'p';
function encodeSharedPortfolio() {
  const rows = userFunds
    .filter(item => (Number(item.balance) || 0) > 0)
    .map(item => {
      const row = [item.fund.uid, Math.round(Number(item.balance) || 0)];
      const fee = Number.isFinite(item.managementFee) ? item.managementFee : null;
      const depositFee = Number.isFinite(item.depositFee) ? item.depositFee : null;
      if (fee !== null || depositFee !== null) row.push(fee);
      if (depositFee !== null) row.push(depositFee);
      return row;
    });
  const bytes = new TextEncoder().encode(JSON.stringify(rows));
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeSharedPortfolio(code) {
  const base64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '==='.slice((base64.length + 3) % 4));
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  const rows = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(rows)) throw new Error('bad share payload');
  return rows;
}
function buildShareUrl() {
  if (!window.location || !window.location.href) return '';
  const base = window.location.href.split('#')[0];
  try {
    return base + '#' + SHARE_HASH_KEY + '=' + encodeSharedPortfolio();
  } catch (error) {
    return base;
  }
}
/* קישור ששותף נפתח כתצוגה נפרדת: התיק שבקישור מוצג, אבל אינו נכתב
   לדפדפן ואינו נוגע בתיק השמור. שמירה קורית רק בלחיצה מפורשת. */
let OPEN_DASHBOARD_AFTER_INIT = false;
let SHARED_VIEW = false;
function renderSharedViewBanner() {
  const banner = document.getElementById('sharedViewBanner');
  if (banner) banner.hidden = !SHARED_VIEW;
}
function saveSharedPortfolio() {
  if (!SHARED_VIEW) return;
  let hasSaved = false;
  try { hasSaved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').length > 0; } catch (e) { hasSaved = false; }
  if (hasSaved && !window.confirm('בדפדפן הזה כבר שמור תיק. לשמור את התיק ששותף במקומו? התיק הקודם יימחק.')) return;
  SHARED_VIEW = false;
  missingSavedFunds = [];
  saveState();
  renderSharedViewBanner();
}
function closeSharedPortfolio() {
  if (!SHARED_VIEW) return;
  SHARED_VIEW = false;
  loadState();
  renderSharedViewBanner();
  renderMissingFunds();
  renderFunds();
  if (getTotalBalance() <= 0) {
    document.body.classList.remove('dashboard-reached');
    wizReset();
    wizScrollIntoView();
  }
}
window.saveSharedPortfolio = saveSharedPortfolio;
window.closeSharedPortfolio = closeSharedPortfolio;
function applySharedPortfolioFromUrl() {
  const hash = String(window.location.hash || '').replace(/^#/, '');
  const match = hash.match(new RegExp('(?:^|&)' + SHARE_HASH_KEY + '=([A-Za-z0-9_-]+)'));
  if (!match) return;
  const clearHash = () => {
    try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* ignore */ }
  };
  let rows;
  try {
    rows = decodeSharedPortfolio(match[1]);
  } catch (error) {
    clearHash();
    alert('הקישור ששותף אינו תקין, ולכן התיק לא נטען.');
    return;
  }
  const incoming = [];
  let missing = 0;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const rec = DATA.find(r => r.uid === row[0]);
    const balance = Math.max(0, Number(row[1]) || 0);
    if (!rec) { missing++; continue; }
    if (balance <= 0) continue;
    incoming.push({
      fund: withRuntimeFlags(rec),
      balance,
      managementFee: normalizeUserFee(row[2]),
      depositFee: normalizeUserFee(row[3]),
      updated_at: new Date().toISOString()
    });
  }
  clearHash();
  if (!incoming.length) {
    alert('לא נמצאו בקישור מוצרים שקיימים במאגר הנוכחי.');
    return;
  }
  SHARED_VIEW = true;
  userFunds = incoming;
  missingSavedFunds = [];
  renderSharedViewBanner();
  OPEN_DASHBOARD_AFTER_INIT = true;
  if (missing > 0) alert(`${missing} מהמוצרים בקישור כבר אינם במאגר המעודכן ולא נטענו.`);
}
/* שלוש רמות שיתוף, מהמצומצמת לרחבה. גם "סיכום מלא" בלי קישור שולח יתרות
   ודמי ניהול בתוך ההודעה עצמה, ולכן ברירת המחדל היא חשיפות בלבד.
   - exposure: חשיפות, תשואות מסלולים ומשקל כל מוצר. בלי סכומים ובלי דמי ניהול.
   - full: כמו exposure, ובנוסף יתרות ודמי הניהול שהוזנו.
   - link: כמו full, ובנוסף קישור שפותח את התיק בדשבורד. */
const SHARE_MODES = ['exposure', 'full', 'link'];
function buildShareText(mode) {
  const withAmounts = mode === 'full' || mode === 'link';
  const totalBalance = getTotalBalance();
  const aggStock = weightedMetric('stock_pct', totalBalance);
  const aggForeign = weightedMetric('foreign_pct', totalBalance);
  const aggFx = weightedMetric('fx_pct', totalBalance);
  const perfYtd = weightedMetric('ytd_yield', totalBalance);
  const feeSavings = weightedUserManagementFee(totalBalance);
  const lines = [
    'דשבורד חשיפות חיסכון',
    ...(withAmounts ? [`יתרה כוללת שהוזנה: ${fmtCurrency(totalBalance)}`] : []),
    `חשיפה למניות: ${fmtPct(aggStock, 1)}`,
    `חשיפה לחו״ל: ${fmtPct(aggForeign, 1)}`,
    `חשיפה למט״ח: ${fmtPct(aggFx, 1)}`,
    `שקלול תשואות המסלולים, מתחילת השנה: ${fmtPct(perfYtd, 2)}`,
    `שקלול תשואות המסלולים, מצטברת ל־3 שנים, לפני דמי ניהול: ${fmtPct(weightedMetric('yield_trailing_3yrs', totalBalance), 2)}`,
    ...(withAmounts ? [`דמי הניהול שהוזנו, משוקללים: ${Number.isFinite(feeSavings) ? fmtPct(feeSavings, 2) : 'לא הוזנו'}`] : []),
    `נתוני המסלולים נכונים לדיווח של ${fmtPeriodHebrew(DATASET_MAX_PERIOD)}`
  ];
  // הקישור לפני פירוט המוצרים: כשהטקסט ארוך מדי לווטסאפ מקצרים את הפירוט,
  // והקישור, שמשחזר את התיק המלא, חייב לשרוד.
  const shareUrl = mode === 'link' ? buildShareUrl() : '';
  if (shareUrl) lines.push('', `לפתיחת התיק המלא בדשבורד (הקישור כולל את היתרות ודמי הניהול): ${shareUrl}`);
  lines.push('', 'פירוט החסכונות:');
  const sorted = userFunds.slice().sort((a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0));
  for (const item of sorted) {
    const balance = Number(item.balance) || 0;
    if (balance <= 0) continue;
    const f = item.fund;
    const weight = totalBalance > 0 ? balance / totalBalance * 100 : 0;
    const parts = [SOURCE_LABEL[f.source], f.fund_name];
    if (withAmounts) parts.push(fmtCurrency(balance));
    parts.push(`משקל ${weight.toFixed(1)}%`, `מניות ${fmtPct(f.stock_pct, 1)}`, `חו״ל ${fmtPct(f.foreign_pct, 1)}`, `מט״ח ${fmtPct(f.fx_pct, 1)}`);
    if (withAmounts) parts.push(Number.isFinite(item.managementFee) ? `דמי הניהול שהוזנו ${fmtUserFee(item.managementFee)}` : 'דמי ניהול: לא הוזנו');
    lines.push('- ' + parts.join(' | '));
  }
  lines.push('');
  lines.push(withAmounts
    ? 'הבהרה: הנתונים מבוססים על נתונים ציבוריים של המסלולים ויתרות שהוזנו ידנית. התשואות הן של המסלולים, לפני דמי ניהול. זה אינו ייעוץ או המלצה.'
    : 'הבהרה: הנתונים מבוססים על נתונים ציבוריים של המסלולים, משוקללים לפי יתרות שאינן מוצגות כאן. התשואות הן של המסלולים, לפני דמי ניהול. זה אינו ייעוץ או המלצה.');
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
  const sections = document.querySelectorAll('.dashboard-toggle-section');
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
/* תקציב האורך של הטקסט אחרי קידוד ל-URL. טקסט בעברית תופח פי ~6 בקידוד,
   ודוח עם הרבה מוצרים מייצר כתובת ארוכה מדי שהשרת של ווטסאפ דוחה (414) —
   ואז הלחיצה במחשב נראית כאילו היא פשוט לא עובדת. */
const WHATSAPP_URL_TEXT_BUDGET = 5500;
function fitShareTextForUrl(text) {
  if (encodeURIComponent(text).length <= WHATSAPP_URL_TEXT_BUDGET) return text;
  const lines = text.split('\n');
  // שומרים מקום לשורת ההסבר על הקיצור שתתווסף בהמשך.
  const budgetWhileTrimming = WHATSAPP_URL_TEXT_BUDGET - 300;
  let trimmed = 0;
  // מקצרים קודם את שורות פירוט המוצרים, מהקטנות (בסוף הרשימה) כלפי מעלה.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (encodeURIComponent(lines.join('\n')).length <= budgetWhileTrimming) break;
    if (lines[i].startsWith('- ')) {
      lines.splice(i, 1);
      trimmed++;
    }
  }
  if (trimmed > 0) {
    const marker = lines.indexOf('פירוט החסכונות:');
    const note = `(הפירוט קוצר ב-${trimmed} חסכונות כדי שהקישור יישלח במלואו — הפירוט המלא בדשבורד)`;
    if (marker >= 0) lines.splice(marker + 1, 0, note);
    else lines.push(note);
  }
  let out = lines.join('\n');
  // רשת ביטחון: גם בלי שורות פירוט הטקסט עדיין ארוך מדי.
  while (out.length > 0 && encodeURIComponent(out).length > WHATSAPP_URL_TEXT_BUDGET) {
    out = out.slice(0, Math.floor(out.length * 0.9));
  }
  return out;
}
function buildWhatsAppUrl(text) {
  return 'https://wa.me/?text=' + encodeURIComponent(fitShareTextForUrl(text));
}
/* פתיחת חלון חייבת לקרות באותו tick של הלחיצה, אחרת חוסמי הפופאפים
   במחשב בולעים אותה בשקט. מחזיר false אם החלון נחסם. */
function openShareUrl(url) {
  let win = null;
  try {
    win = window.open(url, '_blank');
  } catch (error) {
    win = null;
  }
  if (!win) return false;
  try { win.opener = null; } catch (error) { /* חלון חוצה-מקור — אין מה לנקות */ }
  return true;
}
/* לפני שיתוף: הקישור לתיק מכיל את היתרות ודמי הניהול, וכל מי שמחזיק בו
   יכול לקרוא אותם. המשתמש בוחר במפורש אם לצרף אותו. הבחירה נעשית
   בלחיצה בתוך הדף, כך שפתיחת ווטסאפ נשארת מחוות משתמש ואינה נחסמת. */
function shareWhatsApp() {
  if (!hasReportData()) {
    alert('כדי לשלוח לווטסאפ צריך להוסיף לפחות מוצר אחד ולהזין יתרה.');
    return;
  }
  const dialog = document.getElementById('shareDialog');
  if (dialog && typeof dialog.showModal === 'function') {
    const def = dialog.querySelector('input[name="shareMode"][value="exposure"]');
    if (def) def.checked = true;
    updateSharePreview();
    dialog.showModal();
    return;
  }
  sendWhatsApp('exposure');
}
function selectedShareMode() {
  const checked = document.querySelector('#shareDialog input[name="shareMode"]:checked');
  return checked && SHARE_MODES.indexOf(checked.value) > -1 ? checked.value : 'exposure';
}
// שיתוף מקורי רק במכשירי מגע. במחשב navigator.share קיים בחלק
// מהדפדפנים אך נכשל, והנפילה חזרה לפתיחת חלון קורית כבר אחרי ה-await —
// כלומר בלי מחוות משתמש, ולכן נחסמת. במחשב ניגשים ישירות לווטסאפ.
function useNativeShare() {
  const touchDevice = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return touchDevice && typeof navigator.share === 'function';
}
/* הטקסט שיישלח בפועל: בקישור לווטסאפ הוא עשוי להתקצר, והתצוגה המקדימה
   מראה את הגרסה המקוצרת. */
function shareTextToSend(mode) {
  const text = buildShareText(mode);
  return useNativeShare() ? text : fitShareTextForUrl(text);
}
function updateSharePreview() {
  const preview = document.getElementById('sharePreview');
  if (preview) preview.value = shareTextToSend(selectedShareMode());
}
function sendSelectedShare() {
  const dialog = document.getElementById('shareDialog');
  const mode = selectedShareMode();
  if (dialog && dialog.open) dialog.close();
  sendWhatsApp(mode);
}
function cancelShare() {
  const dialog = document.getElementById('shareDialog');
  if (dialog && dialog.open) dialog.close();
}
window.updateSharePreview = updateSharePreview;
window.sendSelectedShare = sendSelectedShare;
window.cancelShare = cancelShare;
function sendWhatsApp(mode) {
  const text = shareTextToSend(mode);
  const url = buildWhatsAppUrl(text);
  if (useNativeShare()) {
    navigator.share({ title: 'דשבורד חשיפות חיסכון', text }).catch(error => {
      if (error && error.name === 'AbortError') return;
      // ניווט בטאב הנוכחי אינו נחסם גם ללא מחוות משתמש.
      window.location.href = url;
    });
    return;
  }
  if (!openShareUrl(url)) window.location.href = url;
}
function goToDashboard() {
  if (!hasReportData()) {
    alert('כדי לעבור לדשבורד צריך להוסיף לפחות מוצר אחד ולהזין יתרה.');
    return;
  }
  document.body.classList.remove('simulation-view');
  document.getElementById('simulationTabSection').style.display = 'none';
  renderDashboard();
  if (typeof window.enterDashboardView === 'function') {
    window.enterDashboardView();
  }
  const dashboard = document.getElementById('dashboard');
  if (dashboard) dashboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
/* משתמש חוזר עם תיק שמור נכנס ישר לתיק, לא למסך "מי מנהל את החיסכון שלך?".
   בלי גלילה: הדפדפן משחזר ממילא את מיקום הגלילה ברענון. */
function openSavedPortfolio() {
  renderDashboard();
  if (typeof window.enterDashboardView === 'function') window.enterDashboardView();
}
function resetAllData() {
  if (SHARED_VIEW) { closeSharedPortfolio(); return; }
  const hasData = userFunds.length > 0 || localStorage.getItem(STORAGE_KEY);
  if (!hasData) {
    prepareAnotherFund();
    return;
  }
  const count = userFunds.length + missingSavedFunds.length;
  const ok = window.confirm(`למחוק מהדפדפן הזה את ${count === 1 ? 'המוצר' : 'כל ' + count + ' המוצרים'}, היתרות ודמי הניהול שהוזנו? אי אפשר לבטל את המחיקה.`);
  if (!ok) return;
  userFunds = [];
  missingSavedFunds = [];
  CURRENT_EDIT_FUND = null;
  LAST_FOCUSED_UID = null;
  QUICK_RETURN_VISIBLE = false;
  localStorage.removeItem(STORAGE_KEY);
  renderMissingFunds();
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
/* v5.0: אין יותר פאנל עריכה מתחת לרשימה — שלב היתרה הוא מסך אשף מלא.
   הפונקציות כאן נשארו כנקודות כניסה חיצוניות ומנתבות לאשף. */
function openQuickEditor(fund) {
  if (!fund) return;
  // בתצוגת הדשבורד האשף מוסתר; עריכה מתוך הדוח חייבת להחזיר אותו.
  document.body.classList.remove('dashboard-reached');
  WIZ_FOCUS_FIELD = '';
  const brand = fund._brand || brandOf(fund);
  wizSet({ step: 'balance', pickUid: fund.uid, company: brand || wizard.company, product: fund._product || productOf(fund) });
  wizScrollIntoView();
}
function commitQuickUpdate() { wizCommitBalance(); }
function removeCurrentQuickFund() { wizRemovePicked(); }
function prepareAnotherFund() {
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
/* ביטול הסרה: ה-✕ צמוד לכפתור "עריכה", ולחיצה בטעות קורית. במקום חלון
   אישור לפני כל הסרה — הסרה מיידית והודעה עם "ביטול" לכמה שניות.
   רק ההסרה האחרונה ניתנת לביטול. */
const UNDO_TOAST_MS = 7000;
let UNDO_TIMER = null;
let UNDO_ACTION = null;
function hideUndoToast() {
  const toast = document.getElementById('undoToast');
  if (toast) toast.hidden = true;
  if (UNDO_TIMER) clearTimeout(UNDO_TIMER);
  UNDO_TIMER = null;
  UNDO_ACTION = null;
}
function showUndoToast(message, onUndo) {
  const toast = document.getElementById('undoToast');
  if (!toast) return;
  if (UNDO_TIMER) clearTimeout(UNDO_TIMER);
  document.getElementById('undoToastText').textContent = message;
  UNDO_ACTION = onUndo;
  toast.hidden = false;
  UNDO_TIMER = setTimeout(hideUndoToast, UNDO_TOAST_MS);
}
document.addEventListener('click', event => {
  if (!event.target.closest('#undoToastBtn')) return;
  const action = UNDO_ACTION;
  hideUndoToast();
  if (action) action();
});
function restoreRemovedFund(item, idx) {
  if (findUserFundIndex(item.fund.uid) >= 0) return;
  userFunds.splice(Math.min(idx, userFunds.length), 0, item);
  saveState();
}
function fundRemovedMessage(item) {
  return `${(item.fund && item.fund.fund_name) || 'המוצר'} הוסר מהתיק`;
}

/* הסרת מוצר שנוסף בטעות, מתוך טבלת הפירוט בדשבורד. */
function removeFundByUid(uid) {
  const idx = findUserFundIndex(uid);
  if (idx < 0) return;
  const removed = userFunds[idx];
  // ציור הדשבורד מחדש סוגר את כל האקורדיונים. שומרים את מצבם כדי
  // שהמשתמש יישאר בטבלה שממנה מחק, גם כשהוא מוחק כמה מוצרים ברצף.
  const openState = Array.from(document.querySelectorAll('.dashboard-toggle-section')).map(section => [section, section.open]);
  removeFund(idx);
  openState.forEach(([section, wasOpen]) => { section.open = wasOpen; });
  const emptied = getTotalBalance() <= 0;
  if (emptied) {
    // הדוח התרוקן — הדשבורד מוסתר ממילא, אז מחזירים את המשתמש לאשף.
    document.body.classList.remove('dashboard-reached');
    wizReset();
    wizScrollIntoView();
  }
  showUndoToast(fundRemovedMessage(removed), () => {
    restoreRemovedFund(removed, idx);
    renderFunds();
    openState.forEach(([section, wasOpen]) => { section.open = wasOpen; });
    if (emptied) goToDashboard();
  });
}
document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-edit-uid]');
  if (!trigger) return;
  const idx = findUserFundIndex(trigger.getAttribute('data-edit-uid'));
  if (idx >= 0) openQuickEditor(userFunds[idx].fund);
});
document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-remove-uid]');
  if (!trigger) return;
  removeFundByUid(trigger.getAttribute('data-remove-uid'));
});

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
window.removeFundByUid = removeFundByUid;
window.updateBalance = updateBalance;
window.updateManagementFee = updateManagementFee;
window.handleBalanceInput = handleBalanceInput;
window.handleFeeInput = handleFeeInput;


/* === v5.0: אשף איתור הקופה ===
   כל מצב האשף יושב באובייקט אחד. שדה החיפוש הוא קלט, לא מצב.
   סוג חיסכון ← חברה ← מסלול ← יתרה, כל שלב מסך מלא אחד.
   כל שלב דוחף רשומה להיסטוריית הדפדפן, כך שכפתור "אחורה" של המכשיר
   מחזיר שלב אחורה במקום לצאת מהאתר. */

const RESULTS_PAGE = 6;
// עשר החברות המרכזיות, בסדר התצוגה הקבוע.
const MAIN_COMPANIES = [
  'מנורה מבטחים', 'הפניקס', 'הראל', 'מגדל', 'כלל', 'מיטב',
  'אלטשולר שחם', 'מור', 'אנליסט', 'ילין לפידות'
];

const WIZ_STEP_META = {
  company:      { title: 'בחירת חברה',   progress: 2 },
  allCompanies: { title: 'חיפוש חברה',   progress: 2 },
  unknown:      { title: 'איתור החיסכון', progress: 2 },
  typeFirst:    { title: 'סוג החיסכון',  progress: 1 },
  product:      { title: 'סוג החיסכון',  progress: 1 },
  results:      { title: 'בחירת מסלול',  progress: 3 },
  balance:      { title: 'הזנת יתרה',    progress: 4 },
  done:         { title: 'נוסף לתיק',    progress: 4 }
};
const WIZ_TOTAL_STEPS = 4;

const wizard = {
  step: 'typeFirst',    // company | allCompanies | unknown | typeFirst | product | results | balance | done
  company: '',
  product: '',
  chip: '',
  query: '',
  companyQuery: '',
  pickUid: '',          // המסלול שנבחר, לשלב היתרה
  showExtraProducts: false,
  limit: RESULTS_PAGE,
  globalSearch: false
};

/* --- היסטוריית שלבים: כפתור "אחורה" של המכשיר --- */
let WIZ_HISTORY_READY = false;
let WIZ_POPPING = false;

function wizSnapshot() {
  return {
    step: wizard.step, company: wizard.company, product: wizard.product,
    chip: wizard.chip, query: wizard.query, companyQuery: wizard.companyQuery,
    pickUid: wizard.pickUid, showExtraProducts: wizard.showExtraProducts,
    limit: wizard.limit, globalSearch: wizard.globalSearch
  };
}

// רשומת הבסיס נרשמת פעם אחת, כדי שהלחיצה הראשונה על "אחורה" תחזיר שלב
// ולא תוציא מהאתר.
function wizInitHistory() {
  if (WIZ_HISTORY_READY) return;
  history.replaceState({ wiz: wizSnapshot() }, '');
  WIZ_HISTORY_READY = true;
}

// דחיפה להיסטוריה רק כשהמסך עצמו התחלף. הקלדה בשדה חיפוש או פתיחת עוד
// תוצאות מחליפה את הרשומה הנוכחית, אחרת "אחורה" היה מבטל תו אחד בכל לחיצה.
function wizPushHistory(before) {
  if (WIZ_POPPING) return;
  if (!WIZ_HISTORY_READY) {
    history.replaceState({ wiz: before }, '');
    WIZ_HISTORY_READY = true;
  }
  const state = { wiz: wizSnapshot() };
  if (before.step === wizard.step) history.replaceState(state, '');
  else history.pushState(state, '');
}

window.addEventListener('popstate', event => {
  const snap = event.state && event.state.wiz;
  if (!snap) return;
  WIZ_POPPING = true;
  Object.assign(wizard, snap);
  WIZ_FOCUS_FIELD = '';
  wizRender();
  WIZ_POPPING = false;
});

function wizSet(patch) {
  const before = wizSnapshot();
  Object.assign(wizard, patch);
  wizPushHistory(before);
  wizRender();
}
function wizReset() {
  const before = wizSnapshot();
  Object.assign(wizard, {
    step: 'typeFirst', company: '', product: '', chip: '', query: '', companyQuery: '',
    pickUid: '', showExtraProducts: false, limit: RESULTS_PAGE, globalSearch: false
  });
  wizPushHistory(before);
  wizRender();
}

// היעד של חץ החזרה בכל שלב. null = אין חזרה (המסך הראשון).
function wizBackTarget() {
  switch (wizard.step) {
    case 'allCompanies':
    case 'unknown':
      return { step: 'company', companyQuery: '' };
    case 'company':
      return { step: 'typeFirst', company: '', product: '' };
    case 'typeFirst':
    case 'product':
      return null;
    case 'results':
      return { step: 'company', company: '', chip: '', query: '', globalSearch: false };
    case 'balance':
      return { step: 'results', pickUid: '' };
    default:
      return null;
  }
}

function wizLogo(entry, size) {
  const monogram = `<span class="wiz-monogram">${escapeHtml(entry.monogram || '?')}</span>`;
  const img = entry.logo
    ? `<img src="logos/${escapeHtml(entry.logo)}" alt="" loading="lazy" onerror="this.remove()" />`
    : '';
  return `<span class="wiz-logo${size ? ' wiz-logo-' + size : ''}" aria-hidden="true">${monogram}${img}</span>`;
}

/* --- מסך 1: מי מנהל את החיסכון --- */
function wizScreenCompany() {
  const top = MAIN_COMPANIES
    .map(name => BRAND_BY_NAME[name])
    .filter(entry => entry && (!wizard.product || entry.products[wizard.product]));
  return `
    <h2 class="wiz-title">באיזו חברה?</h2>
    <div class="wiz-company-grid">
      ${top.map(entry => `
        <button type="button" class="wiz-company" data-wiz="company" data-value="${escapeHtml(entry.name)}">
          <span class="wiz-company-name">${escapeHtml(entry.name)}</span>
        </button>`).join('')}
    </div>
    <div class="wiz-links">
      <button type="button" class="wiz-link" data-wiz="allCompanies">חברה אחרת</button>
    </div>
    <button type="button" class="wiz-link wiz-unknown-top" data-wiz="unknown">לא יודע איפה החיסכון מנוהל</button>`;
}

/* --- מסך 2: כל החברות --- */
function wizScreenAllCompanies() {
  const term = normalizeText(wizard.companyQuery);
  const list = brandsForProduct(wizard.product)
    .filter(entry => !term || entry.search.indexOf(term) > -1);
  const rows = list.length
    ? list.map(entry => `
        <button type="button" class="wiz-company-row" data-wiz="company" data-value="${escapeHtml(entry.name)}">
          <span class="wiz-company-name">${escapeHtml(entry.name)}</span>
        </button>`).join('')
    : `<p class="wiz-empty-note">לא מצאנו חברה בשם הזה. אפשר לנסות חלק מהשם, או לחזור ולבחור מהחברות המרכזיות.</p>`;
  return `
    <h2 class="wiz-title">איזו חברה?</h2>
    <div class="wiz-field wiz-field-search">
      <input type="search" id="wizCompanySearch" class="wiz-input" placeholder="שם החברה" value="${escapeHtml(wizard.companyQuery)}" autocomplete="off" />
    </div>
    <div class="wiz-company-list">${rows}</div>`;
}

/* --- מסך 3: אני לא יודע --- */
function wizScreenUnknown() {
  return `
    <h2 class="wiz-title">איפה אפשר למצוא את שם החברה?</h2>
    <ul class="wiz-hints">
      <li>בדוח השנתי או הרבעוני שהגיע בדואר או במייל</li>
      <li>בתלוש השכר, בשורת ההפרשות לפנסיה ולהשתלמות</li>
      <li>באזור האישי באתר החברה המנהלת</li>
    </ul>
    <p class="wiz-note">הכלי אינו מתחבר למסלקה הפנסיונית ואינו מושך נתונים אישיים — הוא עוזר לך לאתר את הקופה במאגר הציבורי ולהזין את היתרה בעצמך.</p>
    <div class="wiz-links">
      <a class="wiz-link wiz-link-strong" href="https://www.gov.il/he/service/pension_savings_search" target="_blank" rel="noopener noreferrer">איתור חסכונות בהר הכסף</a>
      <button type="button" class="wiz-link" data-wiz="typeFirst">אני יודע רק מה סוג החיסכון</button>
    </div>`;
}

/* --- מסך 4: סוג החיסכון --- */
function wizProductButton(key) {
  const item = PRODUCT_TYPES.filter(entry => entry.key === key)[0];
  if (!item) return '';
  return `
    <button type="button" class="wiz-choice" data-wiz="product" data-value="${escapeHtml(item.key)}">
      <span class="wiz-choice-text">
        <span class="wiz-choice-title">${escapeHtml(item.label)}</span>
        
      </span>
      <span class="wiz-chevron" aria-hidden="true"></span>
    </button>`;
}
function wizScreenProduct() {
  const keys = (wizard.company ? productsForBrand(wizard.company) : PRODUCT_ORDER)
    .filter(key => PRODUCT_ORDER.slice(0, PRIMARY_PRODUCTS_SHOWN).includes(key));
  return `
    <h2 class="wiz-title">איזה חיסכון להוסיף?</h2>
    <div class="wiz-choices">${keys.map(wizProductButton).join('')}</div>`;
}

/* --- מסך 5: מסלולים --- */
function wizResultRow(rec) {
  const chosen = findUserFundIndex(rec.uid) >= 0;
  return `
    <button type="button" class="wiz-result${chosen ? ' is-chosen' : ''}" data-wiz="pick" data-value="${escapeHtml(rec.uid)}">
      <span class="wiz-result-body">
        <span class="wiz-result-name">${escapeHtml(rec.fund_name)}</span>
        <span class="wiz-result-meta">${escapeHtml([trackLabel(rec), 'קופה ' + (rec.fund_id || '')].filter(Boolean).join(' · '))}</span>
      </span>
      ${chosen ? '<span class="wiz-result-flag">בתיק</span>' : ''}
      <span class="wiz-chevron" aria-hidden="true"></span>
    </button>`;
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
    body = `<div class="wiz-results">${visible.map(wizResultRow).join('')}</div>`;
  }

  // שם המסלול הוא מה שכתוב בדוח שביד המשתמש — זה הקלט המהיר ביותר שיש לו,
  // ולכן שדה החיפוש גלוי מיד. הצ'יפים נשארים מתחתיו כסינון משני.
  const title = wizard.globalSearch ? 'חיפוש בכל החברות' : 'איזה מסלול?';
  return `
    <h2 class="wiz-title">${title}</h2>
    <p class="wiz-sub">בחר את המסלול שמופיע בדוח שלך. ${results.length} מסלולים${wizard.query || wizard.chip ? ' תואמים' : ''}.</p>
    <div class="wiz-field wiz-field-search">
      <input type="search" id="wizTrackSearch" class="wiz-input" placeholder="חיפוש לפי שם מסלול או מספר קופה" value="${escapeHtml(wizard.query)}" autocomplete="off" />
    </div>
    ${chips.length ? `<div class="wiz-chips">
      ${chips.map(chip => `<button type="button" class="wiz-chip${wizard.chip === chip.key ? ' is-on' : ''}" data-wiz="chip" data-value="${escapeHtml(chip.key)}">${escapeHtml(chip.label)}</button>`).join('')}
    </div>` : ''}
    ${body}
    ${results.length > visible.length ? '<button type="button" class="wiz-more" data-wiz="more">הצג עוד מסלולים</button>' : ''}
    ${wizard.globalSearch ? '' : '<button type="button" class="wiz-link wiz-not-found" data-wiz="globalSearch">המסלול לא ברשימה? חפש בכל החברות</button>'}`;
}

/* --- מסך 6: יתרה. מסך מלא, לא פאנל מתחת לרשימה. --- */
function wizPickedFund() {
  if (!wizard.pickUid) return null;
  return DATA.filter(item => item.uid === wizard.pickUid)[0] || null;
}
function wizScreenBalance() {
  const rec = wizPickedFund();
  if (!rec) return wizScreenResults();
  const existingIndex = findUserFundIndex(rec.uid);
  const existing = existingIndex >= 0 ? userFunds[existingIndex] : null;
  const balanceValue = existing && Number(existing.balance) > 0 ? Number(existing.balance) : '';
  const feeValue = existing && Number.isFinite(existing.managementFee) ? existing.managementFee : '';
  // בפנסיה נגבים שני דמי ניהול נפרדים, ובהשוואה הם מוצגים בנפרד.
  const isPension = rec.source === 'pensia';
  const depositFeeValue = existing && Number.isFinite(existing.depositFee) ? existing.depositFee : '';
  const brand = BRAND_BY_NAME[rec._brand];
  // דמי הניהול מקופלים: ברגע ההוספה רוב האנשים עוד לא יודעים אותם, והם
  // מתבקשים שוב ברשימת המוצרים, ליד ממוצע המסלולים הדומים. מי שכבר הזין
  // אותם רואה אותם פתוחים.
  const feesOpen = feeValue !== '' || depositFeeValue !== '';
  return `
    <div class="wiz-picked">
      ${brand ? wizLogo(brand, 'lg') : ''}
      <div class="wiz-picked-text">
        <div class="wiz-picked-name">${escapeHtml(rec.fund_name)}</div>
        <div class="wiz-picked-meta">${escapeHtml([trackLabel(rec), 'קופה ' + (rec.fund_id || '')].filter(Boolean).join(' · '))}</div>
        ${trackNote(rec) ? `<div class="wiz-picked-note">${escapeHtml(trackNote(rec))}</div>` : ''}
      </div>
      <div class="wiz-spark" id="quickEditorSpark" dir="ltr"></div>
    </div>
    <h2 class="wiz-title">כמה צבור במסלול הזה?</h2>
    <p class="wiz-sub">היתרה נשמרת בדפדפן שלך בלבד ואינה נשלחת לשום מקום.</p>
    <div class="wiz-money-field">
      <span class="wiz-money-sign" aria-hidden="true">₪</span>
      <input type="number" class="wiz-money-input" id="quickBalanceInput" value="${escapeHtml(balanceValue)}" placeholder="0" min="0" inputmode="numeric" enterkeyhint="done" />
    </div>
    ${feesOpen ? '' : `<button type="button" class="wiz-fees-toggle" data-wiz="showFees" aria-expanded="false" aria-controls="wizFees">יש לך גם את דמי הניהול? <span class="wiz-optional">לא חובה</span></button>`}
    <div class="wiz-fees" id="wizFees"${feesOpen ? '' : ' hidden'}>
    <label class="wiz-fee-field">
      <span class="wiz-fee-label">דמי ניהול מצבירה <span class="wiz-optional">לא חובה</span></span>
      <span class="wiz-fee-input">
        <input type="number" id="quickFeeInput" value="${escapeHtml(feeValue)}" placeholder="0.00" min="0" step="0.01" inputmode="decimal" />
        <span class="wiz-fee-sign">%</span>
      </span>
    </label>
    ${isPension ? `<label class="wiz-fee-field">
      <span class="wiz-fee-label">דמי ניהול מהפקדות <span class="wiz-optional">לא חובה</span></span>
      <span class="wiz-fee-input">
        <input type="number" id="quickDepositFeeInput" value="${escapeHtml(depositFeeValue)}" placeholder="0.00" min="0" step="0.01" inputmode="decimal" />
        <span class="wiz-fee-sign">%</span>
      </span>
    </label>` : ''}
    </div>
    <div class="wiz-cta-bar">
      <button type="button" class="wiz-cta" data-wiz="commit">${existing ? 'עדכן בתיק' : 'הוסף לתיק'}</button>
      ${existing ? '<button type="button" class="wiz-cta-ghost" data-wiz="removePicked">הסר מהתיק</button>' : ''}
    </div>`;
}

/* --- מסך 7: אישור והמשך. הקופה השנייה מתחילה קרוב יותר ליעד.
   שלוש האפשרויות זהות במשקל: אין כאן צעד "נכון" אחד — מי שסיים רוצה
   לראות את התמונה, ומי שיש לו עוד קופות רוצה להוסיף אותן לפני כן. --- */
function wizScreenDone() {
  const rec = wizPickedFund();
  const count = userFunds.length;
  const total = userFunds.reduce((sum, item) => sum + (Number(item.balance) || 0), 0);
  return `
    <div class="wiz-done-mark" aria-hidden="true"></div>
    <h2 class="wiz-title">${rec ? escapeHtml(rec.fund_name) : 'המוצר'} נוסף לתיק</h2>
    <p class="wiz-sub">${count === 1 ? 'חיסכון אחד' : count + ' חסכונות'} בתיק · ${fmtCurrency(total)} יתרה כוללת שהוזנה</p>
    <div class="wiz-done-actions">
      <button type="button" class="wiz-done-btn" data-wiz="dashboard">הצג את התמונה המלאה</button>
      ${wizard.company ? `<button type="button" class="wiz-done-btn" data-wiz="anotherSameCompany">עוד חיסכון ב${escapeHtml(wizard.company)}</button>` : ''}
      <button type="button" class="wiz-done-btn" data-wiz="reset">הוספת חיסכון נוסף</button>
    </div>`;
}

/* --- סרגל עליון: חזרה, כותרת שלב, פס התקדמות --- */
function wizRenderBar() {
  const bar = document.getElementById('wizBar');
  if (!bar) return;
  const meta = WIZ_STEP_META[wizard.step] || WIZ_STEP_META.company;
  const back = wizBackTarget();
  const pct = Math.round(meta.progress / WIZ_TOTAL_STEPS * 100);
  bar.innerHTML = `
    <div class="wiz-bar-row">
      ${back ? '<button type="button" class="wiz-back" data-wiz="back" aria-label="חזרה"></button>' : '<span class="wiz-back-placeholder" aria-hidden="true"></span>'}
      <span class="wiz-bar-title">${escapeHtml(meta.title)}</span>
      ${wizExitButton()}
    </div>
    <div class="wiz-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${WIZ_TOTAL_STEPS}" aria-valuenow="${meta.progress}">
      <span class="wiz-progress-fill" style="width:${pct}%"></span>
    </div>`;
}

/* מי שיש לו תיק רואה "חזרה לתיק" במקום "התחל מחדש": האשף הוא תוספת
   לתיק, ו"התחל מחדש" נקרא כמו מחיקתו. */
function wizExitButton() {
  if (hasReportData()) return '<button type="button" class="wiz-bar-reset" data-wiz="dashboard">חזרה לתיק</button>';
  if (wizard.step === 'typeFirst') return '<span class="wiz-back-placeholder" aria-hidden="true"></span>';
  return '<button type="button" class="wiz-bar-reset" data-wiz="reset">התחל מחדש</button>';
}

/* --- שורת ההקשר: מה כבר נבחר --- */
function wizRenderCrumbs() {
  const wrap = document.getElementById('wizCrumbs');
  if (!wrap) return;
  const parts = [];
  if (wizard.step === 'done') { wrap.innerHTML = ''; wrap.hidden = true; return; }
  if (wizard.product && wizard.step !== 'typeFirst' && wizard.step !== 'product') {
    parts.push(`<button type="button" class="wiz-crumb" data-wiz="crumbProduct">${escapeHtml(PRODUCT_LABEL[wizard.product] || '')}</button>`);
  }
  if (wizard.company && (wizard.step === 'results' || wizard.step === 'balance')) {
    parts.push(`<button type="button" class="wiz-crumb" data-wiz="crumbCompany">${escapeHtml(wizard.company)}</button>`);
  }
  wrap.innerHTML = parts.join('<span class="wiz-crumb-sep" aria-hidden="true">·</span>');
  wrap.hidden = !parts.length;
}

function wizRender() {
  const screen = document.getElementById('wizScreen');
  if (!screen) return;
  wizInitHistory();
  let html = '';
  if (wizard.step === 'allCompanies') html = wizScreenAllCompanies();
  else if (wizard.step === 'unknown') html = wizScreenUnknown();
  else if (wizard.step === 'product' || wizard.step === 'typeFirst') html = wizScreenProduct();
  else if (wizard.step === 'results') html = wizScreenResults();
  else if (wizard.step === 'balance') html = wizScreenBalance();
  else if (wizard.step === 'done') html = wizScreenDone();
  else html = wizScreenCompany();
  screen.innerHTML = html;
  const wrap = document.getElementById('wizard');
  if (wrap) wrap.dataset.step = wizard.step;
  wizRenderBar();
  wizRenderCrumbs();
  wizSyncShell();
  if (wizard.step === 'balance') {
    const rec = wizPickedFund();
    if (rec) renderQuickSpark(document.getElementById('quickEditorSpark'), withRuntimeFlags(rec));
    const input = document.getElementById('quickBalanceInput');
    if (input && !WIZ_FOCUS_FIELD) window.setTimeout(() => { input.focus({ preventScroll: true }); input.select(); }, 120);
  }
  wizRestoreFocus();
}

// כל עוד אין מוצר בתיק, מתחת לאשף אין דשבורד ואין טקסטים ארוכים —
// רק שורת קישורים דקה. זה מה שמפריד בין "אפליקציה" ל"מסמך גלילה".
function wizSyncShell() {
  document.body.classList.toggle('pre-result', !userFunds.length);
  document.body.classList.toggle('wiz-flow', wizard.step !== 'done');
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
    wizSet({ company: name, product: products[0], step: 'results', chip: '', query: '', limit: RESULTS_PAGE, globalSearch: false });
    return;
  }
  wizSet({ company: name, product: '', step: 'product', showExtraProducts: false });
}

/* --- שמירת היתרה --- */
function wizCommitBalance() {
  const rec = wizPickedFund();
  if (!rec) return;
  const balanceInput = document.getElementById('quickBalanceInput');
  const feeInput = document.getElementById('quickFeeInput');
  const depositFeeInput = document.getElementById('quickDepositFeeInput');
  const balance = Math.max(0, Number(balanceInput ? balanceInput.value : 0) || 0);
  const fee = normalizeUserFee(feeInput ? feeInput.value : null);
  const depositFee = normalizeUserFee(depositFeeInput ? depositFeeInput.value : null);
  if (balance <= 0) {
    const field = document.querySelector('.wiz-money-field');
    if (field) {
      field.classList.add('is-invalid');
      window.setTimeout(() => field.classList.remove('is-invalid'), 1600);
    }
    if (balanceInput) balanceInput.focus();
    return;
  }
  const fund = withRuntimeFlags(rec);
  const idx = findUserFundIndex(fund.uid);
  const payload = { fund, balance, managementFee: fee, depositFee, updated_at: new Date().toISOString() };
  if (idx >= 0) userFunds[idx] = payload;
  else userFunds.push(payload);
  saveState();
  renderDashboard();
  WIZ_FOCUS_FIELD = '';
  wizSet({ step: 'done' });
  wizScrollIntoView();
}
function wizRemovePicked() {
  const rec = wizPickedFund();
  if (!rec) return;
  const idx = findUserFundIndex(rec.uid);
  if (idx >= 0) {
    const removed = userFunds[idx];
    userFunds.splice(idx, 1);
    saveState();
    renderDashboard();
    showUndoToast(fundRemovedMessage(removed), () => {
      restoreRemovedFund(removed, idx);
      renderDashboard();
      wizSyncShell();
      wizRenderBar();
    });
  }
  wizSet({ step: 'results', pickUid: '' });
}

function wizHandle(action, value) {
  if (action === 'back') {
    const target = wizBackTarget();
    if (target) { WIZ_FOCUS_FIELD = ''; history.back(); }
    return;
  }
  if (action === 'company') {
    if (wizard.product) {
      const entry = BRAND_BY_NAME[value];
      if (!entry || !entry.products[wizard.product]) return;
      wizSet({ company: value, step: 'results', chip: '', query: '', limit: RESULTS_PAGE, globalSearch: false });
      return;
    }
    wizAfterCompany(value);
    return;
  }
  if (action === 'allCompanies') { WIZ_FOCUS_FIELD = 'wizCompanySearch'; wizSet({ step: 'allCompanies', companyQuery: '' }); return; }
  if (action === 'unknown') { wizSet({ step: 'unknown' }); return; }
  if (action === 'typeFirst') { wizSet({ step: 'typeFirst', company: '', product: '' }); return; }
  if (action === 'moreProducts') { wizSet({ showExtraProducts: !wizard.showExtraProducts }); return; }
  if (action === 'product') {
    if (wizard.step === 'typeFirst' || !wizard.company) { wizSet({ product: value, company: '', step: 'company', chip: '', query: '', globalSearch: false }); return; }
    wizSet({ product: value, step: 'results', chip: '', query: '', limit: RESULTS_PAGE, globalSearch: false });
    return;
  }
  if (action === 'chip') { wizSet({ chip: wizard.chip === value ? '' : value, limit: RESULTS_PAGE }); return; }
  if (action === 'more') { wizSet({ limit: wizard.limit + RESULTS_PAGE }); return; }
  if (action === 'clearFilters') { WIZ_FOCUS_FIELD = ''; wizSet({ chip: '', query: '', limit: RESULTS_PAGE }); return; }
  if (action === 'globalSearch') { WIZ_FOCUS_FIELD = 'wizTrackSearch'; wizSet({ globalSearch: true, limit: RESULTS_PAGE }); return; }
  if (action === 'crumbCompany') { wizSet({ step: 'company', company: '', chip: '', query: '', globalSearch: false }); return; }
  if (action === 'crumbProduct') { wizSet({ step: 'typeFirst', company: '', product: '', chip: '', query: '', globalSearch: false }); return; }
  if (action === 'reset') { WIZ_FOCUS_FIELD = ''; wizReset(); wizScrollIntoView(); return; }
  if (action === 'pick') { WIZ_FOCUS_FIELD = ''; wizSet({ step: 'balance', pickUid: value }); wizScrollIntoView(); return; }
  if (action === 'commit') { wizCommitBalance(); return; }
  if (action === 'showFees') {
    const fees = document.getElementById('wizFees');
    if (fees) fees.hidden = false;
    const toggle = document.querySelector('.wiz-fees-toggle');
    if (toggle) toggle.remove();
    const input = document.getElementById('quickFeeInput');
    if (input) input.focus();
    return;
  }
  if (action === 'removePicked') { wizRemovePicked(); return; }
  if (action === 'dashboard') { goToDashboard(); return; }
  if (action === 'anotherSameCompany') {
    // הקופה השנייה של אותו משתמש היא כמעט תמיד באותה חברה. חוזרים לשלב
    // הסוג (או ישר למסלולים) במקום להתחיל מרשת החברות.
    const products = wizard.company ? productsForBrand(wizard.company) : [];
    if (products.length > 1) wizSet({ step: 'product', product: '', pickUid: '', showExtraProducts: false });
    else wizSet({ step: 'results', pickUid: '', chip: '', query: '', limit: RESULTS_PAGE, globalSearch: false });
    wizScrollIntoView();
    return;
  }
}

document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-wiz]');
  if (!trigger || !document.getElementById('wizard') || !document.getElementById('wizard').contains(trigger)) return;
  if (trigger.tagName === 'A') return;
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
document.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  if (event.target.id === 'quickBalanceInput' || event.target.id === 'quickFeeInput'
      || event.target.id === 'quickDepositFeeInput') {
    event.preventDefault();
    wizCommitBalance();
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
    // האינדקסים קודם: loadState מעתיק כל רשומה (withRuntimeFlags), ועותק שנוצר
    // לפני שהשדות הנגזרים (_product, _cmpCategory...) נכתבו לרשומה נשאר בלעדיהם —
    // וכך ההשוואה למסלולים דומים נעלמה אחרי כל רענון.
    buildWizardIndexes();
    buildComparisonIndexes();
    loadState();
    applySharedPortfolioFromUrl();
    renderMissingFunds();
    wizRender();
    renderFunds();
    if (OPEN_DASHBOARD_AFTER_INIT) goToDashboard();
    else if (hasReportData()) openSavedPortfolio();
    // קישור ששותף שנפתח בלשונית שהאתר כבר פתוח בה משנה רק את ה-#, בלי טעינה.
    window.addEventListener('hashchange', () => {
      OPEN_DASHBOARD_AFTER_INIT = false;
      applySharedPortfolioFromUrl();
      if (!OPEN_DASHBOARD_AFTER_INIT) return;
      renderMissingFunds();
      renderFunds();
      goToDashboard();
    });
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
    exposure: '<strong>חשיפה למניות ולמט״ח</strong>חשיפה למניות = החלק מההשקעה שלך המושקע במניות (חשוף לתנודות שוק, פוטנציאל תשואה וסיכון גבוהים יותר). חשיפה למט״ח = החלק מההשקעה שערכו מושפע משערי מטבעות זרים (בעיקר דולר). המדדים מתארים חשיפה, ואינם מדידה מלאה של רמת הסיכון.',
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




/* תצוגת דמי ניהול נפרדת וניווט לסימולציה; החישובים נשארים ללא שינוי. */
function renderFeeRows(activeItems) {
  const wrap = document.getElementById('feeRows');
  if (!wrap) return;
  wrap.innerHTML = activeItems.slice().sort((a, b) => b.balance - a.balance).map(item => {
    const cmp = compareToPeers(item.fund, item.managementFee, item.depositFee);
    const { title, track } = productTitleParts(item);
    return `<article class="fee-row"><div class="fee-row-head"><div><h4>${escapeHtml(title)}</h4><p>${escapeHtml(track)}</p></div><button type="button" class="dashboard-secondary fee-edit-btn" data-fee-open-uid="${escapeHtml(item.fund.uid)}">עדכון</button></div>
      <dl class="fee-comparisons">${feeRowsFor(item, cmp).map(row => `<div><dt>${isPensionFund(item.fund) ? (row.field === 'depositFee' ? 'מהפקדות' : 'מצבירה') : 'מצבירה'}</dt><dd><span>דמי הניהול שלך <b>${fmtUserFee(item[row.field])}</b></span><span>ממוצע קבוצת ההשוואה <b>${fmtCmp(row.peer && row.peer.peers, 2)}</b></span></dd></div>`).join('')}</dl></article>`;
  }).join('');
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-fee-open-uid]');
  if (!button) return;
  const uid = button.dataset.feeOpenUid;
  setProductOpen(uid, true);
  document.querySelector(`#detailsRows .product[data-product-uid="${CSS.escape(uid)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
function renderSimulationAssumptions() {
  const el = document.getElementById('simAdvancedSummary');
  const fee = readSimFeePct(weightedUserManagementFee(getTotalBalance()));
  if (el) el.textContent = `דמי ניהול ${fee.toFixed(2)}% · אינפלציה ${readSimInflationPct().toFixed(1)}%`;
}
let simulationReturnScroll = 0;
function showSimulationView() {
  document.body.classList.add('simulation-view');
  document.getElementById('simulationTabSection').style.display = 'block';
  refreshSimulationDefaults();
  renderSimulationAssumptions();
  window.scrollTo({ top: 0, behavior: 'auto' });
  document.getElementById('simulationTitle').focus({ preventScroll: true });
}
function openSimulationView() {
  if (!SIMULATION_ENABLED || !hasReportData()) return;
  simulationReturnScroll = window.scrollY;
  history.pushState({ ...history.state, savingsView: 'simulation' }, '');
  showSimulationView();
}
function restorePortfolioView() {
  document.body.classList.remove('simulation-view');
  document.getElementById('simulationTabSection').style.display = 'none';
  window.scrollTo({ top: simulationReturnScroll, behavior: 'auto' });
  document.getElementById('openSimulationBtn').focus({ preventScroll: true });
}
function closeSimulationView() {
  if (history.state?.savingsView === 'simulation') history.back();
  else restorePortfolioView();
}
window.addEventListener('popstate', event => {
  if (event.state?.savingsView === 'simulation') showSimulationView();
  else if (document.body.classList.contains('simulation-view')) restorePortfolioView();
});

