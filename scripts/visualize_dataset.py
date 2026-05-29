import cv2
import os
import random
from pathlib import Path

# Configuration
DATASET_DIR = Path(str(Path(__file__).resolve().parent.parent / "dataset/combined_training"))
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "debug_viz"
OUTPUT_DIR.mkdir(exist_ok=True)

# Master Classes
CLASSES = ["person", "obstacle", "door", "window", "stair", "puddle", "pothole", "car", "bicycle", "zebra_cross"]
COLORS = [(0, 255, 0), (0, 0, 255), (255, 0, 0), (255, 255, 0), (255, 0, 255), (0, 255, 255), (128, 0, 0), (0, 128, 0), (0, 0, 128), (128, 128, 128)]

def visualize_samples(num_samples=10):
    img_files = list((DATASET_DIR / "images" / "train").glob("*.jpg"))
    samples = random.sample(img_files, min(num_samples, len(img_files)))
    
    for img_path in samples:
        lab_path = DATASET_DIR / "labels" / "train" / (img_path.stem + ".txt")
        if not lab_path.exists():
            continue
            
        img = cv2.imread(str(img_path))
        h, w, _ = img.shape
        
        with open(lab_path, "r") as f:
            for line in f:
                cls, x, y, nw, nh = map(float, line.split())
                cls = int(cls)
                
                # Rescale coordinates
                x1 = int((x - nw/2) * w)
                y1 = int((y - nh/2) * h)
                x2 = int((x + nw/2) * w)
                y2 = int((y + nh/2) * h)
                
                cv2.rectangle(img, (x1, y1), (x2, y2), COLORS[cls % len(COLORS)], 2)
                cv2.putText(img, CLASSES[cls], (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, COLORS[cls % len(COLORS)], 2)
                
        cv2.imwrite(str(OUTPUT_DIR / img_path.name), img)
    
    print(f"Visualizations saved to: {OUTPUT_DIR}")

if __name__ == "__main__":
    visualize_samples()
