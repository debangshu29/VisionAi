"""
Balancing script: undersample over-represented classes in dataset_fresh.
Strategy:
  - Set a MAX_BOXES_PER_CLASS cap (e.g., 2500)
  - For each split, scan label files
  - If an image contains ONLY over-represented classes AND removing it
    would help bring them under the cap, mark it for deletion
  - Preserve any image that contains at least one rare-class label
  - Delete the marked image + label files
  - Regenerate data.yaml with final counts
"""
import sys
import io
import os
import random
from pathlib import Path
from collections import defaultdict
import yaml

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

FRESH_DIR = Path("d:/django/vision/dataset_fresh")

TARGET_CLASSES = {
    "obstacle": 0, "pothole": 1, "puddle": 2, "open_drain": 3, "traffic_cone": 4,
    "barrier": 5, "pole": 6, "bollard": 7, "trash_bin": 8, "door": 9,
    "glass_door": 10, "window": 11, "elevator": 12, "handrail": 13, "stair": 14,
    "curb": 15, "ramp": 16, "zebra_cross": 17, "speed_breaker": 18,
    "manhole": 19, "auto_rickshaw": 20
}
TARGET_CLASSES_LIST = sorted(TARGET_CLASSES.keys(), key=lambda k: TARGET_CLASSES[k])

# Classes to undersample and their targets
OVERSAMPLE_CAP = {
    14: 1500,   # stair
    9:  1500,   # door
    11: 1500,   # window
    4:  1500,   # traffic_cone
    0:  1500,   # obstacle
}

# Classes that are rare - any image containing these must NEVER be deleted
RARE_CLASSES = {0, 1, 2, 3, 5, 6, 7, 8, 15, 16, 17, 18, 19, 20}


def count_all_labels():
    counts = defaultdict(int)
    for split in ['train', 'val', 'test']:
        ldir = FRESH_DIR / 'labels' / split
        if not ldir.exists():
            continue
        for lf in ldir.glob("*.txt"):
            with open(lf, 'r') as f:
                for line in f:
                    p = line.strip().split()
                    if p:
                        counts[int(p[0])] += 1
    return counts


def balance_split(split):
    ldir = FRESH_DIR / 'labels' / split
    idir = FRESH_DIR / 'images' / split
    if not ldir.exists():
        return 0

    # Load all label files and their class sets
    label_files = list(ldir.glob("*.txt"))
    random.seed(42)
    random.shuffle(label_files)

    # Per-file info
    file_info = []
    for lf in label_files:
        cls_set = set()
        cls_counts = defaultdict(int)
        with open(lf, 'r') as f:
            for line in f:
                p = line.strip().split()
                if p:
                    cid = int(p[0])
                    cls_set.add(cid)
                    cls_counts[cid] += 1
        file_info.append({'lf': lf, 'cls_set': cls_set, 'cls_counts': cls_counts})

    # Current running box counts for this split
    running = defaultdict(int)
    for fi in file_info:
        for cid, cnt in fi['cls_counts'].items():
            running[cid] += cnt

    # Split-proportional cap: train=80% of total, val=10%, test=10%
    split_ratio = {'train': 0.8, 'val': 0.1, 'test': 0.1}
    ratio = split_ratio.get(split, 0.8)
    caps = {cid: int(cap * ratio) for cid, cap in OVERSAMPLE_CAP.items()}

    deleted = 0
    for fi in file_info:
        cls_set = fi['cls_set']

        # Never delete if contains rare classes
        if cls_set & RARE_CLASSES:
            continue

        # Only candidate for deletion if it only contains over-represented classes
        over_classes = set(OVERSAMPLE_CAP.keys())
        if not cls_set.issubset(over_classes):
            continue

        # Check: would deleting this help any class that's over the cap?
        would_help = False
        for cid in cls_set:
            if cid in caps and running[cid] > caps[cid]:
                would_help = True
                break

        if not would_help:
            continue

        # Delete the image and label
        lf = fi['lf']
        # Find corresponding image
        img_stem = lf.stem
        img_found = None
        for ext in ['.jpg', '.jpeg', '.png']:
            candidate = idir / f"{img_stem}{ext}"
            if candidate.exists():
                img_found = candidate
                break

        # Update running counts
        for cid, cnt in fi['cls_counts'].items():
            running[cid] -= cnt

        lf.unlink()
        if img_found:
            img_found.unlink()
        deleted += 1

    return deleted


def main():
    print("=" * 55)
    print("Dataset Balancing")
    print("=" * 55)

    print("\n[Before Balancing]")
    before = count_all_labels()
    for cid in sorted(before.keys()):
        flag = " <<< OVER CAP" if cid in OVERSAMPLE_CAP and before[cid] > OVERSAMPLE_CAP[cid] else ""
        print(f"  {TARGET_CLASSES_LIST[cid]:<15}: {before[cid]:>6}{flag}")

    print("\nUndersampling over-represented classes...")
    total_deleted = 0
    for split in ['train', 'val', 'test']:
        n = balance_split(split)
        print(f"  {split}: removed {n} images")
        total_deleted += n

    print(f"\nTotal images removed: {total_deleted}")

    print("\n[After Balancing]")
    after = count_all_labels()
    for cid in sorted(after.keys()):
        b = before.get(cid, 0)
        a = after.get(cid, 0)
        diff = a - b
        print(f"  {TARGET_CLASSES_LIST[cid]:<15}: {a:>6}  (change: {diff:+d})")

    # Count final images
    total_imgs = 0
    for split in ['train', 'val', 'test']:
        idir = FRESH_DIR / 'images' / split
        if idir.exists():
            n = len(list(idir.glob("*.*")))
            total_imgs += n
            print(f"  {split}: {n} images")

    # Update data.yaml
    active = {i: TARGET_CLASSES_LIST[i] for i in sorted(after.keys()) if after[i] > 0}
    yaml_content = {
        'path': str(FRESH_DIR.resolve()).replace('\\', '/'),
        'train': 'images/train',
        'val': 'images/val',
        'test': 'images/test',
        'nc': len(active),
        'names': active
    }
    with open(FRESH_DIR / 'data.yaml', 'w') as f:
        yaml.dump(yaml_content, f, sort_keys=False)

    print(f"\nFinal total images: {total_imgs}")
    print(f"Active classes: {len(active)}")
    print("\ndata.yaml updated. Dataset is balanced and ready for training!")


if __name__ == "__main__":
    main()
