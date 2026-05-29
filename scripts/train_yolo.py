from ultralytics import YOLO
import torch
import sys
from pathlib import Path

def run_balanced_training():
    print("--- Starting Balanced Vision Model Training (CPU Optimized) ---")
    
    # 1. Hardware Check
    device = "cpu" # Explicitly CPU for this session
    print(f"Running on: {device.upper()}")
    
    # 2. Paths
    base_dir = Path(__file__).resolve().parent.parent
    data_yaml = base_dir / "dataset" / "balanced_training" / "balanced_data.yaml"
    
    if not data_yaml.exists():
        print(f"Error: {data_yaml} not found!")
        sys.exit(1)
        
    # 3. Load Model
    print("Loading pretrained yolov8n.pt...")
    model = YOLO("yolov8n.pt")
    
    # 4. Train
    print("Initiating training session (30 epochs)...")
    try:
        results = model.train(
            data=str(data_yaml),
            epochs=30,      # Manageable for 844 images on CPU
            imgsz=640,
            batch=8,        # Smaller batch for CPU memory
            name="vision_balanced_v1",
            device=device,
            workers=4,
            exist_ok=True
        )
        print("\n--- Training Completed Successfully! ---")
        print(f"Final Model saved at: {results.save_dir}")
        
    except Exception as e:
        print(f"\nError during training: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    run_balanced_training()
