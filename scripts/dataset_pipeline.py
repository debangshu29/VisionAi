import os
import glob
import shutil
import cv2
import yaml
import random
from collections import defaultdict
from pathlib import Path

# --- CONFIGURATION ---
DATASET_DIR = Path("d:/django/vision/dataset")
OUTPUT_DIR = Path("d:/django/vision/dataset_fresh")
IMG_EXTENSIONS = ('.jpg', '.jpeg', '.png')

# Target Schema (navigation_detection_v1)
TARGET_CLASSES = {
    "obstacle": 0, "pothole": 1, "puddle": 2, "open_drain": 3, "traffic_cone": 4,
    "barrier": 5, "pole": 6, "bollard": 7, "trash_bin": 8, "door": 9,
    "glass_door": 10, "window": 11, "elevator": 12, "handrail": 13, "stair": 14,
    "curb": 15, "ramp": 16, "zebra_cross": 17, "speed_breaker": 18,
    "manhole": 19, "auto_rickshaw": 20
}
TARGET_CLASSES_LIST = sorted(TARGET_CLASSES.keys(), key=lambda k: TARGET_CLASSES[k])

# We only process folders where we explicitly know the mapping
# mapping[dataset_name] = {source_class_id: target_class_name}
KNOWN_DATASETS = {
    "balanced_training": {
        1: "obstacle", 2: "door", 3: "window", 4: "stair", 5: "puddle", 6: "pothole",
        9: "zebra_cross", 37: "traffic_cone"
    },
    "combined_training": {
        1: "obstacle", 2: "door", 3: "window", 4: "stair", 5: "puddle", 6: "pothole",
        9: "zebra_cross"
    },
    "converted\\navigation_public_spaces": {
        # This one matches the target schema perfectly
        0: "obstacle", 1: "pothole", 2: "puddle", 3: "open_drain", 4: "traffic_cone",
        5: "barrier", 6: "pole", 7: "bollard", 8: "trash_bin", 9: "door",
        10: "glass_door", 11: "window", 12: "elevator", 13: "handrail", 14: "stair",
        15: "curb", 16: "ramp", 17: "zebra_cross", 18: "speed_breaker", 19: "manhole",
        20: "auto_rickshaw"
    },
    "public_obs": {
        # Assuming similar to public spaces if names align, but since we don't have a data.yaml
        # we will SKIP folders that aren't in this KNOWN_DATASETS dict explicitly.
    }
}

# Add normalized paths for robust matching
KNOWN_MAPPINGS = {str(DATASET_DIR / k): v for k, v in KNOWN_DATASETS.items() if v}

def is_corrupt(img_path):
    # Try reading the image with cv2 to ensure it's not corrupt
    img = cv2.imread(str(img_path))
    if img is None:
        return True
    return False

def setup_directories():
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    
    for split in ['train', 'val', 'test']:
        (OUTPUT_DIR / 'images' / split).mkdir(parents=True, exist_ok=True)
        (OUTPUT_DIR / 'labels' / split).mkdir(parents=True, exist_ok=True)

def find_dataset_mapping(filepath):
    # Determine which known mapping applies to this file based on its path
    filepath_str = str(filepath.resolve())
    for dataset_path, mapping in KNOWN_MAPPINGS.items():
        if filepath_str.startswith(str(Path(dataset_path).resolve())):
            return mapping
    return None

def process_datasets():
    setup_directories()
    
    all_images = []
    for ext in IMG_EXTENSIONS:
        all_images.extend(DATASET_DIR.rglob(f"*{ext}"))
        
    print(f"Found {len(all_images)} total image files in {DATASET_DIR}")
    
    valid_samples = []
    skipped_corrupt = 0
    skipped_unmapped = 0
    skipped_no_label = 0
    skipped_no_target_classes = 0

    for idx, img_path in enumerate(all_images):
        if idx % 1000 == 0:
            print(f"Processed {idx}/{len(all_images)} images. Valid: {len(valid_samples)}, Corrupt: {skipped_corrupt}, Unmapped: {skipped_unmapped}")
            import sys
            sys.stdout.flush()

        mapping = find_dataset_mapping(img_path)
        if not mapping:
            skipped_unmapped += 1
            continue
            
        label_path = img_path.with_suffix('.txt')
        # Labels are sometimes in a 'labels' sibling dir, sometimes alongside images
        if not label_path.exists():
            # Try to find in corresponding labels dir
            parts = list(label_path.parts)
            try:
                idx_part = parts.index('images')
                parts[idx_part] = 'labels'
                alt_label_path = Path(*parts)
                if alt_label_path.exists():
                    label_path = alt_label_path
            except ValueError:
                pass
                
        if not label_path.exists():
            skipped_no_label += 1
            continue
            
        # Parse labels
        valid_lines = []
        with open(label_path, 'r') as f:
            lines = f.readlines()
            
        for line in lines:
            parts = line.strip().split()
            if len(parts) >= 5:
                try:
                    cls_id = int(parts[0])
                    x, y, w, h = map(float, parts[1:5])
                    
                    # Validate box
                    if 0.0 < w <= 1.0 and 0.0 < h <= 1.0 and 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0:
                        if cls_id in mapping:
                            target_name = mapping[cls_id]
                            target_id = TARGET_CLASSES[target_name]
                            valid_lines.append(f"{target_id} {x} {y} {w} {h}")
                except ValueError:
                    continue
                    
        if not valid_lines:
            skipped_no_target_classes += 1
            continue
            
        # Check corruption last to save disk I/O
        if is_corrupt(img_path):
            skipped_corrupt += 1
            continue
            
        valid_samples.append({
            'img_path': img_path,
            'labels': valid_lines
        })

    print(f"\n--- Filtering Summary ---")
    print(f"Skipped (Unmapped source folder): {skipped_unmapped}")
    print(f"Skipped (No label file): {skipped_no_label}")
    print(f"Skipped (No target classes present): {skipped_no_target_classes}")
    print(f"Skipped (Corrupt image): {skipped_corrupt}")
    print(f"Total Valid Samples Extracted: {len(valid_samples)}")
    
    return valid_samples

def balance_and_split(valid_samples):
    # Count occurrences
    class_counts = defaultdict(int)
    for sample in valid_samples:
        for line in sample['labels']:
            cls_id = int(line.split()[0])
            class_counts[cls_id] += 1
            
    print("\n--- Initial Class Distribution ---")
    for cls_id in sorted(class_counts.keys()):
        print(f"{TARGET_CLASSES_LIST[cls_id]:<15}: {class_counts[cls_id]}")
        
    # We could implement undersampling here. But for now, we will just save everything
    # to see the distribution, and then we can add a balancing step if needed.
    
    # Shuffle and split
    random.seed(42)
    random.shuffle(valid_samples)
    
    n = len(valid_samples)
    train_end = int(n * 0.8)
    val_end = int(n * 0.9)
    
    splits = {
        'train': valid_samples[:train_end],
        'val': valid_samples[train_end:val_end],
        'test': valid_samples[val_end:]
    }
    
    print("\n--- Saving Fresh Dataset ---")
    final_class_counts = defaultdict(int)
    
    for split_name, samples in splits.items():
        print(f"Writing {split_name} split ({len(samples)} images)...")
        for i, sample in enumerate(samples):
            # Copy image
            img_dest = OUTPUT_DIR / 'images' / split_name / f"{split_name}_{i:06d}{sample['img_path'].suffix}"
            shutil.copy2(sample['img_path'], img_dest)
            
            # Write label
            label_dest = OUTPUT_DIR / 'labels' / split_name / f"{split_name}_{i:06d}.txt"
            with open(label_dest, 'w') as f:
                f.write('\n'.join(sample['labels']))
                
            for line in sample['labels']:
                cls_id = int(line.split()[0])
                final_class_counts[cls_id] += 1
                
    # Create data.yaml
    yaml_content = {
        'path': str(OUTPUT_DIR.resolve()).replace('\\', '/'),
        'train': 'images/train',
        'val': 'images/val',
        'test': 'images/test',
        'nc': len(TARGET_CLASSES_LIST),
        'names': {i: name for i, name in enumerate(TARGET_CLASSES_LIST)}
    }
    
    with open(OUTPUT_DIR / 'data.yaml', 'w') as f:
        yaml.dump(yaml_content, f, sort_keys=False)
        
    print("\n--- Final Fresh Dataset Distribution ---")
    for cls_id in sorted(final_class_counts.keys()):
        print(f"{TARGET_CLASSES_LIST[cls_id]:<15}: {final_class_counts[cls_id]}")
    print(f"Total samples saved: {len(valid_samples)}")

if __name__ == "__main__":
    samples = process_datasets()
    if samples:
        balance_and_split(samples)
    else:
        print("No valid samples found to process.")
