"""
Audit local navigation datasets without exhausting Windows file handles.

This script intentionally samples label files per dataset. It is meant to
answer: "Can this folder be used directly for training, or does it need
conversion/cleaning first?"
"""

from __future__ import annotations

import argparse
import os
from collections import Counter
from pathlib import Path


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
META_EXTS = {".xml", ".json", ".yaml", ".yml"}


def iter_files(root: Path):
    for current, _, files in os.walk(root):
        current_path = Path(current)
        for name in files:
            yield current_path / name


def looks_like_yolo(parts: list[str]) -> tuple[bool, bool, int | None]:
    if len(parts) < 5:
        return False, False, None
    try:
        class_id = int(float(parts[0]))
        values = [float(value) for value in parts[1:]]
    except ValueError:
        return False, False, None

    bbox_like = len(values) == 4 and all(-0.01 <= value <= 1.01 for value in values)
    segment_like = len(values) > 4 and len(values) % 2 == 0 and all(
        -0.01 <= value <= 1.01 for value in values
    )
    return bbox_like or segment_like, segment_like, class_id


def audit_dataset(dataset_dir: Path, max_txt: int) -> dict:
    counts = Counter()
    class_counts = Counter()
    txt_seen = 0
    yolo_txt = 0
    yolo_lines = 0
    segment_lines = 0
    invalid_lines = 0

    for path in iter_files(dataset_dir):
        suffix = path.suffix.lower()
        counts[suffix] += 1

        if suffix != ".txt" or txt_seen >= max_txt:
            continue

        txt_seen += 1
        file_has_yolo = False
        try:
            lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            invalid_lines += 1
            continue

        for line in lines:
            parts = line.strip().split()
            if not parts:
                continue
            ok, segment_like, class_id = looks_like_yolo(parts)
            if not ok or class_id is None:
                invalid_lines += 1
                continue
            file_has_yolo = True
            yolo_lines += 1
            class_counts[class_id] += 1
            if segment_like:
                segment_lines += 1

        if file_has_yolo:
            yolo_txt += 1

    image_count = sum(counts[ext] for ext in IMAGE_EXTS)
    meta_count = sum(counts[ext] for ext in META_EXTS)
    return {
        "images": image_count,
        "txt": counts[".txt"],
        "metadata": meta_count,
        "sampled_txt": txt_seen,
        "sampled_yolo_txt": yolo_txt,
        "sampled_yolo_lines": yolo_lines,
        "sampled_segment_lines": segment_lines,
        "sampled_invalid_lines": invalid_lines,
        "top_class_ids": class_counts.most_common(20),
    }


def verdict(name: str, stats: dict) -> str:
    lowered = name.lower()
    if "indoor_obstacle" in lowered:
        return "grid/mask-like labels; useful only after custom conversion, not YOLO-box ready"
    if "publicspaces" in lowered or "public_obs" in lowered:
        return "custom annotation file; useful after converting _annotations.txt to YOLO"
    if stats["sampled_yolo_lines"] == 0 and stats["metadata"] == 0:
        return "raw/images only; not directly trainable until annotated"
    if stats["sampled_segment_lines"] > stats["sampled_yolo_lines"] * 0.5:
        return "segmentation/polygon-like labels; use for segmentation or convert carefully"
    if "combined" in lowered and stats["top_class_ids"]:
        top_id, top_count = stats["top_class_ids"][0]
        if top_id == 0 and top_count > stats["sampled_yolo_lines"] * 0.75:
            return "badly imbalanced/person-dominated; do not use as the main custom dataset"
    if lowered in {"crowd_detection", "crowd_detection1", "pedestrian_detection", "pedestrian_detection1"}:
        return "person-heavy; useful only as a downsampled person/crowd supplement"
    if "low_light" in lowered:
        return "useful for low-light robustness, but remap COCO IDs before merging"
    if "door" in lowered or "indoor" in lowered:
        return "useful indoor data, but inspect/remap class IDs before merging"
    return "potentially useful after class mapping and balance checks"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="dataset", help="Dataset root folder")
    parser.add_argument("--max-txt", type=int, default=1000, help="Max txt labels sampled per folder")
    args = parser.parse_args()

    root = Path(args.root)
    if not root.exists():
        raise SystemExit(f"Dataset root not found: {root}")

    print("Navigation Dataset Audit")
    print(f"Root: {root.resolve()}")
    print(f"Max txt sampled per folder: {args.max_txt}")

    for dataset_dir in sorted((p for p in root.iterdir() if p.is_dir()), key=lambda p: p.name.lower()):
        stats = audit_dataset(dataset_dir, args.max_txt)
        print("\n" + dataset_dir.name)
        print(f"  images: {stats['images']:,}")
        print(f"  txt labels: {stats['txt']:,}")
        print(f"  xml/json/yaml metadata: {stats['metadata']:,}")
        print(
            "  sampled yolo/polygon labels: "
            f"{stats['sampled_yolo_lines']:,} lines from "
            f"{stats['sampled_yolo_txt']:,}/{stats['sampled_txt']:,} txt files"
        )
        if stats["sampled_segment_lines"]:
            print(f"  polygon/segment-like lines: {stats['sampled_segment_lines']:,}")
        if stats["sampled_invalid_lines"]:
            print(f"  invalid/non-label sampled lines: {stats['sampled_invalid_lines']:,}")
        top_ids = ", ".join(f"{cid}:{count}" for cid, count in stats["top_class_ids"])
        print(f"  top sampled class IDs: {top_ids or 'none'}")
        print(f"  verdict: {verdict(dataset_dir.name, stats)}")


if __name__ == "__main__":
    main()
