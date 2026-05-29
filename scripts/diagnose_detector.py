import os
import sys
import django
from pathlib import Path

# Setup Django
sys.path.append(str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "vision.settings")
try:
    django.setup()
except Exception as e:
        print(f'Error: {e}')
    pass

from main.detector import get_camera_processor

def diagnose():
    cp = get_camera_processor()
    print(f"--- Camera Processor Diagnosis ---")
    print(f"Model Path: {cp.model_path}")
    print(f"Running: {cp.running}")
    print(f"Latest Error: {cp.latest_error}")
    
    if cp.latest_guidance:
        print(f"Latest Command: {cp.latest_guidance.get('command')}")
        print(f"Latest Message: {cp.latest_guidance.get('spoken_message')}")
        print(f"Detection Count: {len(cp.latest_detections)}")
        for det in cp.latest_detections:
             print(f" - {det.get('class_name')} (Conf: {det.get('conf')})")

if __name__ == "__main__":
    diagnose()
