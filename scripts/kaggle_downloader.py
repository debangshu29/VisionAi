import sys
import io
import urllib.request
import urllib.parse
import json
import zipfile
import os
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

TOKEN = "KGAT_ef932ea6fa955b0bbafcb416aee46bc2"
BASE_URL = "https://www.kaggle.com/api/v1"

def api_get(endpoint):
    req = urllib.request.Request(BASE_URL + endpoint)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"API Error {endpoint}: {e}")
        return None

def download_dataset(ref, out_path):
    print(f"Downloading {ref}...")
    req = urllib.request.Request(BASE_URL + f"/datasets/download/{ref}")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    try:
        with urllib.request.urlopen(req) as r:
            with open(out_path, 'wb') as f:
                f.write(r.read())
        return True
    except Exception as e:
        print(f"Download Error {ref}: {e}")
        return False

classes_to_find = ['bollard', 'glass_door', 'elevator', 'handrail', 'curb', 'ramp', 'speed_breaker', 'manhole', 'auto_rickshaw']
DOWNLOAD_DIR = Path("d:/django/vision/dataset/kaggle_downloads")
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

for cls in classes_to_find:
    query = urllib.parse.quote(cls + " yolo")
    data = api_get(f"/datasets/list?search={query}&sort_by=hottest")
    if not data:
        print(f"No results for {cls}")
        continue
    
    # Try to find a dataset that looks like an object detection dataset
    found = False
    for d in data[:3]:
        ref = d.get('ref')
        title = d.get('title', '').lower()
        if 'yolo' in title or 'detection' in title or 'dataset' in title:
            print(f"[{cls}] Found candidate: {ref}")
            zip_path = DOWNLOAD_DIR / f"{ref.replace('/', '__')}.zip"
            if not zip_path.exists():
                if download_dataset(ref, zip_path):
                    found = True
                    break
            else:
                print(f"Already downloaded: {zip_path}")
                found = True
                break
    
    if not found:
        print(f"[{cls}] Could not find suitable YOLO dataset.")
