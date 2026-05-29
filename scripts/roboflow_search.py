"""
Search Roboflow Universe API for valid public datasets per class,
then try to download the best matches.
"""
import sys
import io
import requests
import json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

API_KEY = "KMANRmSg9FInvYHZS1Sr"

SEARCH_CLASSES = [
    "traffic cone",
    "bollard",
    "manhole",
    "speed bump",
    "handrail",
    "glass door",
    "elevator",
    "curb",
    "wheelchair ramp",
    "auto rickshaw",
    "pothole",
    "trash bin garbage",
    "open drain",
]

def search_universe(query, api_key, limit=5):
    """Search Roboflow Universe via their search API."""
    url = "https://api.roboflow.com/search"
    params = {
        "query": query,
        "api_key": api_key,
        "type": "project",
        "format": "json",
    }
    try:
        r = requests.get(url, params=params, timeout=20)
        if r.status_code == 200:
            results = r.json()
            return results
        else:
            print(f"  HTTP {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"  Error: {e}")
    return {}

def check_project(workspace, project, api_key):
    """Check if a project is accessible and get its versions."""
    url = f"https://api.roboflow.com/{workspace}/{project}"
    params = {"api_key": api_key}
    try:
        r = requests.get(url, params=params, timeout=15)
        if r.status_code == 200:
            data = r.json()
            versions = data.get("project", {}).get("versions", 0)
            proj_type = data.get("project", {}).get("type", "unknown")
            classes = data.get("project", {}).get("classes", {})
            return True, versions, proj_type, list(classes.keys()) if isinstance(classes, dict) else []
    except Exception:
        pass
    return False, 0, "unknown", []

print("Searching Roboflow Universe for public datasets...\n")
print("=" * 70)

for cls_query in SEARCH_CLASSES:
    print(f"\n[CLASS] {cls_query.upper()}")
    print("-" * 50)
    
    results = search_universe(cls_query, API_KEY)
    
    if not results:
        print("  No results returned from API")
        continue
    
    # Try to get project list from various response formats
    projects = []
    if isinstance(results, dict):
        if "results" in results:
            projects = results["results"]
        elif "projects" in results:
            projects = results["projects"]
        elif "datasets" in results:
            projects = results["datasets"]
        else:
            # Print raw structure to understand it
            print(f"  Raw keys: {list(results.keys())}")
            print(f"  Raw (first 500): {str(results)[:500]}")
            continue
    
    if not projects:
        print("  No projects found")
        continue
    
    count = 0
    for proj in projects[:8]:
        workspace = proj.get("owner", proj.get("workspace", ""))
        project_id = proj.get("id", proj.get("slug", ""))
        name = proj.get("name", project_id)
        images = proj.get("imageCount", proj.get("images", "?"))
        proj_type = proj.get("type", proj.get("annotation", "?"))
        
        if not workspace or not project_id:
            continue

        # Check accessibility
        ok, versions, p_type, classes = check_project(workspace, project_id, API_KEY)
        status = "[PUBLIC]" if ok else "[PRIVATE]"
        
        print(f"  {status} {workspace}/{project_id}")
        print(f"    Name: {name} | Images: {images} | Type: {proj_type} | Versions: {versions}")
        if classes:
            print(f"    Classes: {classes[:5]}")
        
        count += 1
        if count >= 3:
            break
    
    if count == 0:
        print("  All results were inaccessible or missing slugs")

print("\n" + "=" * 70)
print("Search complete. Use the [PUBLIC] entries above for downloads.")
