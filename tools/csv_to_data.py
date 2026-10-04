#!/usr/bin/env python3
"""يحوّل ملف الكلمات (CSV) إلى js/data.js الذي يقرأه التطبيق.

الاستخدام:
    python3 tools/csv_to_data.py tools/words_template.csv

الأعمدة (الصف الأول عناوين):
    grade, unit, unit_title, word, meaning, sentence, sentence_ar, page, form
- grade: g3 g4 g5 g6 m1 m2 m3  (أو اسم الصف بالعربي، مثل: الخامس الابتدائي)
- form (اختياري): شكل الكلمة كما ترد في الجملة إن اختلف، مثل eat -> eats
عند الحفظ من Excel اختر: CSV UTF-8.
"""
import csv, json, re, sys, datetime, pathlib

GRADES = [
    ("g3", "الثالث الابتدائي", "3 ابتدائي"),
    ("g4", "الرابع الابتدائي", "4 ابتدائي"),
    ("g5", "الخامس الابتدائي", "5 ابتدائي"),
    ("g6", "السادس الابتدائي", "6 ابتدائي"),
    ("m1", "الأول المتوسط", "1 متوسط"),
    ("m2", "الثاني المتوسط", "2 متوسط"),
    ("m3", "الثالث المتوسط", "3 متوسط"),
]
ALIASES = {}
for gid, name, short in GRADES:
    for key in (gid, name, short, name.replace("ال", "", 1)):
        ALIASES[key.strip().lower()] = gid


def find_form(sentence, target):
    pat = r"(^|[^A-Za-z])" + re.escape(target) + r"(?![A-Za-z])"
    return re.search(pat, sentence, re.IGNORECASE) is not None


def main(path):
    out = {gid: {"id": gid, "name": name, "short": short, "units": []} for gid, name, short in GRADES}
    warnings, count = [], 0
    with open(path, newline="", encoding="utf-8-sig") as f:
        for n, row in enumerate(csv.DictReader(f), start=2):
            row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
            if not row.get("word"):
                continue
            gid = ALIASES.get(row.get("grade", "").lower())
            if not gid:
                warnings.append(f"سطر {n}: الصف غير معروف ({row.get('grade')!r})")
                continue
            unit_key = row.get("unit") or "1"
            uid = "u" + re.sub(r"[^a-z0-9]+", "-", unit_key.lower()).strip("-")
            units = out[gid]["units"]
            unit = next((u for u in units if u["id"] == uid), None)
            if not unit:
                unit = {"id": uid, "title": row.get("unit_title") or f"Unit {unit_key}", "words": []}
                units.append(unit)
            word = {"en": row["word"], "ar": row.get("meaning", "")}
            if row.get("sentence"):
                word["sentence"] = row["sentence"]
                target = row.get("form") or row["word"]
                if not find_form(row["sentence"], target):
                    warnings.append(f"سطر {n}: الكلمة ({target}) غير موجودة في الجملة -> أضف عمود form")
            for src, dst in (("sentence_ar", "sentenceAr"), ("page", "page"), ("form", "form")):
                if row.get(src):
                    word[dst] = row[src]
            if not word["ar"]:
                warnings.append(f"سطر {n}: لا يوجد معنى للكلمة ({word['en']})")
            unit["words"].append(word)
            count += 1

    data = {"generatedAt": datetime.date.today().isoformat(), "grades": [out[g[0]] for g in GRADES]}
    target = pathlib.Path(__file__).resolve().parent.parent / "js" / "data.js"
    target.write_text(
        "// ملف مُولَّد تلقائيًا بواسطة tools/csv_to_data.py — لا تعدّله يدويًا\n"
        "window.CURRICULUM = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8",
    )
    units_n = sum(len(g["units"]) for g in data["grades"])
    print(f"تم: {count} كلمة في {units_n} وحدة -> {target}")
    for w in warnings:
        print("تنبيه:", w)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
