import os
import sys
import django
import time

# Setup Django
sys.path.append(str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "vision.settings")
try:
    django.setup()
except Exception as e:
        print(f'Error: {e}')
    pass

from main.detector import get_camera_processor

def restart():
    cp = get_camera_processor()
    print("Stopping Camera Processor...")
    cp.stop()
    time.sleep(1)
    print("Starting Camera Processor with new model and policy...")
    cp.start()
    print("Done. Please check the camera feed.")

if __name__ == "__main__":
    restart()
