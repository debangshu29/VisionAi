import os
import json
import xml.etree.ElementTree as ET
import shutil
from pathlib import Path
from tqdm import tqdm
import random

# Configuration
BASE_DIR = Path(str(Path(__file__).resolve().parent.parent))
DATASET_DIR = BASE_DIR / "dataset"
OUTPUT_DIR = DATASET_DIR / "combined_training"

# Master Class Mapping
MASTER_CLASSES = {
    "person": 0,
    "obstacle": 1,
    "door": 2,
    "window": 3,
    "stair": 4,
    "puddle": 5,
    "pothole": 6,
    "car": 7,
    "bicycle": 8,
    "zebra_cross": 9
}

def create_structure():
    """Creates the standard YOLOv8 directory structure."""
    for split in ["train", "val", "test"]:
        (OUTPUT_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
        (OUTPUT_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

def normalize_bbox(size, box):
    """Normalizes bounding box coordinates for YOLO format."""
    dw = 1.0 / size[0]
    dh = 1.0 / size[1]
    x = (box[0] + box[1]) / 2.0
    y = (box[2] + box[3]) / 2.0
    w = box[1] - box[0]
    h = box[3] - box[2]
    return (x * dw, y * dh, w * dw, h * dh)

def convert_xml_to_yolo(xml_path, img_width, img_height, class_mapping):
    """Converts a single XML (Pascal VOC) file to YOLO lines."""
    tree = ET.parse(xml_path)
    root = tree.getroot()
    yolo_lines = []
    
    for obj in root.findall("object"):
        cls_name = obj.find("name").text
        if cls_name not in class_mapping:
            continue
            
        cls_id = MASTER_CLASSES[class_mapping[cls_name]]
        xmlbox = obj.find("bndbox")
        b = (float(xmlbox.find("xmin").text), float(xmlbox.find("xmax").text),
             float(xmlbox.find("ymin").text), float(xmlbox.find("ymax").text))
        bb = normalize_bbox((img_width, img_height), b)
        yolo_lines.append(f"{cls_id} {' '.join([f'{a:.6f}' for a in bb])}")
    
    return yolo_lines

def process_pedestrian_detection():
    """Processes the Pedestrian_Detection dataset (XML)."""
    print("Processing Pedestrian_Detection...")
    ped_dir = DATASET_DIR / "Pedestrian_Detection" / "Train" / "Train"
    ann_dir = ped_dir / "Annotations"
    img_dir = ped_dir / "JPEGImages"
    
    # Mapping for this dataset
    mapping = {"person": "person"}
    
    files = list(ann_dir.glob("*.xml"))
    random.shuffle(files)
    
    for i, xml_file in enumerate(tqdm(files)):
        img_file = img_dir / (xml_file.stem + ".jpg")
        if not img_file.exists():
            continue
            
        # Get image size (simplified for this script, usually you'd use PIL or cv2)
        # Assuming standard size or reading from XML
        tree = ET.parse(xml_file)
        root = tree.getroot()
        size = root.find("size")
        w = int(size.find("width").text)
        h = int(size.find("height").text)
        
        yolo_lines = convert_xml_to_yolo(xml_file, w, h, mapping)
        if not yolo_lines:
            continue
            
        # Split logic
        split = "train" if i < len(files) * 0.8 else ("val" if i < len(files) * 0.9 else "test")
        
        shutil.copy(img_file, OUTPUT_DIR / "images" / split / img_file.name)
        with open(OUTPUT_DIR / "labels" / split / (xml_file.stem + ".txt"), "w") as f:
            f.write("\n".join(yolo_lines))

def process_nighttime_pedestrian():
    """Processes the Nighttime_Pedestrian_Detection dataset (JSON/COCO)."""
    print("Processing Nighttime_Pedestrian_Detection...")
    night_dir = DATASET_DIR / "Nighttime_Pedestrian_Detection"
    ann_file = night_dir / "anno" / "new_train_annotations_rgb.json"
    img_dir = night_dir / "left_rgb"
    
    with open(ann_file) as f:
        data = json.load(f)
    
    # Class mapping for COCO IDs
    mapping = {
        1: "person",  # person
        2: "person",  # rider
        3: "bicycle", # bicycle
        4: "car"      # car
    }
    
    images = {img["id"]: img for img in data["images"]}
    annotations = data["annotations"]
    
    # Group annotations by image
    img_anns = {}
    for ann in annotations:
        img_id = ann["image_id"]
        if img_id not in img_anns:
            img_anns[img_id] = []
        img_anns[img_id].append(ann)
    
    img_ids = list(img_anns.keys())
    random.shuffle(img_ids)
    
    for i, img_id in enumerate(tqdm(img_ids)):
        img_info = images[img_id]
        img_name = img_info["file_name"]
        img_file = img_dir / img_name
        
        if not img_file.exists():
            continue
            
        w, h = img_info["width"], img_info["height"]
        yolo_lines = []
        
        for ann in img_anns[img_id]:
            cat_id = ann["category_id"]
            if cat_id not in mapping:
                continue
            
            cls_id = MASTER_CLASSES[mapping[cat_id]]
            bbox = ann["bbox"] # [x, y, w, h]
            
            # Convert to [x_center, y_center, w, h] normalized
            x_center = (bbox[0] + bbox[2] / 2) / w
            y_center = (bbox[1] + bbox[3] / 2) / h
            nw = bbox[2] / w
            nh = bbox[3] / h
            
            yolo_lines.append(f"{cls_id} {x_center:.6f} {y_center:.6f} {nw:.6f} {nh:.6f}")
            
        if not yolo_lines:
            continue
            
        split = "train" if i < len(img_ids) * 0.8 else ("val" if i < len(img_ids) * 0.9 else "test")
        
        shutil.copy(img_file, OUTPUT_DIR / "images" / split / img_name)
        label_name = Path(img_name).stem + ".txt"
        with open(OUTPUT_DIR / "labels" / split / label_name, "w") as f:
            f.write("\n".join(yolo_lines))

def process_public_spaces():
    """Processes 'Obstacles in PublicSpaces' dataset (YOLO format with remapping)."""
    print("Processing Obstacles in PublicSpaces...")
    ps_dir = DATASET_DIR / "Obstacles in PublicSpaces"
    img_dir = ps_dir / "images"
    lab_dir = ps_dir / "labels"
    
    # Remapping from their 0-indexed IDs (assuming they follow _classes.txt order - 1)
    # 0: right turn -> ignore
    # 2: puddle -> 5 (puddle)
    # 4: obstacle -> 1 (obstacle)
    # 8: pothole -> 6 (pothole)
    # 9: car -> 7 (car)
    # 10: motorcycle -> 8 (bicycle)
    # 11: pedestrian -> 0 (person)
    # 15: door -> 2 (door)
    # 19: stair -> 4 (stair)
    # ... and so on.
    
    remap = {
        2: 5, 3: 1, 4: 1, 5: 6, 6: 1, 7: 1, 8: 6, 9: 7, 10: 8, 
        11: 0, 12: 1, 13: 1, 14: 1, 15: 2, 16: 1, 17: 1, 18: 5, 
        19: 4, 20: 1, 21: 9
    }
    
    files = list(img_dir.glob("*.jpg"))
    random.shuffle(files)
    
    for i, img_file in enumerate(tqdm(files)):
        lab_file = lab_dir / (img_file.stem + ".txt")
        if not lab_file.exists():
            continue
            
        yolo_lines = []
        with open(lab_file) as f:
            for line in f:
                parts = line.strip().split()
                if not parts: continue
                old_id = int(parts[0])
                if old_id in remap:
                    new_id = remap[old_id]
                    yolo_lines.append(f"{new_id} {' '.join(parts[1:])}")
        
        if not yolo_lines:
            continue
            
        split = "train" if i < len(files) * 0.8 else ("val" if i < len(files) * 0.9 else "test")
        shutil.copy(img_file, OUTPUT_DIR / "images" / split / img_file.name)
        with open(OUTPUT_DIR / "labels" / split / lab_file.name, "w") as f:
            f.write("\n".join(yolo_lines))

def process_door_stairs():
    """Processes 'Door, Windows and Stairs Dataset'."""
    print("Processing Door, Windows and Stairs...")
    ds_dir = DATASET_DIR / "Door, Windows and Stairs Dataset (Annotated)"
    img_dir = ds_dir / "images"
    # Labels are in the same directory as images
    
    remap = {0: 2, 1: 3, 2: 4} # door -> 2, window -> 3, stair -> 4
    
    files = list(img_dir.glob("*.jpg"))
    random.shuffle(files)
    
    for i, img_file in enumerate(tqdm(files)):
        lab_file = img_file.with_suffix(".txt")
        if not lab_file.exists():
            continue
            
        yolo_lines = []
        with open(lab_file) as f:
            for line in f:
                parts = line.strip().split()
                if not parts: continue
                old_id = int(parts[0])
                if old_id in remap:
                    new_id = remap[old_id]
                    yolo_lines.append(f"{new_id} {' '.join(parts[1:])}")
                    
        if not yolo_lines:
            continue
            
        split = "train" if i < len(files) * 0.8 else ("val" if i < len(files) * 0.9 else "test")
        shutil.copy(img_file, OUTPUT_DIR / "images" / split / img_file.name)
        with open(OUTPUT_DIR / "labels" / split / lab_file.name, "w") as f:
            f.write("\n".join(yolo_lines))

def process_indoor_obstacle():
    """Processes 'Indoor_Obstacle_Avoidance'."""
    print("Processing Indoor_Obstacle_Avoidance...")
    io_dir = DATASET_DIR / "Indoor_Obstacle_Avoidance"
    img_dir = io_dir / "images"
    lab_dir = io_dir / "labels"
    
    # Assuming class 0 is obstacle
    remap = {0: 1}
    
    files = list(img_dir.glob("*.jpg"))
    random.shuffle(files)
    
    for i, img_file in enumerate(tqdm(files)):
        lab_file = lab_dir / (img_file.stem + ".txt")
        if not lab_file.exists():
            continue
            
        yolo_lines = []
        with open(lab_file) as f:
            for line in f:
                parts = line.strip().split()
                if not parts: continue
                old_id = int(parts[0])
                if old_id in remap:
                    new_id = remap[old_id]
                    yolo_lines.append(f"{new_id} {' '.join(parts[1:])}")
        
        if not yolo_lines:
            continue
            
        split = "train" if i < len(files) * 0.8 else ("val" if i < len(files) * 0.9 else "test")
        shutil.copy(img_file, OUTPUT_DIR / "images" / split / img_file.name)
        with open(OUTPUT_DIR / "labels" / split / lab_file.name, "w") as f:
            f.write("\n".join(yolo_lines))

def process_crowd_detection():
    """Processes 'Crowd_Detection'."""
    print("Processing Crowd_Detection...")
    cd_dir = DATASET_DIR / "Crowd_Detection" / "Crowd_detection.v1-2025-10-19-12-58pm.yolov8"
    
    for split in ["train", "valid", "test"]:
        target_split = "val" if split == "valid" else split
        curr_img_dir = cd_dir / split / "images"
        curr_lab_dir = cd_dir / split / "labels"
        
        files = list(curr_img_dir.glob("*.jpg"))
        for img_file in tqdm(files, desc=f"Crowd {split}"):
            lab_file = curr_lab_dir / (img_file.stem + ".txt")
            if not lab_file.exists():
                continue
            
            # Map class 0 (crowd) to 0 (person)
            yolo_lines = []
            with open(lab_file) as f:
                for line in f:
                    parts = line.strip().split()
                    if not parts: continue
                    yolo_lines.append(f"0 {' '.join(parts[1:])}")
            
            shutil.copy(img_file, OUTPUT_DIR / "images" / target_split / img_file.name)
            with open(OUTPUT_DIR / "labels" / target_split / lab_file.name, "w") as f:
                f.write("\n".join(yolo_lines))

if __name__ == "__main__":
    create_structure()
    process_pedestrian_detection()
    process_nighttime_pedestrian()
    process_public_spaces()
    process_door_stairs()
    process_indoor_obstacle()
    process_crowd_detection()
    
    print("\nNormalization Complete!")
    print(f"Dataset saved to: {OUTPUT_DIR}")
