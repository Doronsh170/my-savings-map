# -*- coding: utf-8 -*-
"""תיקון קידוד של קובצי המקור מ-data.gov.il כדי שאקסל יציג עברית ולא ג'יבריש.

קובצי גמל-נט / פנסיה-נט / ביטוח-נט מגיעים לרוב ב-Windows-1255. אקסל פותח
קובץ csv בלחיצה כפולה לפי קידוד ברירת המחדל של המערכת, ולכן מציג
"éùéø -àéé. ãé. àéé." במקום "ישיר -איי. די. איי.". הכלי כותב עותק ב-UTF-8
עם BOM — הקידוד שאקסל מזהה לבד — ומטפל גם במקרה שהקובץ כבר נשמר משובש.

שימוש:
    python3 tools/fix_csv_encoding.py bituach.csv            # -> bituach.utf8.csv
    python3 tools/fix_csv_encoding.py bituach.csv -o out.csv
    python3 tools/fix_csv_encoding.py bituach.csv --in-place
    python3 tools/fix_csv_encoding.py bituach.csv --xlsx     # -> bituach.xlsx

הכלי אינו נוגע בתוכן עצמו: אותן שורות, אותן עמודות, אותם מספרים.
build_dataset.py קורא ממילא את שני הקידודים, כך שההמרה נועדה לעין האנושית.
"""

import argparse
import re
import sys
from pathlib import Path

HEBREW = re.compile(r'[֐-׿]')
# התווים שמופיעים כשטקסט עברי ב-1255 נקרא כ-Latin-1/1252.
MOJIBAKE = re.compile(r'[À-ÿ]')


def unmojibake(text):
    """טקסט שנקרא כ-Latin-1 ונשמר כ-UTF-8 — מחזיר את העברית, או None."""
    if HEBREW.search(text) or not MOJIBAKE.search(text):
        return None
    try:
        candidate = text.encode('cp1252').decode('cp1255')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None
    return candidate if HEBREW.search(candidate) else None


def load_text(path):
    """מחזיר (טקסט, תיאור המקור). מזהה utf-8, 1255, וטקסט שכבר נשמר משובש."""
    raw = Path(path).read_bytes()
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        pass
    else:
        repaired = unmojibake(text)
        if repaired is not None:
            return repaired, 'UTF-8 ובתוכו טקסט משובש (תוקן)'
        return text, 'UTF-8'
    for enc, label in (('cp1255', 'Windows-1255 (עברית)'), ('cp1252', 'Windows-1252')):
        try:
            return raw.decode(enc), label
        except UnicodeDecodeError:
            continue
    raise SystemExit(f'לא הצלחתי לזהות את הקידוד של {path}')


def write_xlsx(text, out):
    import csv
    import io
    try:
        import openpyxl
    except ImportError:
        raise SystemExit('נדרש openpyxl לפלט xlsx: pip install openpyxl')
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in csv.reader(io.StringIO(text, newline='')):
        ws.append(row)
    wb.save(out)
    wb.close()


def main():
    ap = argparse.ArgumentParser(description='המרת קובץ מקור לקידוד שאקסל מציג נכון')
    ap.add_argument('source', help='קובץ ה-csv שהורד מ-data.gov.il')
    ap.add_argument('-o', '--output', help='קובץ היעד (ברירת מחדל: <שם>.utf8.csv)')
    ap.add_argument('--in-place', action='store_true', help='דריסת קובץ המקור')
    ap.add_argument('--xlsx', action='store_true', help='כתיבת xlsx במקום csv')
    args = ap.parse_args()

    src = Path(args.source)
    if not src.exists():
        raise SystemExit(f'לא נמצא הקובץ {src}')
    if args.in_place and args.output:
        raise SystemExit('אפשר --in-place או -o, לא את שניהם')

    text, source_desc = load_text(src)
    if not HEBREW.search(text):
        print('שים לב: לא נמצאה עברית בקובץ — ייתכן שזה לא קובץ המקור הנכון.', file=sys.stderr)

    if args.output:
        out = Path(args.output)
    elif args.in_place:
        out = src.with_suffix('.xlsx') if args.xlsx else src
    elif args.xlsx:
        out = src.with_suffix('.xlsx')
    else:
        out = src.with_suffix('.utf8' + src.suffix)

    if args.xlsx:
        write_xlsx(text, out)
        target_desc = 'xlsx'
    else:
        # BOM: הסימן שבזכותו אקסל פותח את הקובץ כ-UTF-8 בלחיצה כפולה.
        out.write_text(text, encoding='utf-8-sig', newline='')
        target_desc = 'UTF-8 עם BOM'

    first = next((line for line in text.splitlines() if line.strip()), '')
    print(f'נקרא מ: {src}  ({source_desc})')
    print(f'נכתב ל: {out}  ({target_desc})')
    print(f'שורת הכותרות: {first[:120]}')


if __name__ == '__main__':
    main()
