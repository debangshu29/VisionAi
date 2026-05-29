import sys
import io
import urllib.request
import urllib.parse
import json
import ssl

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

API_KEY = "KMANRmSg9FInvYHZS1Sr"
classes_to_find = ['bollard', 'glass_door', 'elevator', 'handrail', 'curb', 'ramp', 'speed_breaker', 'manhole', 'auto_rickshaw']

for cls in classes_to_find:
    query = urllib.parse.quote(cls.replace('_', ' '))
    url = f"https://api.roboflow.com/search?query={query}&limit=5&api_key={API_KEY}"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, context=ctx) as response:
            data = json.loads(response.read().decode())
            print(f"--- {cls} ---")
            # Note: the roboflow search API usually returns workspace/project lists, but sometimes it is unstable
            # Lets just print the keys returned to be safe
            print(f"Keys: {list(data.keys())}")
    except Exception as e:
        print(f"--- {cls} --- Failed: {e}")
