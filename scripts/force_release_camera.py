import cv2
import time

def release_camera():
    print("Attempting to force-release camera indices 0 and 1...")
    for i in range(2):
        cap = cv2.VideoCapture(i)
        if cap.isOpened():
            cap.release()
            print(f"Released camera {i}")
        else:
            print(f"Camera {i} was not open or could not be accessed.")
    print("Done.")

if __name__ == "__main__":
    release_camera()
