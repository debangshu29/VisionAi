import sys
import io
import urllib.request
import urllib.parse
import json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

TOKEN = "KGAT_ef932ea6fa955b0bbafcb416aee46bc2"
BASE_URL = "https://www.kaggle.com/api/v1"

def search_kaggle(query):
    req = urllib.request.Request(BASE_URL + f"/datasets/list?search={urllib.parse.quote(query)}&sort_by=hottest")
    req.add_header("Authorization", f"Bearer {TOKEN}")
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return []

classes = ['glass door', 'elevator detection', 'handrail', 'curb detection']
for cls in classes:
    data = search_kaggle(cls)
    print(f"\n--- {cls} ---")
    for d in data[:3]:
        print(f" {d.get('ref')} - {d.get('title')}")
