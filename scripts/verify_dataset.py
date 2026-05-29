import os
import cv2
from pathlib import Path
import yaml

FRESH_DIR = Path("d:/django/vision/dataset_fresh")

def verify_and_clean():
    print("Initializing Deep Verification of Dataset...")
    
    # Load yaml
    yaml_path = FRESH_DIR / 'data.yaml'
    if not yaml_path.exists():
        print("CRITICAL ERROR: data.yaml missing.")
        return
        
    with open(yaml_path, 'r') as f:
        data = yaml.safe_load(f)
    
    valid_classes = set(data['names'].keys())
    print(f"Valid Class IDs: {valid_classes}")
    
    stats = {
        'corrupt_images': 0,
        'missing_labels': 0,
        'empty_labels': 0,
        'invalid_yolo_bounds': 0,
        'invalid_class_ids': 0,
        'total_images_kept': 0
    }
    
    for split in ['train', 'val', 'test']:
        img_dir = FRESH_DIR / 'images' / split
        lbl_dir = FRESH_DIR / 'labels' / split
        
        if not img_dir.exists():
            continue
            
        for img_path in list(img_dir.glob("*.*")):
            if img_path.suffix.lower() not in ['.jpg', '.jpeg', '.png']:
                continue
                
            # 1. Check if image is corrupt (just check size to avoid massive cv2.imread overhead)
            if img_path.stat().st_size == 0:
                stats['corrupt_images'] += 1
                img_path.unlink()
                continue
                
            # 2. Check missing label
            lbl_path = lbl_dir / f"{img_path.stem}.txt"
            if not lbl_path.exists():
                stats['missing_labels'] += 1
                img_path.unlink()
                continue
                
            # 3. Check empty label
            with open(lbl_path, 'r') as f:
                lines = [line.strip() for line in f if line.strip()]
                
            if not lines:
                stats['empty_labels'] += 1
                lbl_path.unlink()
                img_path.unlink()
                continue
                
            # 4. & 5. Check YOLO bounds and class IDs
            valid_lines = []
            has_error = False
            for line in lines:
                parts = line.split()
                if len(parts) != 5:
                    has_error = True
                    continue
                try:
                    cid = int(float(parts[0]))
                    x, y, w, h = map(float, parts[1:5])
                    
                    if cid not in valid_classes:
                        stats['invalid_class_ids'] += 1
                        has_error = True
                        continue
                        
                    if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0 and 0.0 <= w <= 1.0 and 0.0 <= h <= 1.0):
                        stats['invalid_yolo_bounds'] += 1
                        has_error = True
                        continue
                        
                    valid_lines.append(line)
                except ValueError:
                    has_error = True
                    continue
                    
            if not valid_lines:
                stats['empty_labels'] += 1
                lbl_path.unlink()
                img_path.unlink()
                continue
                
            if has_error:
                # Rewrite label file with only valid lines
                with open(lbl_path, 'w') as f:
                    f.write('\n'.join(valid_lines))
                    
            stats['total_images_kept'] += 1

    print("\nVerification Complete.")
    print(f"Corrupt Images Deleted: {stats['corrupt_images']}")
    print(f"Missing Labels Removed: {stats['missing_labels']}")
    print(f"Empty Labels Removed: {stats['empty_labels']}")
    print(f"Lines with Invalid Bounds Cleaned: {stats['invalid_yolo_bounds']}")
    print(f"Lines with Invalid Class IDs Cleaned: {stats['invalid_class_ids']}")
    print(f"Total Flawless Images Kept: {stats['total_images_kept']}")

if __name__ == "__main__":
    verify_and_clean()
