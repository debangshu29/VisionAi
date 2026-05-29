import os
import sys
import io
import shutil
import random
import zipfile
import urllib.request
from pathlib import Path
from collections import defaultdict
import yaml

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

TOKEN = "KGAT_ef932ea6fa955b0bbafcb416aee46bc2"
BASE_URL = "https://www.kaggle.com/api/v1"

FRESH_DIR = Path("d:/django/vision/dataset_fresh")
DOWNLOAD_DIR = Path("d:/django/vision/dataset/kaggle_downloads/specific")
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

TARGET_CLASSES = {
    "obstacle": 0, "pothole": 1, "puddle": 2, "open_drain": 3, "traffic_cone": 4,
    "barrier": 5, "pole": 6, "bollard": 7, "trash_bin": 8, "door": 9,
    "glass_door": 10, "window": 11, "elevator": 12, "handrail": 13, "stair": 14,
    "curb": 15, "ramp": 16, "zebra_cross": 17, "speed_breaker": 18,
    "manhole": 19, "auto_rickshaw": 20
}
TARGET_CLASSES_LIST = sorted(TARGET_CLASSES.keys(), key=lambda k: TARGET_CLASSES[k])

DATASETS = [
    {
        "ref": "mridankanmandal/indian-driving-dataset-detections-yolov11",
        "target_class": "auto_rickshaw",
        "target_id": 20,
        "source_classes": ["autorickshaw"],  # Based on IDD class names
        "id_map": {}
    },
    {
        "ref": "azeezmuhammed/bollards-datasets",
        "target_class": "bollard",
        "target_id": 7,
        "source_classes": ["bollard", "Bollard"],
        "id_map": {}
    }
]

def download_dataset(ref):
    out_path = DOWNLOAD_DIR / f"{ref.replace('/', '__')}.zip"
    if not out_path.exists():
        print(f"Downloading {ref}...")
        req = urllib.request.Request(BASE_URL + f"/datasets/download/{ref}")
        req.add_header("Authorization", f"Bearer {TOKEN}")
        try:
            with urllib.request.urlopen(req) as r:
                with open(out_path, 'wb') as f:
                    f.write(r.read())
        except Exception as e:
            print(f"Download Error {ref}: {e}")
            return None
    return out_path

def extract_zip(zip_path):
    extract_dir = zip_path.with_suffix('')
    if not extract_dir.exists():
        print(f"Extracting {zip_path.name}...")
        with zipfile.ZipFile(zip_path, 'r') as z:
            z.extractall(extract_dir)
    return extract_dir

def process_dataset(ds_config, extract_dir):
    # Find data.yaml to build id_map
    yaml_files = list(extract_dir.rglob("data.yaml"))
    if not yaml_files:
        print(f"No data.yaml found for {ds_config['ref']}")
        # Try to infer mapping if 1 class
        ds_config['id_map'] = {0: ds_config['target_id']}
    else:
        with open(yaml_files[0], 'r') as f:
            data = yaml.safe_load(f)
        names = data.get('names', {})
        if isinstance(names, list):
            for i, name in enumerate(names):
                if name.lower() in [s.lower() for s in ds_config['source_classes']]:
                    ds_config['id_map'][i] = ds_config['target_id']
        else:
            for k, name in names.items():
                if name.lower() in [s.lower() for s in ds_config['source_classes']]:
                    ds_config['id_map'][int(k)] = ds_config['target_id']
                    
    if not ds_config['id_map']:
        # Fallback assume class 0 is target
        ds_config['id_map'] = {0: ds_config['target_id']}

    print(f"[{ds_config['target_class']}] Mapping: {ds_config['id_map']}")
    
    samples = []
    # Find all images
    for ext in ['*.jpg', '*.jpeg', '*.png']:
        for img_path in extract_dir.rglob(ext):
            # Locate label
            parts = list(img_path.parts)
            try:
                idx = parts.index('images')
                parts[idx] = 'labels'
                lbl_path = Path(*parts).with_suffix('.txt')
            except ValueError:
                lbl_path = img_path.with_suffix('.txt')
                
            if not lbl_path.exists():
                continue
                
            valid_lines = []
            with open(lbl_path, 'r') as f:
                for line in f:
                    p = line.strip().split()
                    if len(p) >= 5:
                        try:
                            cid = int(p[0])
                            if cid in ds_config['id_map']:
                                valid_lines.append(f"{ds_config['id_map'][cid]} {' '.join(p[1:5])}")
                        except ValueError:
                            continue
            
            if valid_lines:
                samples.append({'img_path': img_path, 'labels': valid_lines})
                
    return samples

def append_to_fresh(samples, split_img_counts, max_cap=1500):
    random.seed(42)
    random.shuffle(samples)
    samples = samples[:max_cap]
    
    n = len(samples)
    if n == 0:
        return 0
        
    train_end = int(n * 0.8)
    val_end = int(n * 0.9)

    splits = {
        'train': samples[:train_end],
        'val': samples[train_end:val_end],
        'test': samples[val_end:]
    }

    added = 0
    for split_name, split_samples in splits.items():
        idir = FRESH_DIR / 'images' / split_name
        ldir = FRESH_DIR / 'labels' / split_name
        
        start = split_img_counts.get(split_name, 0)
        for i, sample in enumerate(split_samples):
            idest = idir / f"aug_specific_{split_name}_{start+i:06d}{sample['img_path'].suffix}"
            shutil.copy2(sample['img_path'], idest)
            ldest = ldir / f"aug_specific_{split_name}_{start+i:06d}.txt"
            with open(ldest, 'w') as f:
                f.write('\n'.join(sample['labels']))
            added += 1
            
        split_img_counts[split_name] = start + len(split_samples)

    return added

def main():
    print("Fetching specific datasets from Kaggle...")
    
    split_img_counts = {}
    for split in ['train', 'val', 'test']:
        idir = FRESH_DIR / 'images' / split
        split_img_counts[split] = len(list(idir.glob("*.*"))) if idir.exists() else 0
        
    for ds in DATASETS:
        zip_path = download_dataset(ds['ref'])
        if zip_path:
            ext_dir = extract_zip(zip_path)
            samples = process_dataset(ds, ext_dir)
            print(f"Found {len(samples)} images for {ds['target_class']}")
            added = append_to_fresh(samples, split_img_counts)
            print(f"Appended {added} to dataset_fresh.")
            
    print("Done adding specific classes.")

if __name__ == "__main__":
    main()
