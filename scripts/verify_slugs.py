import sys, io, requests
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

API_KEY = 'KMANRmSg9FInvYHZS1Sr'

# Known real slugs from web search + common Roboflow Universe patterns
candidates = [
    # Traffic cone
    ('trafficconedetect', 'trafficconedetection'),
    ('useful-cursos', 'traffic-cone-4sser'),
    ('traffciccone', 'traffic-cones'),
    ('robotica-zp5zb', 'traffic-cones-fyb4f'),
    # Pothole
    ('luc-yc6c5', 'pothole-detection-qrgks'),
    ('pavannn', 'pothole-detection-ceyog'),
    ('alex-ianchici', 'pothole-detection-a2cdd'),
    ('potholes-xpg9t', 'potholes-edb0s'),
    # Manhole
    ('manhole-detection', 'manhole-detection'),
    ('visiontechopen', 'manhole-open-detection'),
    ('test-vr4nt', 'manhole-zowmb'),
    ('roaddefect', 'road-defect-manhole'),
    # Speed bump
    ('speed-bump-jybtw', 'speed-bump'),
    ('speedbump', 'speed-bump-detection'),
    ('road-hazard', 'speed-breaker-detection'),
    ('srikanth-mvk', 'speed-bump-detection-c8rhm'),
    # Bollard
    ('bollard-detection', 'bollard-detection'),
    ('chacaltana', 'bollard-pjlhc'),
    ('ricky-mf', 'bollard-detection-wkjua'),
    # Auto rickshaw
    ('indian-vehicles', 'auto-rickshaw'),
    ('vehicle-india', 'auto-rickshaw-detection'),
    ('ayush-singh-yw4dc', 'auto-and-rickshaw'),
    # Trash bin
    ('waste-detection-f3bke', 'waste-and-recycling'),
    ('garbage-qfqbm', 'garbage-bins'),
    ('dustbin-detection', 'dustbin'),
    # Open drain
    ('road-hazard', 'drain-detection'),
    ('urbaninfra', 'open-drain-detection'),
    # Curb
    ('sidewalk-detection', 'curb-detection'),
    ('curb-tzkio', 'curb'),
    # Handrail
    ('handrail', 'handrail-detection'),
    ('stairs-rails', 'handrail'),
    # Elevator
    ('lift-detection', 'elevator'),
    ('elevator-bfxqg', 'elevator-detection'),
]

print("Verifying Roboflow Universe project slugs...\n")
valid = []
for ws, proj in candidates:
    url = f'https://api.roboflow.com/{ws}/{proj}'
    try:
        r = requests.get(url, params={'api_key': API_KEY}, timeout=10)
        if r.status_code == 200:
            d = r.json()
            p = d.get('project', {})
            name = p.get('name', proj)
            images = p.get('images', '?')
            ptype = p.get('type', '?')
            versions = p.get('versions', 0)
            classes = p.get('classes', {})
            if isinstance(classes, dict):
                class_list = list(classes.keys())[:6]
            else:
                class_list = []
            print(f"[OK] {ws}/{proj}")
            print(f"     {name} | {images} images | {ptype} | {versions} versions")
            print(f"     Classes: {class_list}")
            valid.append((ws, proj, versions, class_list))
        else:
            print(f"[FAIL {r.status_code}] {ws}/{proj}")
    except Exception as e:
        print(f"[ERR] {ws}/{proj} => {e}")

print(f"\nTotal valid: {len(valid)}")
