"""
Convert the local "Obstacles in PublicSpaces" annotation file to YOLO format.

The source dataset uses one `_annotations.txt` file with entries like:
    image.jpg xmin,ymin,xmax,ymax,class_id,...

This converter keeps only navigation-specific classes and skips common COCO
classes that should come from the pretrained context detector.
"""

from __future__ import annotations

import argparse
import random
import shutil
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import yaml


NAV_CLASSES = [
    "obstacle",
    "pothole",
    "puddle",
    "open_drain",
    "traffic_cone",
    "barrier",
    "pole",
    "bollard",
    "trash_bin",
    "door",
    "glass_door",
    "window",
    "elevator",
    "handrail",
    "stair",
    "curb",
    "ramp",
    "zebra_cross",
    "speed_breaker",
    "manhole",
    "auto_rickshaw",
]

CLASS_TO_ID = {name: idx for idx, name in enumerate(NAV_CLASSES)}

# Source IDs come from `_classes.txt` in Obstacles in PublicSpaces.
SOURCE_TO_NAV = {
    2: "puddle",
    3: "obstacle",  # street vendor can block the walking path
    4: "obstacle",
    5: "obstacle",  # bad road
    6: "trash_bin",
    8: "pothole",
    12: "barrier",  # fence
    13: "barrier",  # gate barrier
    14: "barrier",  # roadblock
    15: "door",
    16: "obstacle",  # tree; kept as generic walking obstacle
    18: "open_drain",
    19: "stair",
    20: "pole",
    21: "zebra_cross",
}


def yolo_box(width: int, height: int, xmin: float, ymin: float, xmax: float, ymax: float) -> str | None:
    xmin = max(0.0, min(float(width - 1), xmin))
    xmax = max(0.0, min(float(width - 1), xmax))
    ymin = max(0.0, min(float(height - 1), ymin))
    ymax = max(0.0, min(float(height - 1), ymax))
    if xmax <= xmin or ymax <= ymin:
        return None
    x_center = ((xmin + xmax) / 2.0) / width
    y_center = ((ymin + ymax) / 2.0) / height
    box_width = (xmax - xmin) / width
    box_height = (ymax - ymin) / height
    return f"{x_center:.6f} {y_center:.6f} {box_width:.6f} {box_height:.6f}"


def split_name(index: int, total: int) -> str:
    ratio = index / max(total, 1)
    if ratio < 0.8:
        return "train"
    if ratio < 0.9:
        return "val"
    return "test"


def convert(source: Path, output: Path, seed: int) -> None:
    annotations_path = source / "_annotations.txt"
    if not annotations_path.exists():
        raise SystemExit(f"Missing annotation file: {annotations_path}")

    output.mkdir(parents=True, exist_ok=True)
    for split in ("train", "val", "test"):
        (output / "images" / split).mkdir(parents=True, exist_ok=True)
        (output / "labels" / split).mkdir(parents=True, exist_ok=True)

    grouped: dict[str, list[tuple[int, list[float]]]] = defaultdict(list)
    skipped_classes = Counter()
    malformed = 0

    for raw_line in annotations_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        parts = raw_line.strip().split()
        if len(parts) < 2:
            continue
        image_name = parts[0]
        for raw_box in parts[1:]:
            values = raw_box.split(",")
            if len(values) < 5:
                malformed += 1
                continue
            try:
                xmin, ymin, xmax, ymax = [float(value) for value in values[:4]]
                source_class = int(float(values[4]))
            except ValueError:
                malformed += 1
                continue
            nav_name = SOURCE_TO_NAV.get(source_class)
            if nav_name is None:
                skipped_classes[source_class] += 1
                continue
            grouped[image_name].append((CLASS_TO_ID[nav_name], [xmin, ymin, xmax, ymax]))

    image_names = sorted(grouped)
    random.Random(seed).shuffle(image_names)
    class_counts = Counter()
    copied = 0
    skipped_images = 0

    for index, image_name in enumerate(image_names):
        image_path = source / image_name
        if not image_path.exists():
            skipped_images += 1
            continue
        frame = cv2.imread(str(image_path))
        if frame is None:
            skipped_images += 1
            continue
        height, width = frame.shape[:2]
        label_lines = []
        for class_id, box in grouped[image_name]:
            box_text = yolo_box(width, height, *box)
            if box_text is None:
                continue
            label_lines.append(f"{class_id} {box_text}")
            class_counts[class_id] += 1
        if not label_lines:
            continue

        split = split_name(index, len(image_names))
        shutil.copy2(image_path, output / "images" / split / image_path.name)
        (output / "labels" / split / f"{image_path.stem}.txt").write_text(
            "\n".join(label_lines),
            encoding="utf-8",
        )
        copied += 1

    yaml_path = output / "navigation_public_spaces.yaml"
    yaml_path.write_text(
        yaml.safe_dump(
            {
                "path": str(output.resolve()).replace("\\", "/"),
                "train": "images/train",
                "val": "images/val",
                "test": "images/test",
                "nc": len(NAV_CLASSES),
                "names": {idx: name for idx, name in enumerate(NAV_CLASSES)},
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    print(f"Converted images: {copied:,}")
    print(f"Skipped images: {skipped_images:,}")
    print(f"Malformed boxes: {malformed:,}")
    print(f"Output: {output.resolve()}")
    print(f"YAML: {yaml_path.resolve()}")
    print("\nClass counts:")
    for class_id, count in sorted(class_counts.items()):
        print(f"  {class_id:2d} {NAV_CLASSES[class_id]:14s} {count:,}")
    if skipped_classes:
        print("\nSkipped source classes:")
        for class_id, count in sorted(skipped_classes.items()):
            print(f"  source {class_id}: {count:,}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        default="dataset/Obstacles in PublicSpaces",
        help="Source folder containing _annotations.txt",
    )
    parser.add_argument(
        "--output",
        default="dataset/converted/navigation_public_spaces",
        help="Output YOLO dataset folder",
    )
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    convert(Path(args.source), Path(args.output), args.seed)


if __name__ == "__main__":
    main()
