import sys
import io
import urllib.request
import urllib.parse
import json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

TOKEN = "KGAT_ef932ea6fa955b0bbafcb416aee46bc2"
url = "https://www.kaggle.com/api/v1/datasets/list?search=bollard"
req = urllib.request.Request(url)
# Basic auth expects username:key, but for PAT we might use Bearer
req.add_header("Authorization", f"Bearer {TOKEN}")

try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        print(f"Success! Found {len(data)} datasets")
        for d in data[:3]:
            print(f" - {d.get('ref')}")
except urllib.error.HTTPError as e:
    print(f"HTTPError: {e.code} - {e.reason}")
    if e.code == 401:
        print("Token might not be supported as Bearer. Trying Basic Auth with dummy username...")
        import base64
        auth = base64.b64encode(f"token:{TOKEN}".encode()).decode()
        req.add_header("Authorization", f"Basic {auth}")
        try:
            with urllib.request.urlopen(req) as r2:
                data2 = json.loads(r2.read().decode())
                print(f"Basic Auth Success! Found {len(data2)} datasets")
        except Exception as e2:
            print(f"Basic Auth Failed: {e2}")
except Exception as e:
    print(f"Error: {e}")
