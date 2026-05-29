from ultralytics import YOLO
import sys
from pathlib import Path

def export_model(model_path, format="openvino"):
    try:
        model = YOLO(model_path)
        print(f"Exporting {model_path} to {format}...")
        path = model.export(format=format, imgsz=320, half=True)
        print(f"Exported successfully to: {path}")
    except Exception as e:
        print(f"Failed to export {model_path}: {e}")

if __name__ == "__main__":
    nav_model = str(Path(__file__).resolve().parent.parent / "runs/detect/vision_balanced_v1/weights/best.pt")
    coco_model = str(Path(__file__).resolve().parent.parent / "yolov8n.pt")
    
    export_model(nav_model)
    export_model(coco_model)
