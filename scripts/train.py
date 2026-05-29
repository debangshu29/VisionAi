import os
import sys
from ultralytics import YOLO

def main():
    print("Initializing YOLOv8 Nano for Custom Training...")
    
    # Load the pretrained Nano model
    model = YOLO("yolov8n.pt") 
    
    print("Starting training process...")
    # Train the model
    # We use a standard 50 epochs for fine-tuning.
    # imgsz=640 is standard for YOLOv8
    results = model.train(
        data="d:/django/vision/dataset_fresh/data.yaml",
        epochs=50,
        imgsz=640,
        batch=16,          # Adjust based on GPU VRAM
        name="vision_assist_v1",
        patience=10        # Early stopping if no improvement
    )
    
    print("\nTraining Complete!")
    print(f"Results saved to: {results.save_dir}")

if __name__ == "__main__":
    main()
