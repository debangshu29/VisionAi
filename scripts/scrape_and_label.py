import os
import sys
import io
import time
import cv2
import torch
from pathlib import Path
from PIL import Image

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

try:
    from bing_image_downloader import downloader
    from transformers import pipeline
except ImportError:
    print("Dependencies missing. Run: pip install bing-image-downloader transformers accelerate Pillow")
    sys.exit(1)

FRESH_DIR = Path("d:/django/vision/dataset_fresh")
SCRAPE_DIR = Path("d:/django/vision/dataset/scraped")
SCRAPE_DIR.mkdir(parents=True, exist_ok=True)

# Missing classes we need to scrape and auto-label
CLASSES_TO_SCRAPE = {
    "glass_door": 10,
    "elevator": 12,
    "handrail": 13,
    "curb": 15,
    "auto_rickshaw": 20
}

QUERIES = {
    "glass_door": "glass door entrance",
    "elevator": "elevator doors closed",
    "handrail": "staircase handrail",
    "curb": "sidewalk street curb",
    "auto_rickshaw": "indian auto rickshaw on street"
}

def download_images(query, class_name, max_results=50):
    print(f"Scraping images for {class_name} using Bing...")
    output_dir = SCRAPE_DIR / "bing"
    
    downloader.download(query, limit=max_results,  output_dir=str(output_dir), 
                        adult_filter_off=True, force_replace=False, timeout=10, verbose=False)
    
    downloaded = []
    query_dir = output_dir / query
    if query_dir.exists():
        for f in query_dir.glob("*.*"):
            if f.suffix.lower() in ['.jpg', '.jpeg', '.png']:
                downloaded.append(f)
                
    print(f"Downloaded {len(downloaded)} images for {class_name}")
    return downloaded

def auto_label(images, class_name, target_id):
    print(f"Auto-labeling {len(images)} images for {class_name} using OWL-ViT...")
    # Use OWL-ViT for zero-shot object detection
    detector = pipeline(model="google/owlvit-base-patch32", task="zero-shot-object-detection")
    
    valid_samples = []
    for img_path in images:
        try:
            pil_img = Image.open(img_path).convert("RGB")
            w, h = pil_img.size
            # The prompt for the model
            prompt = class_name.replace("_", " ")
            
            predictions = detector(
                pil_img, 
                candidate_labels=[prompt],
            )
            
            yolo_labels = []
            for pred in predictions:
                if pred["score"] > 0.15: # Confidence threshold
                    box = pred["box"]
                    # Convert to YOLO (x_center, y_center, width, height) normalized
                    x_c = (box["xmin"] + box["xmax"]) / 2.0 / w
                    y_c = (box["ymin"] + box["ymax"]) / 2.0 / h
                    bw = (box["xmax"] - box["xmin"]) / w
                    bh = (box["ymax"] - box["ymin"]) / h
                    yolo_labels.append(f"{target_id} {x_c:.6f} {y_c:.6f} {bw:.6f} {bh:.6f}")
            
            if yolo_labels:
                valid_samples.append({
                    "img_path": img_path,
                    "labels": yolo_labels
                })
        except Exception as e:
            print(f"Labeling failed for {img_path}: {e}")
            
    print(f"Found objects in {len(valid_samples)} images for {class_name}")
    return valid_samples

def append_to_fresh(samples):
    import shutil
    import random
    
    train_dir_img = FRESH_DIR / 'images' / 'train'
    train_dir_lbl = FRESH_DIR / 'labels' / 'train'
    val_dir_img = FRESH_DIR / 'images' / 'val'
    val_dir_lbl = FRESH_DIR / 'labels' / 'val'
    
    # Get current index offset to prevent overwrites
    existing = list(train_dir_img.glob("*.*"))
    start_idx = len(existing)
    
    added = 0
    for sample in samples:
        # Split 90/10 train/val
        if random.random() < 0.9:
            idir = train_dir_img
            ldir = train_dir_lbl
        else:
            idir = val_dir_img
            ldir = val_dir_lbl
            
        new_stem = f"aug_scraped_{start_idx}"
        start_idx += 1
        
        try:
            idest = idir / f"{new_stem}{sample['img_path'].suffix}"
            shutil.copy2(sample['img_path'], idest)
            
            ldest = ldir / f"{new_stem}.txt"
            with open(ldest, 'w') as f:
                f.write("\n".join(sample['labels']))
            added += 1
        except Exception as e:
            pass
            
    return added

def main():
    print("Starting Scraping and Auto-labeling Pipeline...")
    total_added = 0
    for cls, tid in CLASSES_TO_SCRAPE.items():
        q = QUERIES[cls]
        downloaded = download_images(q, cls, max_results=50)
        if downloaded:
            samples = auto_label(downloaded, cls, tid)
            added = append_to_fresh(samples)
            total_added += added
            print(f"Added {added} {cls} images to dataset.")
            
    print(f"\nPipeline finished. Added {total_added} total auto-labeled images.")

if __name__ == "__main__":
    main()
