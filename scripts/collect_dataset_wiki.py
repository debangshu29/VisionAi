import os
import time
import requests
from pathlib import Path

DATASET_ROOT = Path(__file__).resolve().parent.parent / 'dataset/edge_cases'

CATEGORIES = {
    'low_light': 'night street dark alley',
    'crowded_paths': 'crowded pedestrian street walking',
    'glass_reflective': 'glass building door reflection',
    'stairs_curb': 'steep concrete stairs',
    'cluttered_indoor': 'cluttered messy room indoor'
}

IMAGES_PER_CATEGORY = 5

def download_image(url, filepath):
    try:
        response = requests.get(url, timeout=10, headers={'User-Agent': 'VisionDatasetBot/1.0'})
        response.raise_for_status()
        with open(filepath, 'wb') as f:
            f.write(response.content)
        return True
    except Exception as e:
        print(f"Failed to download {url}: {e}")
        return False

def search_wikimedia(query, limit=10):
    url = "https://commons.wikimedia.org/w/api.php"
    params = {
        "action": "query",
        "format": "json",
        "generator": "search",
        "gsrsearch": f"filetype:bitmap {query}",
        "gsrlimit": limit,
        "prop": "imageinfo",
        "iiprop": "url"
    }
    try:
        resp = requests.get(url, params=params, headers={'User-Agent': 'VisionDatasetBot/1.0'})
        data = resp.json()
        pages = data.get("query", {}).get("pages", {})
        urls = []
        for page_id, page_info in pages.items():
            image_info = page_info.get("imageinfo", [])
            if image_info:
                urls.append(image_info[0].get("url"))
        return urls
    except Exception as e:
        print(f"Wikimedia search failed for {query}: {e}")
        return []

def collect():
    DATASET_ROOT.mkdir(parents=True, exist_ok=True)
    
    for category, query in CATEGORIES.items():
        print(f"\nCollecting '{category}' from Wikimedia...")
        category_dir = DATASET_ROOT / category
        category_dir.mkdir(exist_ok=True)
        
        urls = search_wikimedia(query, limit=IMAGES_PER_CATEGORY * 3)
        count = 0
        for i, url in enumerate(urls):
            if count >= IMAGES_PER_CATEGORY:
                break
                
            if not url:
                continue
            
            ext = '.jpg'
            if '.png' in url.lower(): ext = '.png'
            elif '.jpeg' in url.lower(): ext = '.jpeg'
            
            filepath = category_dir / f"{category}_{count+1:03d}{ext}"
            
            print(f"[{count+1}/{IMAGES_PER_CATEGORY}] Downloading {url[:50]}...")
            if download_image(url, filepath):
                count += 1
            
            time.sleep(0.5)

if __name__ == '__main__':
    collect()
    print("\nCollection finished!")
