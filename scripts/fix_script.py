"""
fix_script.py — patches prepare_colab_dataset.py in-place.
Run: python scripts/fix_script.py
"""
import os
from pathlib import Path

TARGET = Path(__file__).resolve().parent / "prepare_colab_dataset.py"

NEW_CONTENT = r'''"""
prepare_colab_dataset.py  (v4 — 38-class real-world schema + WinError8 fix)
============================================================================
Run locally BEFORE the Colab notebook.

BUG FIX: Replaced Path.rglob().is_file() with os.walk().
On Windows, rglob on large dirs exhausts kernel handles -> WinError 8.

38-class schema  (your 10 custom + 28 from COCO pretrained):
  0-9   : person, obstacle, door, window, stair, puddle,
           pothole, car, bicycle, zebra_cross        <- your data
  10-15 : chair, table, couch, bed, bench, sink      <- indoor furniture
  16-21 : traffic_light, fire_hydrant, stop_sign,
           motorcycle, bus, truck                    <- road hazards
  22-27 : backpack, suitcase, umbrella, bottle,
           handbag, cup                              <- portable obstacles
  28-30 : dog, cat, cow                              <- animals (India!)
  31-32 : tv, refrigerator                           <- large appliances
  33-35 : train, sports_ball, skateboard             <- transit/rolling
  36-37 : parking_meter, traffic_cone               <- outdoor infra

The Colab notebook will also pull extra Roboflow data to BOOST
whichever of your custom classes are under-represented (door, pothole,
zebra_cross, etc.) using targeted public datasets on Roboflow Universe.

Usage:
    python scripts/prepare_colab_dataset.py
"""

import os, shutil, zipfile, collections
from pathlib import Path

try:
    import yaml as _yaml
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pyyaml", "-q"])
    import yaml as _yaml

# ── CONFIG ───────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).resolve().parent.parent / "dataset"
BALANCED    = BASE_DIR / "balanced_training"
DOOR_STAIRS = BASE_DIR / "Door, Windows and Stairs Dataset (Annotated)"
OUTPUT_ZIP  = Path(__file__).resolve().parent.parent / "balanced_training.zip"

# ── 38-class schema ──────────────────────────────────────────────────
CLASS_NAMES = {
    0:  "person",        1:  "obstacle",      2:  "door",
    3:  "window",        4:  "stair",         5:  "puddle",
    6:  "pothole",       7:  "car",           8:  "bicycle",
    9:  "zebra_cross",
    10: "chair",         11: "table",         12: "couch",
    13: "bed",           14: "bench",         15: "sink",
    16: "traffic_light", 17: "fire_hydrant",  18: "stop_sign",
    19: "motorcycle",    20: "bus",           21: "truck",
    22: "backpack",      23: "suitcase",      24: "umbrella",
    25: "bottle",        26: "handbag",       27: "cup",
    28: "dog",           29: "cat",           30: "cow",
    31: "tv",            32: "refrigerator",
    33: "train",         34: "sports_ball",   35: "skateboard",
    36: "parking_meter", 37: "traffic_cone",
}

DOOR_STAIRS_REMAP = {"0": 2, "1": 3, "2": 4}
IMG_EXTS  = {".jpg", ".jpeg", ".png", ".bmp"}
KEEP_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".txt", ".yaml", ".yml"}


def count_classes(label_dir):
    counts = collections.Counter()
    if not label_dir.exists():
        return counts
    for fname in os.listdir(str(label_dir)):
        if not fname.endswith(".txt"):
            continue
        try:
            for line in (label_dir / fname).read_text(errors="ignore").splitlines():
                p = line.strip().split()
                if p:
                    counts[int(p[0])] += 1
        except Exception as e:
        print(f'Error: {e}')
            pass
    return counts


def print_dist(counts, title=""):
    total = sum(counts.values())
    print(f"\n{'='*62}\n  {title}  —  {total:,} annotations\n{'='*62}")
    for cid in sorted(counts):
        name = CLASS_NAMES.get(cid, f"cls_{cid}")
        pct  = 100 * counts[cid] / total if total else 0
        bar  = "█" * int(pct / 3)
        flag = "  ⚠️ LOW" if pct < 3 else ""
        print(f"  [{cid:2d}] {name:<16}: {counts[cid]:5,}  ({pct:5.1f}%) {bar}{flag}")


# ── Step 0: Clean stray .txt from images/ dirs ───────────────────────
print("\n🧹 Cleaning stray .txt from images/ ...")
cleaned = 0
for split in ("train", "val", "test"):
    d = BALANCED / "images" / split
    if not d.exists():
        continue
    for f in os.listdir(str(d)):
        if f.endswith(".txt"):
            try:
                os.remove(str(d / f))
                cleaned += 1
            except Exception as e:
        print(f'Error: {e}')
                pass
print(f"   Removed {cleaned} stray files.")


# ── Step 1: Audit ────────────────────────────────────────────────────
print("\n📂 Auditing balanced_training ...")
for split in ("train", "val", "test"):
    img_d = BALANCED / "images" / split
    lbl_d = BALANCED / "labels" / split
    n_i = len([f for f in os.listdir(str(img_d)) if Path(f).suffix.lower() in IMG_EXTS]) if img_d.exists() else 0
    n_l = len([f for f in os.listdir(str(lbl_d)) if f.endswith(".txt")]) if lbl_d.exists() else 0
    print(f"  {split:6s}: {n_i:5d} images, {n_l:5d} labels")

print_dist(count_classes(BALANCED / "labels" / "train"), "BEFORE merge")


# ── Step 2: Merge Door/Windows/Stairs ────────────────────────────────
if DOOR_STAIRS.exists():
    print("\n🔀 Merging Door/Windows/Stairs ...")
    dst_img = BALANCED / "images" / "train"
    dst_lbl = BALANCED / "labels" / "train"
    dst_img.mkdir(parents=True, exist_ok=True)
    dst_lbl.mkdir(parents=True, exist_ok=True)
    added = skipped = 0
    for root, _, files in os.walk(str(DOOR_STAIRS)):
        rp = Path(root)
        for fname in files:
            if Path(fname).suffix.lower() not in IMG_EXTS:
                continue
            ip = rp / fname
            lp = ip.with_suffix(".txt")
            if not lp.exists():
                skipped += 1
                continue
            try:
                content = lp.read_text(errors="ignore").strip()
            except Exception as e:
        print(f'Error: {e}')
                skipped += 1
                continue
            if not content:
                skipped += 1
                continue
            lines, ok = [], True
            for line in content.splitlines():
                p = line.strip().split()
                if len(p) < 5:
                    continue
                nc = DOOR_STAIRS_REMAP.get(p[0])
                if nc is None:
                    ok = False
                    break
                lines.append(f"{nc} " + " ".join(p[1:]))
            if not ok or not lines:
                skipped += 1
                continue
            oi = dst_img / f"dws_{ip.stem}{ip.suffix}"
            ol = dst_lbl / f"dws_{ip.stem}.txt"
            if not oi.exists():
                shutil.copy2(str(ip), str(oi))
                ol.write_text("\n".join(lines))
                added += 1
    print(f"  Added: {added}  |  Skipped: {skipped}")
    print_dist(count_classes(BALANCED / "labels" / "train"), "AFTER merge")
else:
    print(f"\n⚠️  Not found: {DOOR_STAIRS}")


# ── Step 3: Write 38-class YAML ──────────────────────────────────────
yaml_path = BALANCED / "balanced_data.yaml"
with open(str(yaml_path), "w") as f:
    _yaml.dump({
        "path":  str(BALANCED).replace("\\", "/"),
        "train": "images/train",
        "val":   "images/val",
        "test":  "images/test",
        "nc":    len(CLASS_NAMES),
        "names": CLASS_NAMES,
    }, f, default_flow_style=False)
print(f"\n✅ balanced_data.yaml → {len(CLASS_NAMES)} classes")
for cid, name in CLASS_NAMES.items():
    src = "your data" if cid < 10 else "COCO pretrained"
    print(f"  [{cid:2d}] {name:<18} ← {src}")


# ── Step 4: Zip with os.walk (memory-safe, no WinError 8) ────────────
print(f"\n📦 Zipping → {OUTPUT_ZIP}")
n = 0
with zipfile.ZipFile(str(OUTPUT_ZIP), "w", zipfile.ZIP_DEFLATED, compresslevel=1) as zf:
    for root, _, files in os.walk(str(BALANCED)):   # os.walk NOT rglob
        rp = Path(root)
        in_img = "images" in rp.parts
        for fname in files:
            suf = Path(fname).suffix.lower()
            if suf not in KEEP_EXTS:
                continue
            if in_img and suf == ".txt":
                continue   # never zip labels inside images/
            fp = rp / fname
            try:
                zf.write(str(fp), str(fp.relative_to(BALANCED.parent)))
                n += 1
            except Exception as e:
                print(f"  Skipped {fname}: {e}")

mb = OUTPUT_ZIP.stat().st_size / 1e6
print(f"\n✅ Done! {OUTPUT_ZIP}\n   {mb:.1f} MB  |  {n:,} files")
print("\n📋 NEXT STEPS:")
print("  1. Upload balanced_training.zip → Google Drive")
print("  2. Get free Roboflow key at roboflow.com")
print("  3. Open vision_yolov8s_training.ipynb in Colab (T4 GPU)")
print("  4. Fill DRIVE_ZIP_PATH + ROBOFLOW_API_KEY in Cell 2 → Run All")
'''

TARGET.write_text(NEW_CONTENT)
print(f"✅ Wrote {len(NEW_CONTENT.splitlines())} lines to {TARGET}")
print("   Has rglob:", "rglob" in NEW_CONTENT)
print("   Has os.walk:", "os.walk" in NEW_CONTENT)
print("   Classes:", NEW_CONTENT.count('"person"'))
