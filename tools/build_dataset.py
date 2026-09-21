# -*- coding: utf-8 -*-
"""בניית funds_unified.json מקובצי המקור של גמל-נט / פנסיה-נט / ביטוח-נט.

שימוש חודשי:
    python3 tools/build_dataset.py \
        --gemel gemel.xlsx --pensia pensia.xlsx --bituach bituach.xlsx \
        --prev funds_unified.json -o funds_unified.json

בדיקת קובץ קיים בלבד (בלי בנייה):
    python3 tools/build_dataset.py --check funds_unified.json

קובצי המקור הם הייצוא הציבורי מ-data.gov.il (גמל-נט, פנסיה-נט, ביטוח-נט),
ב-xlsx או csv, עם שמות העמודות המקוריים (FUND_ID, REPORT_PERIOD, ...).
הסקריפט שומר על אותו סכמת פלט שהדשבורד כבר קורא, ומסרב לכתוב קובץ
שנכשל בבדיקות השפיות.
"""

import argparse
import csv
import datetime as dt
import json
import re
import sys
from pathlib import Path

SOURCES = {
    'gemelnet': {
        'label': 'גמל',
        'group_label': 'גמל / השתלמות / גמל להשקעה',
        'legal_id_col': 'MANAGING_CORPORATION_LEGAL_ID',
    },
    'pensia': {
        'label': 'פנסיה',
        'group_label': 'קרנות פנסיה',
        'legal_id_col': 'MANAGING_CORPORATION_LEGAL_ID',
    },
    'bituach': {
        'label': 'ביטוח',
        'group_label': 'פוליסות חיסכון',
        'legal_id_col': 'PARENT_COMPANY_LEGAL_ID',
    },
}

# עמודת מקור -> שדה פלט. עמודה חסרה במקור מסוים נשארת ריקה בפלט,
# כפי שקורה היום (למשל SPECIALIZATION קיימת רק בגמל).
STRING_FIELDS = [
    ('FUND_ID', 'fund_id'),
    ('FUND_NAME', 'fund_name'),
    ('PARENT_COMPANY_ID', 'parent_company_id'),
    ('PARENT_COMPANY_NAME', 'parent_company_name'),
    ('MANAGING_CORPORATION', 'managing_corp'),
    ('CONTROLLING_CORPORATION', 'controlling_corp'),
    ('FUND_CLASSIFICATION', 'classification'),
    ('SPECIALIZATION', 'specialization'),
    ('SUB_SPECIALIZATION', 'sub_specialization'),
    ('TARGET_POPULATION', 'target_population'),
]
DATE_FIELDS = [
    ('INCEPTION_DATE', 'inception_date'),
    ('CURRENT_DATE', 'current_date'),
]
NUMERIC_FIELDS = [
    ('TOTAL_ASSETS', 'total_assets'),
    ('AVG_ANNUAL_MANAGEMENT_FEE', 'avg_annual_management_fee'),
    ('AVG_DEPOSIT_FEE', 'avg_deposit_fee'),
    ('MONTHLY_YIELD', 'monthly_yield'),
    ('YEAR_TO_DATE_YIELD', 'ytd_yield'),
    ('ACTUARIAL_ADJUSTMENT', 'actuarial_adjustment'),
    ('YIELD_TRAILING_3_YRS', 'yield_trailing_3yrs'),
    ('YIELD_TRAILING_5_YRS', 'yield_trailing_5yrs'),
    ('AVG_ANNUAL_YIELD_TRAILING_3YRS', 'avg_annual_yield_3yrs'),
    ('AVG_ANNUAL_YIELD_TRAILING_5YRS', 'avg_annual_yield_5yrs'),
    ('STANDARD_DEVIATION', 'standard_deviation'),
    ('ALPHA', 'alpha'),
    ('SHARPE_RATIO', 'sharpe_ratio'),
    ('LIQUID_ASSETS_PERCENT', 'liquid_pct'),
]
EXPOSURE_COLS = ['STOCK_MARKET_EXPOSURE', 'FOREIGN_EXPOSURE', 'FOREIGN_CURRENCY_EXPOSURE']
EXPOSURE_FIELDS = [
    ('STOCK_MARKET_EXPOSURE', 'stock_exp_abs', 'stock_pct'),
    ('FOREIGN_EXPOSURE', 'foreign_exp_abs', 'foreign_pct'),
    ('FOREIGN_CURRENCY_EXPOSURE', 'fx_exp_abs', 'fx_pct'),
]

# שדות שהדשבורד לא קורא. בברירת מחדל הם מושמטים מהפלט כדי להקטין את
# הקובץ שנטען בדפדפן; --full משאיר אותם. הבדיקות רצות על הנתונים המלאים
# לפני ההשמטה.
# inception_date, first_seen_period ודמי הניהול נשארים: השוואת המסלול לקבוצתו
# נשענת עליהם (ותק של 36 חודשים, ודמי ניהול ממוצעים בפועל).
SLIM_DROP_FIELDS = [
    'source_label', 'parent_company_id', 'current_date',
    'actuarial_adjustment',
    'yield_trailing_5yrs', 'avg_annual_yield_3yrs', 'avg_annual_yield_5yrs',
    'standard_deviation', 'alpha', 'sharpe_ratio',
    'stock_exp_abs', 'foreign_exp_abs', 'fx_exp_abs', 'legal_id',
]


def slim_payload(payload):
    payload['funds'] = [
        {k: v for k, v in f.items() if k not in SLIM_DROP_FIELDS}
        for f in payload['funds']
    ]
    return payload


# סדר השדות ברשומת הפלט — זהה לקובץ הקיים כדי שההשוואות בגיט יהיו נקיות.
OUTPUT_FIELD_ORDER = [
    'uid', 'source', 'source_label', 'fund_id', 'fund_name',
    'parent_company_id', 'parent_company_name', 'managing_corp',
    'controlling_corp', 'classification', 'specialization',
    'sub_specialization', 'target_population', 'report_period',
    'inception_date', 'current_date', 'total_assets',
    'avg_annual_management_fee', 'avg_deposit_fee', 'monthly_yield',
    'ytd_yield', 'actuarial_adjustment', 'yield_trailing_3yrs',
    'yield_trailing_5yrs', 'avg_annual_yield_3yrs', 'avg_annual_yield_5yrs',
    'standard_deviation', 'alpha', 'sharpe_ratio', 'liquid_pct',
    'stock_exp_abs', 'foreign_exp_abs', 'fx_exp_abs',
    'stock_pct', 'foreign_pct', 'fx_pct', 'legal_id', 'is_active', 'first_seen_period',
    'hist_start', 'hist_yield', 'hist_stock', 'hist_foreign', 'hist_fx', 'hist_liquid',
]


def read_rows(path):
    """קורא xlsx או csv ומחזיר (headers, רשימת dict)."""
    path = Path(path)
    if path.suffix.lower() in ('.xlsx', '.xlsm'):
        import openpyxl
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)
        headers = [str(h).strip() if h is not None else '' for h in next(rows_iter)]
        rows = []
        for raw in rows_iter:
            if raw is None or all(v is None or v == '' for v in raw):
                continue
            rows.append(dict(zip(headers, raw)))
        wb.close()
        return headers, rows
    # csv
    for enc in ('utf-8-sig', 'cp1255'):
        try:
            with open(path, newline='', encoding=enc) as fh:
                reader = csv.DictReader(fh)
                headers = [h.strip() for h in (reader.fieldnames or [])]
                rows = [dict(zip(headers, [row.get(h) for h in (reader.fieldnames or [])])) for row in fh_rows(reader)]
            return headers, rows
        except UnicodeDecodeError:
            continue
    raise SystemExit(f'לא הצלחתי לקרוא את {path} (קידוד לא מזוהה)')


def fh_rows(reader):
    for row in reader:
        if any((v or '').strip() for v in row.values() if isinstance(v, str)):
            yield row


def to_num(value):
    if value is None or value == '':
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(',', '').strip())
    except ValueError:
        return None


# תיקוני טקסט לפגמים ידועים בקובצי המקור. נכון ל-202607 נצפה פגם אחד:
# בקובץ פנסיה-נט התו & בשם "S&P" מגיע כרצף "1;" (18 קופות), בעוד שבגמל
# ובביטוח אותו שם תקין. התיקון מחליף רק את התו הפגום ושומר על אותיות
# המקור, כך ש-"s1;p 500" הופך ל-"s&p 500" ו-"S1;P500" ל-"S&P500".
TEXT_REPAIRS = [
    (re.compile(r'([Ss])1;([Pp])'), r'\1&\2'),
]


def repair_text(value):
    for pattern, replacement in TEXT_REPAIRS:
        value = pattern.sub(replacement, value)
    return value


def to_str(value):
    if value is None:
        return ''
    return repair_text(str(value))


def to_iso_date(value):
    if value is None or value == '':
        return ''
    if isinstance(value, dt.datetime):
        return value.strftime('%Y-%m-%dT%H:%M:%S')
    if isinstance(value, dt.date):
        return value.strftime('%Y-%m-%dT00:00:00')
    s = str(value).strip()
    for fmt in ('%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%d/%m/%Y'):
        try:
            return dt.datetime.strptime(s, fmt).strftime('%Y-%m-%dT%H:%M:%S')
        except ValueError:
            continue
    return s


def to_period(value):
    n = to_num(value)
    if n is None:
        return None
    p = int(n)
    if not (200000 <= p <= 210012 and 1 <= p % 100 <= 12):
        return None
    return p


def rnd(value, digits=2):
    return None if value is None else round(value, digits)


HISTORY_MONTHS = 24


def period_add(period, months):
    idx = (period // 100) * 12 + (period % 100 - 1) + months
    return (idx // 12) * 100 + idx % 12 + 1


def period_diff(a, b):
    """חודשים מ-a עד b."""
    return ((b // 100) * 12 + b % 100) - ((a // 100) * 12 + a % 100)


# הסדרות הנשמרות בהיסטוריה החודשית, לפי סדר קבוע.
HIST_SERIES = ['hist_yield', 'hist_stock', 'hist_foreign', 'hist_fx', 'hist_liquid']


def build_history(points, end_period, prev_points=None):
    """בונה מערכים חודשיים רציפים (לפי HIST_SERIES) עד end_period.

    points: dict תקופה -> tuple ערכים לפי HIST_SERIES מקובצי המקור.
    prev_points: נקודות מהמאגר הקודם — משלימות חודשים שחסרים בקבצים
    החדשים, כך שההיסטוריה רק מצטברת. מוגבל ל-HISTORY_MONTHS חודשים.
    """
    n = len(HIST_SERIES)
    merged = dict(prev_points or {})
    merged.update({p: v for p, v in points.items() if any(x is not None for x in v)})
    merged = {p: v for p, v in merged.items() if 0 <= period_diff(p, end_period) < HISTORY_MONTHS}
    if not merged:
        return None, [None] * n
    start = min(merged)
    arrays = [[] for _ in range(n)]
    empty = (None,) * n
    for i in range(period_diff(start, end_period) + 1):
        v = merged.get(period_add(start, i), empty)
        for j in range(n):
            arrays[j].append(v[j] if j < len(v) else None)
    return start, arrays


def history_points_from_record(rec):
    """שחזור נקודות ההיסטוריה מרשומה קיימת (למיזוג עם --prev)."""
    start = rec.get('hist_start')
    if not start:
        return {}
    series = [rec.get(k) or [] for k in HIST_SERIES]
    length = max((len(s) for s in series), default=0)
    return {period_add(start, i): tuple(s[i] if i < len(s) else None for s in series)
            for i in range(length)}


def set_history(rec, start, arrays):
    rec['hist_start'] = start
    for key, arr in zip(HIST_SERIES, arrays):
        rec[key] = arr


def detect_exposure_mode(rows):
    """percent: עמודות החשיפה הן אחוז מהנכסים (המצב בקבצים של data.gov.il).
    abs: העמודות הן שווי בש"ח/מיליוני ש"ח. מזוהה לפי ערכים שלא ייתכנו כאחוז."""
    big = 0
    for row in rows:
        for col in EXPOSURE_COLS:
            v = to_num(row.get(col))
            if v is not None and abs(v) > 300:
                big += 1
    return 'abs' if big > 5 else 'percent'


def build_source(source, path, warnings):
    cfg = SOURCES[source]
    headers, rows = read_rows(path)
    if 'FUND_ID' not in headers or 'REPORT_PERIOD' not in headers:
        raise SystemExit(f'{path}: לא נמצאו עמודות FUND_ID / REPORT_PERIOD — האם זה קובץ המקור הנכון?')

    mode = detect_exposure_mode(rows)
    if mode == 'percent':
        warnings.append(f'{source}: עמודות החשיפה זוהו כאחוזים (בקבצים הרגילים הן שווי כספי) — כדאי לוודא שהקובץ תקין')

    latest = {}
    periods = []
    fund_months = {}
    first_seen = {}
    dropped_pct = [0]
    for row in rows:
        fid = to_str(row.get('FUND_ID')).strip()
        period = to_period(row.get('REPORT_PERIOD'))
        if not fid or period is None:
            continue
        periods.append(period)
        key = fid
        if key not in latest or period > latest[key][0]:
            latest[key] = (period, row)
        if key not in first_seen or period < first_seen[key]:
            first_seen[key] = period
        ta = to_num(row.get('TOTAL_ASSETS'))

        def exposure_pct(col):
            v = to_num(row.get(col)) if col in headers else None
            if v is not None and mode == 'abs':
                v = v / ta * 100.0 if ta else None
                # שווי חשיפה שלא עודכן מול נכסים שהתרוקנו נותן אחוז חסר משמעות.
                if v is not None and not (-10 <= v <= 300):
                    dropped_pct[0] += 1
                    v = None
            return rnd(v)

        my = rnd(to_num(row.get('MONTHLY_YIELD'))) if 'MONTHLY_YIELD' in headers else None
        liquid = rnd(to_num(row.get('LIQUID_ASSETS_PERCENT'))) if 'LIQUID_ASSETS_PERCENT' in headers else None
        fund_months.setdefault(key, {})[period] = (
            my,
            exposure_pct('STOCK_MARKET_EXPOSURE'),
            exposure_pct('FOREIGN_EXPOSURE'),
            exposure_pct('FOREIGN_CURRENCY_EXPOSURE'),
            liquid,
        )

    funds = []
    for fid, (period, row) in latest.items():
        rec = {
            'uid': f'{source}:{fid}',
            'source': source,
            'source_label': cfg['label'],
        }
        for col, field in STRING_FIELDS:
            rec[field] = to_str(row.get(col)) if col in headers else ''
        rec['fund_id'] = fid
        rec['report_period'] = period
        # בביטוח-נט אין עמודת MANAGING_CORPORATION — החברה המנהלת היא חברת האם.
        if 'MANAGING_CORPORATION' not in headers and rec['parent_company_name']:
            rec['managing_corp'] = rec['parent_company_name']
        for col, field in DATE_FIELDS:
            rec[field] = to_iso_date(row.get(col)) if col in headers else ''
        for col, field in NUMERIC_FIELDS:
            rec[field] = rnd(to_num(row.get(col))) if col in headers else None

        total = rec['total_assets'] or 0.0
        for col, abs_field, pct_field in EXPOSURE_FIELDS:
            v = to_num(row.get(col)) if col in headers else None
            if v is None:
                rec[abs_field] = None
                rec[pct_field] = None
            elif mode == 'percent':
                rec[pct_field] = rnd(v)
                rec[abs_field] = rnd(v * total / 100.0)
            else:
                pct = v / total * 100.0 if total else None
                if pct is not None and not (-10 <= pct <= 300):
                    dropped_pct[0] += 1
                    v = pct = None
                rec[abs_field] = rnd(v)
                rec[pct_field] = rnd(pct)

        rec['legal_id'] = to_str(row.get(cfg['legal_id_col'])) if cfg['legal_id_col'] in headers else ''
        rec['is_active'] = bool(rec['total_assets'] and rec['total_assets'] > 0)
        # החודש הראשון שבו הקופה מופיעה במקור. מתמזג עם הקובץ הקודם דרך --prev,
        # ולכן הוא רק מקדים עם הזמן ומשמש ראיית ותק היכן שאין תאריך הקמה
        # (ביטוח-נט אינו מפרסם INCEPTION_DATE).
        rec['first_seen_period'] = first_seen.get(fid)
        set_history(rec, *build_history(fund_months.get(fid, {}), period))
        funds.append({k: rec.get(k) for k in OUTPUT_FIELD_ORDER})

    if dropped_pct[0]:
        warnings.append(f'{source}: {dropped_pct[0]} אחוזי חשיפה לא סבירים (מחוץ לטווח 10%- עד 300%) הושמטו')

    meta = {
        'label': cfg['label'],
        'group_label': cfg['group_label'],
        'raw_rows': len(rows),
        'unique_funds': len(funds),
        'active_funds': sum(1 for f in funds if f['is_active']),
        'min_report_period': min(periods) if periods else None,
        'max_report_period': max(periods) if periods else None,
        'headers': headers,
    }
    return funds, meta


def validate(payload, prev=None):
    """מחזיר (errors, warnings) על קובץ נתונים מאוחד."""
    errors, warnings = [], []
    funds = payload.get('funds') or []
    meta = payload.get('meta') or {}
    if not funds:
        return ['אין רשומות קופות בקובץ'], warnings

    uids = [f.get('uid') for f in funds]
    if len(set(uids)) != len(uids):
        errors.append('נמצאו uid כפולים')
    keysets = {tuple(sorted(f.keys())) for f in funds}
    if len(keysets) != 1:
        errors.append(f'רשומות עם סכמות שונות ({len(keysets)} וריאציות)')

    max_period = 0
    for f in funds:
        uid, src, fid = f.get('uid'), f.get('source'), f.get('fund_id')
        if uid != f'{src}:{fid}':
            errors.append(f'{uid}: uid לא תואם source:fund_id')
            break
        p = f.get('report_period')
        if not (isinstance(p, int) and 200000 <= p <= 210012 and 1 <= p % 100 <= 12):
            errors.append(f'{uid}: report_period לא תקין ({p})')
            break
        max_period = max(max_period, p)

    range_bad = pct_bad = active_bad = 0
    for f in funds:
        ta = f.get('total_assets')
        if ta is not None and ta < 0:
            range_bad += 1
        for k in ('stock_pct', 'foreign_pct', 'fx_pct', 'liquid_pct'):
            v = f.get(k)
            if v is not None and not (-10 <= v <= 300):
                range_bad += 1
        fee = f.get('avg_annual_management_fee')
        if fee is not None and not (0 <= fee <= 10):
            range_bad += 1
        for abs_k, pct_k in (('stock_exp_abs', 'stock_pct'), ('foreign_exp_abs', 'foreign_pct'), ('fx_exp_abs', 'fx_pct')):
            a, p2 = f.get(abs_k), f.get(pct_k)
            if a is not None and p2 is not None and ta:
                if abs(a / ta * 100.0 - p2) > 0.6:
                    pct_bad += 1
        if bool(f.get('is_active')) != bool(ta and ta > 0):
            active_bad += 1
    hist_bad = 0
    for f in funds:
        start = f.get('hist_start')
        series = [f.get(k) for k in HIST_SERIES]
        if start is None:
            if any(series):
                hist_bad += 1
            continue
        expected = period_diff(start, f['report_period']) + 1
        if not (1 <= expected <= HISTORY_MONTHS) or any(
                not isinstance(s, list) or len(s) != expected for s in series):
            hist_bad += 1
            continue
        yields = series[0]
        if any(y is not None and not (-40 <= y <= 40) for y in yields):
            hist_bad += 1
        elif any(v is not None and not (-10 <= v <= 300) for s in series[1:] for v in s):
            hist_bad += 1
    if hist_bad:
        errors.append(f'{hist_bad} רשומות עם היסטוריה חודשית לא תקינה (אורך/יישור/טווח)')

    if range_bad:
        errors.append(f'{range_bad} ערכים מחוץ לטווח סביר (אחוזי חשיפה / דמי ניהול / נכסים)')
    if pct_bad:
        errors.append(f'{pct_bad} רשומות עם חוסר עקביות בין חשיפה כספית לאחוז חשיפה')
    if active_bad:
        errors.append(f'{active_bad} רשומות עם is_active שלא תואם את סך הנכסים')

    dmp = meta.get('dataset_max_period')
    if dmp != max_period:
        errors.append(f'meta.dataset_max_period ({dmp}) לא תואם את הנתונים ({max_period})')
    today = dt.date.today()
    months_old = (today.year - max_period // 100) * 12 + (today.month - max_period % 100)
    if months_old > 4:
        warnings.append(f'התקופה העדכנית במאגר ({max_period}) ישנה ב-{months_old} חודשים — האם הקבצים עדכניים?')
    if months_old < -1:
        errors.append(f'התקופה העדכנית במאגר ({max_period}) עתידית — כנראה שגיאת קלט')

    if prev:
        prev_funds = prev.get('funds') or []
        prev_max = (prev.get('meta') or {}).get('dataset_max_period') or 0
        if max_period < prev_max:
            errors.append(f'התקופה העדכנית ירדה מ-{prev_max} ל-{max_period} — הקובץ החדש ישן מהקודם')
        if prev_funds:
            change = (len(funds) - len(prev_funds)) / len(prev_funds) * 100.0
            if abs(change) > 10:
                warnings.append(f'מספר הקופות השתנה ב-{change:+.1f}% ({len(prev_funds)} -> {len(funds)})')
            prev_by_uid = {f['uid']: f for f in prev_funds}
            overlap = drift = 0
            for f in funds:
                pf = prev_by_uid.get(f['uid'])
                if not pf or pf.get('report_period') != f.get('report_period'):
                    continue
                a, b = f.get('stock_pct'), pf.get('stock_pct')
                if a is None or b is None:
                    continue
                overlap += 1
                if abs(a - b) > 1.0:
                    drift += 1
            if overlap >= 20 and drift / overlap > 0.05:
                errors.append(f'חשיפת מניות סוטה מהקובץ הקודם ב-{drift}/{overlap} רשומות זהות-תקופה — ייתכן פירוש שגוי של עמודות החשיפה')

    return errors, warnings


def report(errors, warnings):
    for w in warnings:
        print(f'  אזהרה: {w}')
    for e in errors:
        print(f'  שגיאה: {e}')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--gemel', help='קובץ המקור של גמל-נט (xlsx/csv)')
    ap.add_argument('--pensia', help='קובץ המקור של פנסיה-נט (xlsx/csv)')
    ap.add_argument('--bituach', help='קובץ המקור של ביטוח-נט (xlsx/csv)')
    ap.add_argument('--prev', help='funds_unified.json קודם להשוואה (מומלץ)')
    ap.add_argument('-o', '--output', default='funds_unified.json', help='קובץ פלט (ברירת מחדל: funds_unified.json)')
    ap.add_argument('--check', metavar='JSON', help='רק בדיקת קובץ קיים, בלי בנייה')
    ap.add_argument('--renormalize', metavar='JSON',
                    help='החלת תיקוני הטקסט (TEXT_REPAIRS) על קובץ קיים, בלי קובצי מקור')
    ap.add_argument('--full', action='store_true', help='לכלול בפלט גם שדות שהדשבורד לא קורא')
    args = ap.parse_args()

    if args.renormalize:
        path = args.renormalize
        payload = json.load(open(path, encoding='utf-8'))
        changed = 0
        for fund in payload.get('funds') or []:
            for key, value in fund.items():
                if isinstance(value, str):
                    fixed = repair_text(value)
                    if fixed != value:
                        fund[key] = fixed
                        changed += 1
        errors, warnings = validate(payload)
        report(errors, warnings)
        if errors:
            print('הבדיקה נכשלה — הקובץ לא נכתב')
            sys.exit(1)
        out = args.output if args.output != 'funds_unified.json' else path
        with open(out, 'w', encoding='utf-8') as fh:
            json.dump(payload, fh, ensure_ascii=False, separators=(',', ':'))
        print(f'{out}: תוקנו {changed} שדות טקסט')
        sys.exit(0)

    if args.check:
        payload = json.load(open(args.check, encoding='utf-8'))
        errors, warnings = validate(payload)
        report(errors, warnings)
        n = len(payload.get('funds') or [])
        print(f'{args.check}: {n} קופות, תקופה עדכנית {(payload.get("meta") or {}).get("dataset_max_period")}')
        print('הבדיקה נכשלה' if errors else 'הבדיקה עברה')
        sys.exit(1 if errors else 0)

    inputs = {'gemelnet': args.gemel, 'pensia': args.pensia, 'bituach': args.bituach}
    if not all(inputs.values()):
        ap.error('נדרשים שלושת קובצי המקור: --gemel, --pensia, --bituach (או --check לבדיקה בלבד)')

    warnings = []
    all_funds = []
    sources_meta = {}
    for source, path in inputs.items():
        funds, smeta = build_source(source, path, warnings)
        print(f'{source}: {smeta["raw_rows"]} שורות גולמיות, {smeta["unique_funds"]} קופות, '
              f'{smeta["active_funds"]} פעילות, תקופות {smeta["min_report_period"]}-{smeta["max_report_period"]}')
        all_funds.extend(funds)
        sources_meta[source] = smeta

    periods = [f['report_period'] for f in all_funds]
    counts = {
        'total_funds': len(all_funds),
        'active_funds': sum(1 for f in all_funds if f['is_active']),
    }
    for source in SOURCES:
        counts[f'{source}_count'] = sources_meta[source]['unique_funds']
        counts[f'{source}_active_count'] = sources_meta[source]['active_funds']

    payload = {
        'meta': {
            'sources': sources_meta,
            'created_at': dt.date.today().isoformat(),
            'dataset_max_period': max(periods),
            'dataset_min_period': min(m['min_report_period'] for m in sources_meta.values()),
            'counts': counts,
            **{f'{s}_count': sources_meta[s]['active_funds'] for s in SOURCES},
        },
        'funds': all_funds,
    }

    prev = json.load(open(args.prev, encoding='utf-8')) if args.prev else None
    if prev:
        # היסטוריה מצטברת: חודשים שקיימים במאגר הקודם ולא בקבצים החדשים נשמרים.
        prev_by_uid = {f['uid']: f for f in prev.get('funds') or []}
        for f in all_funds:
            pf = prev_by_uid.get(f['uid'])
            if pf and pf.get('hist_start'):
                set_history(f, *build_history(
                    history_points_from_record(f), f['report_period'],
                    history_points_from_record(pf)))
            prev_seen = pf.get('first_seen_period') if pf else None
            if prev_seen and (not f.get('first_seen_period') or prev_seen < f['first_seen_period']):
                f['first_seen_period'] = prev_seen
    errors, val_warnings = validate(payload, prev)
    report(errors, warnings + val_warnings)
    if errors:
        print('הקובץ לא נכתב — יש לתקן את השגיאות למעלה.')
        sys.exit(1)

    if not args.full:
        slim_payload(payload)
    with open(args.output, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(',', ':'))
    print(f'נכתב {args.output}: {counts["total_funds"]} קופות ({counts["active_funds"]} פעילות), '
          f'תקופה עדכנית {payload["meta"]["dataset_max_period"]}')


if __name__ == '__main__':
    main()
