"""
Comprehensive dataset augmentation script:
1. Parse the local public_obs folder (custom annotation format: x1,y1,x2,y2,cls_id,seq)
2. Download 4 confirmed valid Roboflow datasets
3. Append all to dataset_fresh with class remapping
"""
import sys
import io
import os
import shutil
import random
import yaml
import cv2
from pathlib import Path
from collections import defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# --------------------------------------------------------------------------
API_KEY = "KMANRmSg9FInvYHZS1Sr"
FRESH_DIR = Path("d:/django/vision/dataset_fresh")
PUBLIC_OBS_DIR = Path("d:/django/vision/dataset/public_obs")
RF_DOWNLOAD_DIR = Path("d:/django/vision/dataset/roboflow_downloads")

TARGET_CLASSES = {
    "obstacle": 0, "pothole": 1, "puddle": 2, "open_drain": 3, "traffic_cone": 4,
    "barrier": 5, "pole": 6, "bollard": 7, "trash_bin": 8, "door": 9,
    "glass_door": 10, "window": 11, "elevator": 12, "handrail": 13, "stair": 14,
    "curb": 15, "ramp": 16, "zebra_cross": 17, "speed_breaker": 18,
    "manhole": 19, "auto_rickshaw": 20
}
TARGET_CLASSES_LIST = sorted(TARGET_CLASSES.keys(), key=lambda k: TARGET_CLASSES[k])

# public_obs class mapping:
# _classes.txt (0-indexed): right_turn, left_turn, puddle, street_vendor, obstacle,
#   bad_road, garbage_bin, chair, pothole, car, motorcycle, pedestrian, fence,
#   gate_barrier, roadblock, door, tree, plant_pot, drain, stair, pole, zebra_cross
PUBLIC_OBS_MAP = {
    2: "puddle",         # puddle
    4: "obstacle",       # obstacle
    6: "trash_bin",      # garbage bin
    8: "pothole",        # pothole
    18: "open_drain",    # drain
    19: "stair",         # stair
    20: "pole",          # pole
    21: "zebra_cross",   # zebra cross
}

# Confirmed valid Roboflow datasets (verified by API)
ROBOFLOW_DATASETS = [
    {
        "workspace": "trafficconedetect",
        "project": "trafficconedetection",
        "version": 1,
        "class_map": {"traffic cone": "traffic_cone", "trafficcone": "traffic_cone",
                      "cone": "traffic_cone", "traffic_cone": "traffic_cone"},
        "target_class": "traffic_cone"
    },
    {
        "workspace": "useful-cursos",
        "project": "traffic-cone-4sser",
        "version": 2,
        "class_map": {"small blue cone": "traffic_cone", "small orange cone": "traffic_cone",
                      "big orange cone": "traffic_cone", "small yellow cone": "traffic_cone",
                      "cone": "traffic_cone"},
        "target_class": "traffic_cone"
    },
    {
        "workspace": "speedbump",
        "project": "speed-bump-detection",
        "version": 3,
        "class_map": {"speed-bump": "speed_breaker", "speed bump": "speed_breaker",
                      "speedbump": "speed_breaker", "bump": "speed_breaker"},
        "target_class": "speed_breaker"
    },
    {
        "workspace": "road-hazard",
        "project": "speed-breaker-detection",
        "version": 1,
        "class_map": {"speed-breaker": "speed_breaker", "speed breaker": "speed_breaker",
                      "speedbreaker": "speed_breaker"},
        "target_class": "speed_breaker"
    },
]


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


def parse_public_obs():
    """Parse the custom annotation format: x1,y1,x2,y2,cls_id,sequence"""
    ann_file = PUBLIC_OBS_DIR / "_annotations.txt"
    img_size = 608  # all images are 608x608

    samples = []
    skipped_cls = 0
    skipped_corrupt = 0

    with open(ann_file, 'r') as f:
        lines = f.readlines()

    # Group annotations by image
    img_annotations = defaultdict(list)
    for line in lines:
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        img_name = parts[0]
        for ann in parts[1:]:
            coords = ann.split(',')
            if len(coords) >= 5:
                try:
                    x1, y1, x2, y2 = int(coords[0]), int(coords[1]), int(coords[2]), int(coords[3])
                    cls_id = int(coords[4])
                    img_annotations[img_name].append((x1, y1, x2, y2, cls_id))
                except ValueError:
                    continue

    for img_name, annotations in img_annotations.items():
        img_path = PUBLIC_OBS_DIR / img_name
        if not img_path.exists():
            continue

        valid_lines = []
        for x1, y1, x2, y2, cls_id in annotations:
            if cls_id not in PUBLIC_OBS_MAP:
                continue
            # Convert absolute coords to YOLO normalized
            cx = (x1 + x2) / 2 / img_size
            cy = (y1 + y2) / 2 / img_size
            w = abs(x2 - x1) / img_size
            h = abs(y2 - y1) / img_size
            if 0.0 < w <= 1.0 and 0.0 < h <= 1.0 and 0.0 <= cx <= 1.0 and 0.0 <= cy <= 1.0:
                target_name = PUBLIC_OBS_MAP[cls_id]
                target_id = TARGET_CLASSES[target_name]
                valid_lines.append(f"{target_id} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")

        if not valid_lines:
            skipped_cls += 1
            continue

        img = cv2.imread(str(img_path))
        if img is None:
            skipped_corrupt += 1
            continue

        samples.append({'img_path': img_path, 'labels': valid_lines})

    print(f"  public_obs: {len(samples)} valid, {skipped_cls} no-target-class, {skipped_corrupt} corrupt")
    return samples


def try_download_rf(workspace, project, version):
    try:
        from roboflow import Roboflow
        rf = Roboflow(api_key=API_KEY)
        out_dir = RF_DOWNLOAD_DIR / f"{workspace}__{project}"
        if out_dir.exists() and any(out_dir.rglob("*.jpg")) or any(out_dir.rglob("*.png") if out_dir.exists() else []):
            print(f"  Using cached: {out_dir.name}")
            return out_dir
        proj = rf.workspace(workspace).project(project)
        ver = proj.version(version)
        ver.download("yolov8", location=str(out_dir), overwrite=True)
        print(f"  Downloaded: {workspace}/{project} v{version}")
        return out_dir
    except Exception as e:
        print(f"  Failed {workspace}/{project}: {e}")
        return None


def process_rf_dataset(dataset_dir, class_map):
    dataset_dir = Path(dataset_dir)
    data_yaml = next(dataset_dir.rglob("data.yaml"), None)
    if not data_yaml:
        return []

    with open(data_yaml, 'r') as f:
        data = yaml.safe_load(f)
    names = data.get("names", {})
    if isinstance(names, list):
        source_names = {i: n for i, n in enumerate(names)}
    else:
        source_names = {int(k): v for k, v in names.items()}

    # Build numeric map
    numeric_map = {}
    for sid, sname in source_names.items():
        sname_lower = sname.lower().strip()
        for k, v in class_map.items():
            if k.lower() in sname_lower or sname_lower in k.lower():
                numeric_map[sid] = v
                break

    if not numeric_map:
        return []

    samples = []
    for img_path in list(dataset_dir.rglob("*.jpg")) + list(dataset_dir.rglob("*.jpeg")) + list(dataset_dir.rglob("*.png")):
        label_path = img_path.with_suffix('.txt')
        if not label_path.exists():
            parts = list(img_path.parts)
            try:
                idx = parts.index('images')
                parts[idx] = 'labels'
                alt = Path(*parts).with_suffix('.txt')
                if alt.exists():
                    label_path = alt
            except ValueError:
                pass

        if not label_path.exists():
            continue

        valid_lines = []
        with open(label_path, 'r') as f:
            for line in f:
                p = line.strip().split()
                if len(p) >= 5:
                    try:
                        cid = int(p[0])
                        x, y, w, h = map(float, p[1:5])
                        if 0.0 < w <= 1.0 and 0.0 < h <= 1.0 and 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0:
                            if cid in numeric_map:
                                tid = TARGET_CLASSES[numeric_map[cid]]
                                valid_lines.append(f"{tid} {x} {y} {w} {h}")
                    except ValueError:
                        continue

        if not valid_lines:
            continue

        img = cv2.imread(str(img_path))
        if img is None:
            continue

        samples.append({'img_path': img_path, 'labels': valid_lines})

    return samples


def append_samples(new_samples, split_img_counts):
    random.seed(99)
    random.shuffle(new_samples)
    n = len(new_samples)
    train_end = int(n * 0.8)
    val_end = int(n * 0.9)

    splits = {
        'train': new_samples[:train_end],
        'val': new_samples[train_end:val_end],
        'test': new_samples[val_end:]
    }

    new_counts = defaultdict(int)
    for split_name, samples in splits.items():
        idir = FRESH_DIR / 'images' / split_name
        ldir = FRESH_DIR / 'labels' / split_name
        idir.mkdir(parents=True, exist_ok=True)
        ldir.mkdir(parents=True, exist_ok=True)

        start = split_img_counts.get(split_name, 0)
        for i, sample in enumerate(samples):
            idest = idir / f"aug_{split_name}_{start+i:06d}{sample['img_path'].suffix}"
            shutil.copy2(sample['img_path'], idest)
            ldest = ldir / f"aug_{split_name}_{start+i:06d}.txt"
            with open(ldest, 'w') as f:
                f.write('\n'.join(sample['labels']))
            for line in sample['labels']:
                new_counts[int(line.split()[0])] += 1

        split_img_counts[split_name] = start + len(samples)

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
    print("=" * 60)
    print("Dataset Augmentation: public_obs + Roboflow downloads")
    print("=" * 60)

    print("\n[1/4] Current dataset state:")
    before_counts, split_img_counts = count_existing()
    for cls_id in sorted(before_counts.keys()):
        print(f"  {TARGET_CLASSES_LIST[cls_id]:<15}: {before_counts[cls_id]}")

    all_new = []

    # --- Phase A: Parse local public_obs ---
    print("\n[2/4] Parsing local public_obs folder...")
    obs_samples = parse_public_obs()
    all_new.extend(obs_samples)

    # --- Phase B: Download Roboflow datasets ---
    print("\n[3/4] Downloading from Roboflow...")
    RF_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    for ds in ROBOFLOW_DATASETS:
        print(f"\n  >> {ds['workspace']}/{ds['project']} (target: {ds['target_class']})")
        out_dir = try_download_rf(ds['workspace'], ds['project'], ds['version'])
        if out_dir and out_dir.exists():
            class_map = {k.lower(): v for k, v in ds['class_map'].items()}
            samples = process_rf_dataset(out_dir, class_map)
            print(f"     {len(samples)} valid samples found")
            all_new.extend(samples)

    print(f"\n[4/4] Appending {len(all_new)} new samples to dataset_fresh...")
    new_counts = append_samples(all_new, split_img_counts)

    # Final state
    final_counts = defaultdict(int)
    for cls_id, cnt in before_counts.items():
        final_counts[cls_id] += cnt
    for cls_id, cnt in new_counts.items():
        final_counts[cls_id] += cnt

    active_classes = update_yaml(final_counts)

    print("\n" + "=" * 60)
    print("FINAL DATASET SUMMARY")
    print("=" * 60)
    print(f"\n{'Class':<20} {'Before':>8} {'Added':>8} {'Final':>8}")
    print("-" * 46)
    all_cls = sorted(set(list(before_counts.keys()) + list(new_counts.keys())))
    for cls_id in all_cls:
        name = TARGET_CLASSES_LIST[cls_id]
        b = before_counts.get(cls_id, 0)
        a = new_counts.get(cls_id, 0)
        print(f"{name:<20} {b:>8} {a:>8} {b+a:>8}")

    zero = [TARGET_CLASSES_LIST[i] for i in range(21) if final_counts.get(i, 0) == 0]
    if zero:
        print(f"\n[MISSING] No data for: {zero}")
        print("  These classes are excluded from data.yaml")

    total = sum(split_img_counts.values())
    print(f"\nTotal images: {total}")
    print(f"Active classes: {len(active_classes)}")
    print("\nDone! dataset_fresh is ready.")


if __name__ == "__main__":
    main()
