import os
import json
import xml.etree.ElementTree as ET
import shutil
from pathlib import Path
from tqdm import tqdm
import random
from collections import defaultdict

# Configuration
BASE_DIR = Path(str(Path(__file__).resolve().parent.parent))
DATASET_DIR = BASE_DIR / "dataset"
OUTPUT_DIR = DATASET_DIR / "balanced_training"

# Master Class Mapping
MASTER_CLASSES = {
    "person": 0, "obstacle": 1, "door": 2, "window": 3, "stair": 4,
    "puddle": 5, "pothole": 6, "car": 7, "bicycle": 8, "zebra_cross": 9
}

# Target: ~2000 images total
MAX_IMAGES_PER_DATASET = 400 

def create_structure():
    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    for split in ["train", "val", "test"]:
        (OUTPUT_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
        (OUTPUT_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

def normalize_bbox(size, box):
    dw = 1.0 / size[0]
    dh = 1.0 / size[1]
    x = (box[0] + box[1]) / 2.0
    y = (box[2] + box[3]) / 2.0
    w = box[1] - box[0]
    h = box[3] - box[2]
    return (x * dw, y * dh, w * dw, h * dh)

def save_data(img_file, yolo_lines, index, total):
    if not yolo_lines: return
    split = "train" if index < total * 0.8 else ("val" if index < total * 0.9 else "test")
    shutil.copy(img_file, OUTPUT_DIR / "images" / split / img_file.name)
    with open(OUTPUT_DIR / "labels" / split / (img_file.stem + ".txt"), "w") as f:
        f.write("\n".join(yolo_lines))

def process_pedestrian():
    print("Processing Pedestrian_Detection (Subsampled)...")
    ped_dir = DATASET_DIR / "Pedestrian_Detection" / "Train" / "Train"
    ann_dir = ped_dir / "Annotations"
    img_dir = ped_dir / "JPEGImages"
    files = list(ann_dir.glob("*.xml"))
    random.shuffle(files)
    files = files[:MAX_IMAGES_PER_DATASET]
    
    for i, xml_file in enumerate(tqdm(files)):
        img_file = img_dir / (xml_file.stem + ".jpg")
        if not img_file.exists(): continue
        tree = ET.parse(xml_file)
        root = tree.getroot()
        size = root.find("size")
        w, h = int(size.find("width").text), int(size.find("height").text)
        yolo_lines = []
        for obj in root.findall("object"):
            if obj.find("name").text == "person":
                xmlbox = obj.find("bndbox")
                b = (float(xmlbox.find("xmin").text), float(xmlbox.find("xmax").text),
                     float(xmlbox.find("ymin").text), float(xmlbox.find("ymax").text))
                bb = normalize_bbox((w, h), b)
                yolo_lines.append(f"0 {' '.join([f'{a:.6f}' for a in bb])}")
        save_data(img_file, yolo_lines, i, len(files))

def process_public_spaces():
    print("Processing Obstacles in PublicSpaces (Fixed)...")
    ps_dir = DATASET_DIR / "Obstacles in PublicSpaces"
    ann_file = ps_dir / "_annotations.txt"
    if not ann_file.exists(): return
    
    # Remap from 0-indexed (based on _classes.txt observation)
    remap = {2: 5, 3: 1, 4: 1, 5: 6, 6: 1, 7: 1, 8: 6, 9: 7, 10: 8, 11: 0, 15: 2, 19: 4, 21: 9}
    
    img_data = defaultdict(list)
    with open(ann_file) as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 2: continue
            fname = parts[0]
            for ann in parts[1:]:
                # ann is xmin,ymin,xmax,ymax,cls
                box = list(map(int, ann.split(",")))
                old_id = box[4]
                if old_id in remap:
                    img_data[fname].append((remap[old_id], box[:4]))
    
    fnames = list(img_data.keys())
    random.shuffle(fnames)
    fnames = fnames[:MAX_IMAGES_PER_DATASET]
    
    for i, fname in enumerate(tqdm(fnames)):
        img_file = ps_dir / fname
        if not img_file.exists(): continue
        # For simplicity, assume 640x640 if not readable, but better to read
        yolo_lines = []
        for new_id, box in img_data[fname]:
            # Scale 0-608? The annotations showed 608 in some places
            w, h = 608, 608 # Common for this dataset format
            bb = normalize_bbox((w, h), (box[0], box[2], box[1], box[3]))
            yolo_lines.append(f"{new_id} {' '.join([f'{a:.6f}' for a in bb])}")
        save_data(img_file, yolo_lines, i, len(fnames))

def process_nighttime():
    print("Processing Nighttime (Subsampled)...")
    night_dir = DATASET_DIR / "Nighttime_Pedestrian_Detection"
    ann_file = night_dir / "anno" / "new_train_annotations_rgb.json"
    img_dir = night_dir / "left_rgb"
    with open(ann_file) as f: data = json.load(f)
    mapping = {1: 0, 2: 0, 3: 8, 4: 7} # person, rider->person, bicycle, car
    images = {img["id"]: img for img in data["images"]}
    img_anns = defaultdict(list)
    for ann in data["annotations"]: img_anns[ann["image_id"]].append(ann)
    img_ids = list(img_anns.keys())
    random.shuffle(img_ids)
    img_ids = img_ids[:MAX_IMAGES_PER_DATASET]
    for i, img_id in enumerate(tqdm(img_ids)):
        img_info = images[img_id]
        img_file = img_dir / img_info["file_name"]
        if not img_file.exists(): continue
        w, h = img_info["width"], img_info["height"]
        yolo_lines = []
        for ann in img_anns[img_id]:
            if ann["category_id"] in mapping:
                cls_id = mapping[ann["category_id"]]
                b = ann["bbox"]
                yolo_lines.append(f"{cls_id} {(b[0]+b[2]/2)/w:.6f} {(b[1]+b[3]/2)/h:.6f} {b[2]/w:.6f} {b[3]/h:.6f}")
        save_data(img_file, yolo_lines, i, len(img_ids))

def process_others():
    print("Processing Doors, Stairs, Indoor (Subsampled)...")
    # Door/Stairs
    ds_dir = DATASET_DIR / "Door, Windows and Stairs Dataset (Annotated)" / "images"
    remap_ds = {0: 2, 1: 3, 2: 4}
    files = list(ds_dir.glob("*.jpg"))
    random.shuffle(files)
    for i, img_file in enumerate(tqdm(files[:200], desc="Doors")):
        lab_file = img_file.with_suffix(".txt")
        if not lab_file.exists(): continue
        yolo_lines = []
        with open(lab_file) as f:
            for line in f:
                p = line.split()
                if p and int(p[0]) in remap_ds:
                    yolo_lines.append(f"{remap_ds[int(p[0])]} {' '.join(p[1:])}")
        save_data(img_file, yolo_lines, i, 200)

if __name__ == "__main__":
    create_structure()
    process_pedestrian()
    process_public_spaces()
    process_nighttime()
    process_others()
    print(f"\nBalanced Dataset Ready at: {OUTPUT_DIR}")
