import os
import sys
import shutil
import random
import yaml
from pathlib import Path
from collections import defaultdict

FRESH_DIR = Path("d:/django/vision/dataset_fresh")
KAGGLE_DIR = Path("d:/django/vision/dataset/kaggle_downloads/manholes/data")

TARGET_CLASSES = {
    "obstacle": 0, "pothole": 1, "puddle": 2, "open_drain": 3, "traffic_cone": 4,
    "barrier": 5, "pole": 6, "bollard": 7, "trash_bin": 8, "door": 9,
    "glass_door": 10, "window": 11, "elevator": 12, "handrail": 13, "stair": 14,
    "curb": 15, "ramp": 16, "zebra_cross": 17, "speed_breaker": 18,
    "manhole": 19, "auto_rickshaw": 20
}
TARGET_CLASSES_LIST = sorted(TARGET_CLASSES.keys(), key=lambda k: TARGET_CLASSES[k])

# Map Kaggle classes to our schema
KAGGLE_MAP = {
    0: TARGET_CLASSES["pothole"],  # 0 -> 1
    2: TARGET_CLASSES["manhole"],  # 2 -> 19
}

def count_existing():
    counts = defaultdict(int)
    split_img_counts = {}
    for split in ['train', 'val', 'test']:
        ldir = FRESH_DIR / 'labels' / split
        idir = FRESH_DIR / 'images' / split
        split_img_counts[split] = len(list(idir.glob("*.*"))) if idir.exists() else 0
        if ldir.exists():
            for lf in ldir.glob("*.txt"):
                with open(lf, 'r') as f:
                    for line in f:
                        p = line.strip().split()
                        if p:
                            counts[int(p[0])] += 1
    return counts, split_img_counts

def process_kaggle_dataset():
    images_dir = KAGGLE_DIR / "images"
    labels_dir = KAGGLE_DIR / "labels-YOLO"
    
    if not images_dir.exists() or not labels_dir.exists():
        print("Kaggle dataset directories not found.")
        return []

    samples = []
    for img_path in images_dir.glob("*.jpg"):
        label_path = labels_dir / (img_path.stem + ".txt")
        if not label_path.exists():
            continue
            
        valid_lines = []
        with open(label_path, 'r') as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) >= 5:
                    try:
                        cls_id = int(parts[0])
                        if cls_id in KAGGLE_MAP:
                            target_id = KAGGLE_MAP[cls_id]
                            valid_lines.append(f"{target_id} {' '.join(parts[1:5])}")
                    except ValueError:
                        continue
        
        if valid_lines:
            samples.append({'img_path': img_path, 'labels': valid_lines})
            
    print(f"Found {len(samples)} valid images with manhole/pothole in Kaggle dataset.")
    return samples

def append_samples(samples, before_counts, split_img_counts):
    # Determine how many we can add before hitting 1500 cap
    current_pothole = before_counts[TARGET_CLASSES["pothole"]]
    current_manhole = before_counts[TARGET_CLASSES["manhole"]]
    
    random.seed(42)
    random.shuffle(samples)
    
    filtered_samples = []
    for s in samples:
        # Check what this image adds
        has_pothole = any(l.startswith(str(TARGET_CLASSES["pothole"])) for l in s['labels'])
        has_manhole = any(l.startswith(str(TARGET_CLASSES["manhole"])) for l in s['labels'])
        
        keep = False
        if has_manhole and current_manhole < 1500:
            keep = True
        elif has_pothole and current_pothole < 1500:
            keep = True
            
        if keep:
            filtered_samples.append(s)
            if has_manhole: current_manhole += 1
            if has_pothole: current_pothole += 1
            
    print(f"Adding {len(filtered_samples)} images after cap logic.")
    
    n = len(filtered_samples)
    if n == 0:
        return {}
        
    train_end = int(n * 0.8)
    val_end = int(n * 0.9)

    splits = {
        'train': filtered_samples[:train_end],
        'val': filtered_samples[train_end:val_end],
        'test': filtered_samples[val_end:]
    }

    new_counts = defaultdict(int)
    for split_name, split_samples in splits.items():
        idir = FRESH_DIR / 'images' / split_name
        ldir = FRESH_DIR / 'labels' / split_name
        
        start = split_img_counts.get(split_name, 0)
        for i, sample in enumerate(split_samples):
            idest = idir / f"aug_kaggle_{split_name}_{start+i:06d}{sample['img_path'].suffix}"
            shutil.copy2(sample['img_path'], idest)
            ldest = ldir / f"aug_kaggle_{split_name}_{start+i:06d}.txt"
            with open(ldest, 'w') as f:
                f.write('\n'.join(sample['labels']))
            for line in sample['labels']:
                new_counts[int(line.split()[0])] += 1
                
        split_img_counts[split_name] = start + len(split_samples)

    return new_counts

def update_yaml(final_counts):
    active = {i: TARGET_CLASSES_LIST[i] for i in sorted(final_counts.keys()) if final_counts[i] > 0}
    content = {
        'path': str(FRESH_DIR.resolve()).replace('\\', '/'),
        'train': 'images/train',
        'val': 'images/val',
        'test': 'images/test',
        'nc': len(active),
        'names': active
    }
    with open(FRESH_DIR / 'data.yaml', 'w') as f:
        yaml.dump(content, f, sort_keys=False)
    return active

def main():
    before_counts, split_img_counts = count_existing()
    samples = process_kaggle_dataset()
    new_counts = append_samples(samples, before_counts, split_img_counts)
    
    final_counts = defaultdict(int)
    for k, v in before_counts.items():
        final_counts[k] += v
    for k, v in new_counts.items():
        final_counts[k] += v
        
    active = update_yaml(final_counts)
    
    print("\n--- FINAL CLASS COUNTS ---")
    for cid in sorted(final_counts.keys()):
        print(f"  {TARGET_CLASSES_LIST[cid]:<15}: {final_counts[cid]}")
    print(f"Total active classes: {len(active)}")

if __name__ == "__main__":
    main()
