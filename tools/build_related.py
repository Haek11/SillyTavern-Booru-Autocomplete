"""Build related_tags.csv from a Danbooru tag co-occurrence file.

Usage:
    python build_related.py <danbooru_tags_cooccurrence.csv> <danbooru_tags.csv> [related_tags.csv] [top_k]

The co-occurrence file comes from https://huggingface.co/datasets/newtextdoc1111/danbooru-tag-csv
(ComfyUI-Autocomplete-Plus users already have it in its data/ folder).
Output line format:  tag,other:pct|other:pct|...   (pct = % of the tag's posts that also have `other`)
"""
import csv, sys
from collections import defaultdict

if len(sys.argv) < 3:
    sys.exit(__doc__)
COOC, BASE = sys.argv[1], sys.argv[2]
OUT = sys.argv[3] if len(sys.argv) > 3 else "related_tags.csv"
TOP_K = int(sys.argv[4]) if len(sys.argv) > 4 else 100
MIN_PCT = 0.1

totals = {}
with open(BASE, newline='', encoding='utf-8') as f:
    r = csv.reader(f); next(r)
    for row in r:
        if not row: continue
        try: totals[row[0]] = float(row[2])
        except (IndexError, ValueError): totals[row[0]] = 0

rel = defaultdict(list)
with open(COOC, newline='', encoding='utf-8') as f:
    r = csv.reader(f); next(r)
    for row in r:
        if len(row) < 3: continue
        a, b = row[0], row[1]
        try: c = float(row[2])
        except ValueError: continue
        if a in totals and b in totals:
            rel[a].append((b, c)); rel[b].append((a, c))

written = 0
with open(OUT, "w", newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    for tag, items in rel.items():
        total = totals.get(tag, 0)
        if total <= 0: continue
        items.sort(key=lambda x: -x[1])
        parts = [f"{o}:{c / total * 100:.1f}" for o, c in items[:TOP_K] if c / total * 100 >= MIN_PCT]
        if parts:
            w.writerow([tag, "|".join(parts)]); written += 1
print(f"wrote {written} tags to {OUT}")
