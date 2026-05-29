import yaml
from pathlib import Path
from collections import defaultdict

FRESH_DIR = Path("d:/django/vision/dataset_fresh")

with open(FRESH_DIR / 'data.yaml', 'r') as f:
    data = yaml.safe_load(f)

counts = defaultdict(int)
for split in ['train', 'val', 'test']:
    lbl_dir = FRESH_DIR / 'labels' / split
    if not lbl_dir.exists():
        continue
    for lf in lbl_dir.glob('*.txt'):
        with open(lf, 'r') as f:
            for line in f:
                if line.strip():
                    counts[int(line.split()[0])] += 1

print("\nFINAL DATASET SUMMARY:")
for cid in sorted(counts.keys()):
    name = data['names'].get(cid, "Unknown")
    print(f"{name:<15}: {counts[cid]}")
print(f"Total Labels : {sum(counts.values())}")
