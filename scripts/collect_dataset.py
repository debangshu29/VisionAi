import os
from pathlib import Path
from icrawler.builtin import BingImageCrawler

DATASET_ROOT = Path(__file__).resolve().parent.parent / 'dataset' / 'edge_cases'

CATEGORIES = {
    'low_light': 'dimly lit dark street night photography',
    'crowded_paths': 'highly crowded pedestrian walkway street',
    'glass_reflective': 'reflective glass building entrance door',
    'stairs_curb': 'steep concrete stairs downward perspective',
    'cluttered_indoor': 'highly cluttered messy room'
}

IMAGES_PER_CATEGORY = 10

def collect():
    DATASET_ROOT.mkdir(parents=True, exist_ok=True)
    
    for category, query in CATEGORIES.items():
        print(f"\nCollecting '{category}'...")
        category_dir = DATASET_ROOT / category
        category_dir.mkdir(exist_ok=True)
        
        # Configure the crawler for this category
        crawler = BingImageCrawler(
            feeder_threads=1,
            parser_threads=1,
            downloader_threads=4,
            storage={'root_dir': str(category_dir)}
        )
        
        # Crawl
        print(f"Searching for: {query}")
        crawler.crawl(keyword=query, filters=None, offset=0, max_num=IMAGES_PER_CATEGORY)

if __name__ == '__main__':
    collect()
    print("\nCollection finished!")
