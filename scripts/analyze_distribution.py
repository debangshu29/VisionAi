import os
from pathlib import Path
from collections import Counter

def analyze_classes(label_dir):
    counter = Counter()
    label_files = list(Path(label_dir).glob("*.txt"))
    
    for lab in label_files:
        with open(lab, "r") as f:
            classes_in_file = set()
            for line in f:
                parts = line.split()
                if parts:
                    counter[int(parts[0])] += 1
                    
    return counter

if __name__ == "__main__":
    DATASET_DIR = str(Path(__file__).resolve().parent.parent / "dataset/combined_training/labels/train")
    CLASSES = ["person", "obstacle", "door", "window", "stair", "puddle", "pothole", "car", "bicycle", "zebra_cross"]
    
    counts = analyze_classes(DATASET_DIR)
    print("Class Distribution in Training Set:")
    for i, name in enumerate(CLASSES):
        print(f"{i}: {name} -> {counts.get(i, 0)} instances")
