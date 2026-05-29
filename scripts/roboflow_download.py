"""
Roboflow Universe Dataset Downloader
Searches for and downloads best public datasets for each missing/sparse class.
All datasets are downloaded in YOLOv8 format, then run through the same 
preprocessing pipeline to generate clean, mapped labels.
"""

import os
import sys
import io
import shutil
import json

# Force UTF-8 output on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
import requests
from pathlib import Path
from collections import defaultdict
import cv2
import yaml
import random

API_KEY = "KMANRmSg9FInvYHZS1Sr"
DOWNLOAD_DIR = Path("d:/django/vision/dataset/roboflow_downloads")
MERGED_OUTPUT = Path("d:/django/vision/dataset_fresh")

# -----------------------------------------------------------------------
# Curated list of well-known public Roboflow Universe datasets per class.
# Format: (workspace_slug, project_slug, version, [class_name_in_source -> target_name])
# We use the Roboflow search API first, and fall back to these curated ones.
# -----------------------------------------------------------------------
CURATED_DATASETS = [
    # traffic_cone
    {
        "workspace": "conedetection-6g6uc",
        "project": "cone-detection-6ltmn",
        "version": 1,
        "class_map": {"cone": "traffic_cone", "traffic cone": "traffic_cone", "traffic_cone": "traffic_cone"},
        "target_class": "traffic_cone"
    },
    {
        "workspace": "roboflow-universe-projects",
        "project": "traffic-cone-detection",
        "version": 2,
        "class_map": {"cone": "traffic_cone", "traffic cone": "traffic_cone", "traffic_cone": "traffic_cone"},
        "target_class": "traffic_cone"
    },
    # bollard
    {
        "workspace": "roboflow-universe-projects",
        "project": "bollard-detection",
        "version": 1,
        "class_map": {"bollard": "bollard", "Bollard": "bollard"},
        "target_class": "bollard"
    },
    # manhole
    {
        "workspace": "roboflow-universe-projects",
        "project": "manhole-detection-qzpbt",
        "version": 1,
        "class_map": {"manhole": "manhole", "Manhole": "manhole", "open_manhole": "manhole"},
        "target_class": "manhole"
    },
    {
        "workspace": "new-workspace-ogoyw",
        "project": "open-manhole-image-dataset1",
        "version": 1,
        "class_map": {"manhole": "manhole", "open manhole": "manhole"},
        "target_class": "manhole"
    },
    # speed_breaker
    {
        "workspace": "roboflow-universe-projects",
        "project": "speed-bump-detection-vdnip",
        "version": 1,
        "class_map": {"speed bump": "speed_breaker", "speed breaker": "speed_breaker",
                      "speed_bump": "speed_breaker", "speed_breaker": "speed_breaker",
                      "bump": "speed_breaker"},
        "target_class": "speed_breaker"
    },
    # handrail
    {
        "workspace": "roboflow-universe-projects",
        "project": "handrail-detection",
        "version": 1,
        "class_map": {"handrail": "handrail", "Handrail": "handrail", "railing": "handrail"},
        "target_class": "handrail"
    },
    # glass_door
    {
        "workspace": "roboflow-universe-projects",
        "project": "glass-door-detection",
        "version": 1,
        "class_map": {"glass door": "glass_door", "glass_door": "glass_door",
                      "transparent door": "glass_door"},
        "target_class": "glass_door"
    },
    # elevator
    {
        "workspace": "roboflow-universe-projects",
        "project": "elevator-detection",
        "version": 1,
        "class_map": {"elevator": "elevator", "lift": "elevator", "Elevator": "elevator"},
        "target_class": "elevator"
    },
    # curb
    {
        "workspace": "roboflow-universe-projects",
        "project": "curb-detection",
        "version": 1,
        "class_map": {"curb": "curb", "Curb": "curb", "kerb": "curb", "sidewalk_curb": "curb"},
        "target_class": "curb"
    },
    # ramp
    {
        "workspace": "roboflow-universe-projects",
        "project": "ramp-detection",
        "version": 1,
        "class_map": {"ramp": "ramp", "Ramp": "ramp", "wheelchair ramp": "ramp"},
        "target_class": "ramp"
    },
    # auto_rickshaw
    {
        "workspace": "roboflow-universe-projects",
        "project": "auto-rickshaw-detection",
        "version": 1,
        "class_map": {"auto": "auto_rickshaw", "rickshaw": "auto_rickshaw",
                      "auto rickshaw": "auto_rickshaw", "auto_rickshaw": "auto_rickshaw",
                      "tuk-tuk": "auto_rickshaw"},
        "target_class": "auto_rickshaw"
    },
    # pothole supplement
    {
        "workspace": "roboflow-universe-projects",
        "project": "pothole-detection-system",
        "version": 3,
        "class_map": {"pothole": "pothole", "Pothole": "pothole"},
        "target_class": "pothole"
    },
    # trash_bin supplement
    {
        "workspace": "roboflow-universe-projects",
        "project": "garbage-bin-detection",
        "version": 1,
        "class_map": {"bin": "trash_bin", "trash bin": "trash_bin", "trash_bin": "trash_bin",
                      "garbage bin": "trash_bin", "dustbin": "trash_bin"},
        "target_class": "trash_bin"
    },
    # open_drain supplement
    {
        "workspace": "roboflow-universe-projects",
        "project": "open-drain-detection",
        "version": 1,
        "class_map": {"drain": "open_drain", "open drain": "open_drain", "open_drain": "open_drain",
                      "gutter": "open_drain"},
        "target_class": "open_drain"
    },
]

TARGET_CLASSES = {
    "obstacle": 0, "pothole": 1, "puddle": 2, "open_drain": 3, "traffic_cone": 4,
    "barrier": 5, "pole": 6, "bollard": 7, "trash_bin": 8, "door": 9,
    "glass_door": 10, "window": 11, "elevator": 12, "handrail": 13, "stair": 14,
    "curb": 15, "ramp": 16, "zebra_cross": 17, "speed_breaker": 18,
    "manhole": 19, "auto_rickshaw": 20
}
TARGET_CLASSES_LIST = sorted(TARGET_CLASSES.keys(), key=lambda k: TARGET_CLASSES[k])


def search_universe(query, api_key, limit=5):
    """Search Roboflow Universe for datasets matching a query."""
    url = f"https://api.roboflow.com/search"
    params = {
        "query": query,
        "api_key": api_key,
        "type": "project",
    }
    try:
        r = requests.get(url, params=params, timeout=15)
        if r.status_code == 200:
            return r.json().get("results", [])
    except Exception as e:
        print(f"Search error: {e}")
    return []


def try_download(workspace, project, version, api_key, output_dir):
    """Try to download a dataset using the Roboflow Python SDK."""
    try:
        from roboflow import Roboflow
        rf = Roboflow(api_key=api_key)
        proj = rf.workspace(workspace).project(project)
        ver = proj.version(version)
        ds = ver.download("yolov8", location=str(output_dir), overwrite=True)
        print(f"  ✓ Downloaded: {workspace}/{project} v{version}")
        return True
    except Exception as e:
        print(f"  ✗ Failed {workspace}/{project} v{version}: {e}")
        return False


def load_yolo_names(data_yaml_path):
    """Load class names from a YOLOv8 data.yaml file."""
    with open(data_yaml_path, 'r') as f:
        data = yaml.safe_load(f)
    names = data.get("names", {})
    # Handle both list and dict formats
    if isinstance(names, list):
        return {i: n for i, n in enumerate(names)}
    return {int(k): v for k, v in names.items()}


def process_roboflow_dataset(dataset_dir, class_map, existing_class_counts):
    """
    Parse a downloaded Roboflow YOLOv8 dataset and extract samples
    with valid labels mapped to our target schema.
    """
    dataset_dir = Path(dataset_dir)
    data_yaml = dataset_dir / "data.yaml"
    if not data_yaml.exists():
        # Try to find it
        yamls = list(dataset_dir.rglob("data.yaml"))
        if not yamls:
            print(f"  No data.yaml found in {dataset_dir}")
            return []
        data_yaml = yamls[0]

    try:
        source_names = load_yolo_names(data_yaml)
    except Exception as e:
        print(f"  Error loading {data_yaml}: {e}")
        return []

    print(f"  Source classes: {list(source_names.values())}")

    # Build numeric class_map: source_id -> target_name
    numeric_map = {}
    for src_id, src_name in source_names.items():
        src_name_lower = src_name.lower().strip()
        # Try exact match first
        if src_name_lower in class_map:
            numeric_map[src_id] = class_map[src_name_lower]
        else:
            # Try case-insensitive partial match
            for k, v in class_map.items():
                if k.lower() in src_name_lower or src_name_lower in k.lower():
                    numeric_map[src_id] = v
                    break

    if not numeric_map:
        print(f"  No class mappings found. Source classes: {list(source_names.values())}")
        return []

    print(f"  Mapped classes: {numeric_map}")

    samples = []
    for img_path in dataset_dir.rglob("*.jpg"):
        _process_image(img_path, numeric_map, samples)
    for img_path in dataset_dir.rglob("*.jpeg"):
        _process_image(img_path, numeric_map, samples)
    for img_path in dataset_dir.rglob("*.png"):
        _process_image(img_path, numeric_map, samples)

    return samples


def _process_image(img_path, numeric_map, samples):
    """Helper: validate image and extract valid label lines."""
    label_path = img_path.with_suffix('.txt')
    if not label_path.exists():
        parts = list(label_path.parts)
        try:
            idx = parts.index('images')
            parts[idx] = 'labels'
            alt = Path(*parts)
            if alt.exists():
                label_path = alt
        except ValueError:
            pass

    if not label_path.exists():
        return

    valid_lines = []
    try:
        with open(label_path, 'r') as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) >= 5:
                    cls_id = int(parts[0])
                    x, y, w, h = map(float, parts[1:5])
                    if 0.0 < w <= 1.0 and 0.0 < h <= 1.0 and 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0:
                        if cls_id in numeric_map:
                            target_name = numeric_map[cls_id]
                            target_id = TARGET_CLASSES[target_name]
                            valid_lines.append(f"{target_id} {x} {y} {w} {h}")
    except Exception:
        return

    if not valid_lines:
        return

    # Check image is not corrupt
    img = cv2.imread(str(img_path))
    if img is None:
        return

    samples.append({'img_path': img_path, 'labels': valid_lines})


def load_existing_dataset():
    """Load already-processed samples from dataset_fresh to get current counts."""
    counts = defaultdict(int)
    for split in ['train', 'val', 'test']:
        label_dir = MERGED_OUTPUT / 'labels' / split
        if not label_dir.exists():
            continue
        for lf in label_dir.glob("*.txt"):
            with open(lf, 'r') as f:
                for line in f:
                    parts = line.strip().split()
                    if parts:
                        counts[int(parts[0])] += 1
    return counts


def count_existing_images():
    """Count images already in each split."""
    counts = {}
    for split in ['train', 'val', 'test']:
        img_dir = MERGED_OUTPUT / 'images' / split
        if img_dir.exists():
            counts[split] = len(list(img_dir.glob("*.*")))
        else:
            counts[split] = 0
    return counts


def append_samples_to_dataset(new_samples, existing_image_counts):
    """Append new validated samples into the existing dataset_fresh folder."""
    random.seed(42)
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
        img_dir = MERGED_OUTPUT / 'images' / split_name
        label_dir = MERGED_OUTPUT / 'labels' / split_name
        img_dir.mkdir(parents=True, exist_ok=True)
        label_dir.mkdir(parents=True, exist_ok=True)

        start_idx = existing_image_counts.get(split_name, 0)
        for i, sample in enumerate(samples):
            dest_idx = start_idx + i
            img_dest = img_dir / f"rf_{split_name}_{dest_idx:06d}{sample['img_path'].suffix}"
            shutil.copy2(sample['img_path'], img_dest)
            lbl_dest = label_dir / f"rf_{split_name}_{dest_idx:06d}.txt"
            with open(lbl_dest, 'w') as f:
                f.write('\n'.join(sample['labels']))
            for line in sample['labels']:
                new_counts[int(line.split()[0])] += 1

        existing_image_counts[split_name] = start_idx + len(samples)

    return new_counts


def update_data_yaml():
    """Regenerate data.yaml with final active classes."""
    yaml_path = MERGED_OUTPUT / 'data.yaml'

    # Count what classes actually exist
    active_ids = set()
    for split in ['train', 'val', 'test']:
        label_dir = MERGED_OUTPUT / 'labels' / split
        if not label_dir.exists():
            continue
        for lf in label_dir.glob("*.txt"):
            with open(lf, 'r') as f:
                for line in f:
                    parts = line.strip().split()
                    if parts:
                        active_ids.add(int(parts[0]))

    active_names = {i: TARGET_CLASSES_LIST[i] for i in sorted(active_ids)}
    yaml_content = {
        'path': str(MERGED_OUTPUT.resolve()).replace('\\', '/'),
        'train': 'images/train',
        'val': 'images/val',
        'test': 'images/test',
        'nc': len(active_names),
        'names': active_names
    }
    with open(yaml_path, 'w') as f:
        yaml.dump(yaml_content, f, sort_keys=False)
    print(f"\nUpdated data.yaml with {len(active_names)} active classes.")
    return active_names


def main():
    print("=" * 60)
    print("Roboflow Dataset Downloader & Merger")
    print("=" * 60)

    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    print("\n[1/4] Loading current dataset state...")
    existing_counts = load_existing_dataset()
    existing_img_counts = count_existing_images()

    print("Current class distribution (bounding boxes):")
    for cls_id in sorted(existing_counts.keys()):
        print(f"  {TARGET_CLASSES_LIST[cls_id]:<15}: {existing_counts[cls_id]}")

    all_new_samples = []
    download_summary = {}

    print("\n[2/4] Downloading datasets from Roboflow Universe...")
    for ds_info in CURATED_DATASETS:
        workspace = ds_info["workspace"]
        project = ds_info["project"]
        version = ds_info["version"]
        class_map = {k.lower(): v for k, v in ds_info["class_map"].items()}
        target_class = ds_info["target_class"]

        print(f"\n>> Trying {workspace}/{project} (target: {target_class})")
        output_dir = DOWNLOAD_DIR / f"{workspace}__{project}"

        if output_dir.exists():
            print("  Already downloaded, using cached version.")
            success = True
        else:
            success = try_download(workspace, project, version, API_KEY, output_dir)

        if success and output_dir.exists():
            print("  Processing extracted samples...")
            samples = process_roboflow_dataset(output_dir, class_map, existing_counts)
            if samples:
                print(f"  [OK] Found {len(samples)} valid samples for '{target_class}'")
                all_new_samples.extend(samples)
                download_summary[target_class] = download_summary.get(target_class, 0) + len(samples)
            else:
                print("  [SKIP] No usable samples extracted (class name mismatch or empty dataset)")

    print(f"\n[3/4] Adding {len(all_new_samples)} new samples to dataset_fresh...")
    new_counts = append_samples_to_dataset(all_new_samples, existing_img_counts)

    print("\n[4/4] Updating data.yaml...")
    active_classes = update_data_yaml()

    print("\n" + "=" * 60)
    print("FINAL DATASET SUMMARY")
    print("=" * 60)

    # Reload final counts
    final_counts = load_existing_dataset()
    print(f"\n{'Class':<20} {'Before':>10} {'Added':>10} {'Final':>10}")
    print("-" * 52)
    for cls_id in sorted(final_counts.keys()):
        name = TARGET_CLASSES_LIST[cls_id]
        before = existing_counts.get(cls_id, 0)
        added = new_counts.get(cls_id, 0)
        final = final_counts[cls_id]
        print(f"{name:<20} {before:>10} {added:>10} {final:>10}")

    # Classes still at 0
    zero_classes = [TARGET_CLASSES_LIST[i] for i in range(len(TARGET_CLASSES_LIST))
                    if final_counts.get(i, 0) == 0]
    if zero_classes:
        print(f"\n[WARNING] Still zero samples for: {zero_classes}")
        print("   These will be removed from data.yaml automatically.")

    total_imgs = sum(existing_img_counts.values())
    print(f"\nTotal images in dataset_fresh: {total_imgs}")
    print(f"Active classes in data.yaml: {len(active_classes)}")


if __name__ == "__main__":
    main()
