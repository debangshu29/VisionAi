import os
import sys
import io
import cv2
import random
from pathlib import Path
from collections import defaultdict
import albumentations as A

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

FRESH_DIR = Path("d:/django/vision/dataset_fresh")

# Classes we want to augment (current count < 1000)
# puddle (2), open_drain (3), barrier (5), pole (6), bollard (7), trash_bin (8), manhole (19)
TARGET_AUGMENT = {2, 3, 5, 6, 7, 8, 19}
AUGMENT_TARGET_COUNT = 1500

transform = A.Compose([
    A.HorizontalFlip(p=0.5),
    A.RandomBrightnessContrast(brightness_limit=0.2, contrast_limit=0.2, p=0.5),
    A.GaussianBlur(blur_limit=3, p=0.3),
    A.GaussNoise(var_limit=(10.0, 50.0), p=0.3),
], bbox_params=A.BboxParams(format='yolo', min_visibility=0.2, label_fields=['class_labels']))

def augment_split(split, current_counts):
    ldir = FRESH_DIR / 'labels' / split
    idir = FRESH_DIR / 'images' / split
    if not ldir.exists() or not idir.exists():
        return
        
    label_files = list(ldir.glob("*.txt"))
    candidates = []
    for lf in label_files:
        with open(lf, 'r') as f:
            lines = [line.strip().split() for line in f if line.strip()]
        
        has_target = False
        for p in lines:
            if len(p) >= 5 and int(p[0]) in TARGET_AUGMENT:
                has_target = True
                break
        
        if has_target:
            img_stem = lf.stem
            for ext in ['.jpg', '.jpeg', '.png']:
                img_path = idir / f"{img_stem}{ext}"
                if img_path.exists():
                    candidates.append((img_path, lf, lines))
                    break
                    
    print(f"[{split}] Found {len(candidates)} candidate images for augmentation.")
    
    # Generate up to 4 augmented versions
    added = 0
    for img_path, lf, lines in candidates:
        bboxes = []
        class_labels = []
        for p in lines:
            if len(p) < 5: continue
            cid = int(p[0])
            x, y, w, h = map(float, p[1:5])
            
            # Albumentations expects coordinates to be strictly (0, 1]
            x = max(0.0001, min(0.9999, x))
            y = max(0.0001, min(0.9999, y))
            w = max(0.0001, min(0.9999, w))
            h = max(0.0001, min(0.9999, h))
            
            # Make sure bbox is valid
            if w > 0 and h > 0 and (x - w/2) >= 0 and (x + w/2) <= 1 and (y - h/2) >= 0 and (y + h/2) <= 1:
                bboxes.append([x, y, w, h])
                class_labels.append(cid)
            else:
                # Clip box
                xmin = max(0.0, x - w/2)
                xmax = min(1.0, x + w/2)
                ymin = max(0.0, y - h/2)
                ymax = min(1.0, y + h/2)
                new_w = xmax - xmin
                new_h = ymax - ymin
                new_x = xmin + new_w/2
                new_y = ymin + new_h/2
                if new_w > 0.001 and new_h > 0.001:
                    bboxes.append([new_x, new_y, new_w, new_h])
                    class_labels.append(cid)
            
        needs_augment = False
        for cid in class_labels:
            if cid in TARGET_AUGMENT and current_counts[cid] < AUGMENT_TARGET_COUNT:
                needs_augment = True
                break
                
        if not needs_augment or len(bboxes) == 0:
            continue
            
        img = cv2.imread(str(img_path))
        if img is None:
            continue
            
        for i in range(4):
            # Check if we still need to augment
            still_need = any(c in TARGET_AUGMENT and current_counts[c] < AUGMENT_TARGET_COUNT for c in class_labels)
            if not still_need:
                break
                
            try:
                transformed = transform(image=img, bboxes=bboxes, class_labels=class_labels)
                t_img = transformed['image']
                t_bboxes = transformed['bboxes']
                t_labels = transformed['class_labels']
                
                if len(t_bboxes) == 0:
                    continue
                    
                new_stem = f"{img_path.stem}_augV2_{i}"
                new_img_path = idir / f"{new_stem}.jpg"
                new_lbl_path = ldir / f"{new_stem}.txt"
                
                cv2.imwrite(str(new_img_path), t_img)
                with open(new_lbl_path, 'w') as f:
                    for t_bbox, t_lbl in zip(t_bboxes, t_labels):
                        f.write(f"{t_lbl} {' '.join(map(str, t_bbox))}\n")
                        current_counts[t_lbl] += 1
                        
                added += 1
            except Exception as e:
                continue

    print(f"[{split}] Generated {added} augmented images.")

def main():
    print("Starting augmentation V2 for underrepresented classes...")
    
    current_counts = defaultdict(int)
    for split in ['train', 'val', 'test']:
        ldir = FRESH_DIR / 'labels' / split
        if ldir.exists():
            for lf in ldir.glob("*.txt"):
                with open(lf, 'r') as f:
                    for line in f:
                        p = line.strip().split()
                        if len(p) >= 5:
                            current_counts[int(p[0])] += 1
                            
    for split in ['train', 'val', 'test']:
        augment_split(split, current_counts)
        
    print("\nFinal counts after augmentation V2:")
    for cid in sorted(current_counts.keys()):
        print(f"  Class {cid}: {current_counts[cid]}")

if __name__ == "__main__":
    main()
