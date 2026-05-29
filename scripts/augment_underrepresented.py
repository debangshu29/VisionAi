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
# pole (624), barrier (440), open_drain (282), trash_bin (186), puddle (707), manhole (957)
TARGET_AUGMENT = {2, 3, 5, 6, 8, 19}
AUGMENT_TARGET_COUNT = 1500

transform = A.Compose([
    A.HorizontalFlip(p=0.5),
    A.RandomBrightnessContrast(p=0.5),
    A.GaussianBlur(p=0.3),
    A.GaussNoise(p=0.3),
], bbox_params=A.BboxParams(format='yolo', min_visibility=0.1, label_fields=['class_labels']))

def augment_split(split, current_counts):
    ldir = FRESH_DIR / 'labels' / split
    idir = FRESH_DIR / 'images' / split
    if not ldir.exists() or not idir.exists():
        return
        
    label_files = list(ldir.glob("*.txt"))
    # Find all images containing target classes
    candidates = []
    for lf in label_files:
        with open(lf, 'r') as f:
            lines = [line.strip().split() for line in f if line.strip()]
        
        has_target = False
        for p in lines:
            if int(p[0]) in TARGET_AUGMENT:
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
    
    # We will generate 3 augmented versions for each candidate to rapidly increase counts
    # But we stop if the class reaches 1500
    added = 0
    for img_path, lf, lines in candidates:
        bboxes = []
        class_labels = []
        for p in lines:
            cid = int(p[0])
            # YOLO format: class x_center y_center width height
            x, y, w, h = map(float, p[1:5])
            bboxes.append([x, y, w, h])
            class_labels.append(cid)
            
        # Check if we still need to augment these classes
        needs_augment = False
        for cid in class_labels:
            if cid in TARGET_AUGMENT and current_counts[cid] < AUGMENT_TARGET_COUNT:
                needs_augment = True
                break
                
        if not needs_augment:
            continue
            
        img = cv2.imread(str(img_path))
        if img is None:
            continue
            
        for i in range(3):
            try:
                transformed = transform(image=img, bboxes=bboxes, class_labels=class_labels)
                t_img = transformed['image']
                t_bboxes = transformed['bboxes']
                t_labels = transformed['class_labels']
                
                if len(t_bboxes) == 0:
                    continue
                    
                # Save new image and label
                new_stem = f"{img_path.stem}_aug{i}"
                new_img_path = idir / f"{new_stem}.jpg"
                new_lbl_path = ldir / f"{new_stem}.txt"
                
                cv2.imwrite(str(new_img_path), t_img)
                with open(new_lbl_path, 'w') as f:
                    for t_bbox, t_lbl in zip(t_bboxes, t_labels):
                        f.write(f"{t_lbl} {' '.join(map(str, t_bbox))}\n")
                        current_counts[t_lbl] += 1
                        
                added += 1
            except Exception as e:
                # bounding box outside image or other augmentation error
                continue

    print(f"[{split}] Generated {added} augmented images.")

def main():
    print("Starting augmentation for underrepresented classes...")
    
    # Read current counts from data.yaml if possible, or just scan
    current_counts = defaultdict(int)
    for split in ['train', 'val', 'test']:
        ldir = FRESH_DIR / 'labels' / split
        if ldir.exists():
            for lf in ldir.glob("*.txt"):
                with open(lf, 'r') as f:
                    for line in f:
                        p = line.strip().split()
                        if p:
                            current_counts[int(p[0])] += 1
                            
    for split in ['train', 'val', 'test']:
        augment_split(split, current_counts)
        
    print("\nFinal counts after augmentation:")
    for cid in sorted(current_counts.keys()):
        print(f"  Class {cid}: {current_counts[cid]}")

if __name__ == "__main__":
    main()
