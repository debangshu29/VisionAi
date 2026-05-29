# Dataset Strategy For Assistive Navigation

This project should not use one mixed dataset for everything. The final prototype
should use a two-layer perception stack:

1. A pretrained COCO/open-vocabulary object detector for common objects.
2. A custom navigation model for mobility hazards that COCO does not cover well.
3. A lightweight segmentation model for walkable-area understanding.

## Current Local Dataset Verdict

The existing data is useful, but it is not yet a clean final training dataset.

| Folder | Usefulness | Verdict |
| --- | --- | --- |
| `balanced_training` | Good starting point | Labels are mostly only the first 10 classes. The YAML advertises 38 classes, but the active labels do not truly cover all 38. |
| `combined_training` | Risky | Extremely person-heavy. Useful for crowd/person recall only if heavily downsampled. Do not train the main custom model directly on it. |
| `Crowd_Detection` | Narrow | Person-only. Useful as a small supplement, not as the core dataset. |
| `Door, Windows and Stairs Dataset (Annotated)` | Useful | Good for door/window/stair, but class mapping and balance must be checked. |
| `Indoor_Obstacle_Avoidance` | Needs conversion | Appears to contain polygon/segmentation-like labels. Do not merge blindly as YOLO boxes. |
| `low_light_street` | Useful supplement | COCO-style labels. Good for low-light robustness and common objects, but class IDs must be remapped before merging. |
| `Nighttime_Pedestrian_Detection` | Useful supplement | Good for night/person/vehicle conditions, but narrow. |
| `Obstacles in PublicSpaces` / `public_obs` | Useful | Good for puddle, pothole, drain, obstacle, pole, stair, zebra crossing, etc. Needs careful remap. |
| `transparent_obs` | Useful but tiny | Valuable edge-case data for glass/transparent hazards, but too small to train alone. |
| `edge_cases`, `low_light` | Raw/weak | Useful for testing/augmentation only unless labels are added. |

## Keep These In The Pretrained Detector

These classes already exist in COCO-style pretrained models and should not be
the main burden of the custom model:

- `person`
- `bicycle`
- `motorcycle`
- `car`
- `bus`
- `truck`
- `train`
- `dog`
- `cow`
- `bench`
- `fire_hydrant`
- `parking_meter`
- `chair`
- `table`
- `couch`
- `bed`
- `sink`
- `toilet`
- `bottle`
- `cup`
- `cell_phone`
- `backpack`
- `handbag`
- `suitcase`
- `umbrella`

## Train A Custom Detection Model For These

These are safety/navigation-specific and are not reliably handled by COCO:

- `auto_rickshaw`
- `obstacle`
- `pothole`
- `puddle`
- `speed_breaker`
- `open_drain`
- `manhole`
- `traffic_cone`
- `barrier`
- `pole`
- `bollard`
- `trash_bin`
- `door`
- `glass_door`
- `window`
- `elevator`
- `handrail`

`stair`, `curb`, and `ramp` can be detected with boxes, but they are better as
segmentation regions for walking guidance.

## Train A Segmentation Model For These

These need pixel-level regions, not only bounding boxes:

- `sidewalk`
- `road`
- `crosswalk`
- `zebra_cross`
- `curb`
- `stair_area`
- `ramp`

Optional but useful segmentation classes:

- `doorway`
- `floor`
- `wall`
- `glass_region`
- `drivable_area`
- `non_walkable_area`

## Best External Sources

Use official/licensed downloads first. Do not scrape random images for a paper
unless the license is clear.

| Source | Best For | Notes |
| --- | --- | --- |
| Indian Driving Dataset, IDD | India-specific road scenes, unstructured traffic, road users, road/sidewalk context | Best match for India. IDD Lite is small; full detection/segmentation sets require account/license and are large. |
| Mapillary Vistas | Road, sidewalk, curb, crosswalk/zebra, pole, barrier, traffic objects | High-quality segmentation. Very large and non-commercial license. |
| BDD100K | Road/drivable-area/sidewalk/lane-style segmentation and driving scenes | Good baseline, less India-specific. |
| RDD2022 / Road Damage datasets | Pothole and road damage classes | Useful for pothole/manhole/road surface hazard supplements. |
| Roboflow Universe datasets | Small missing classes like bollard, open drain, speed breaker, trash bin, glass door | Must check license per dataset before using in publication. |

## Recommended Training Plan

1. Build `navigation_detection_v1` with only custom detection classes.
2. Build `walkable_segmentation_v1` with sidewalk/road/crosswalk/curb/stair/ramp.
3. Keep pretrained COCO as a parallel context detector.
4. Fuse outputs with your own risk algorithm: center-path occupancy, distance estimate, temporal stability, hazard priority, and uncertainty fallback.
5. Evaluate with separate acceptance criteria: latency, hazard recall, false negatives, false alarms, low-light recall, and route/walking safety cases.

## Brutal Honest Status

The current data can support a demo and early paper prototype, but it is not yet
enough for a strong final model claim. The biggest weakness is not model choice;
it is label consistency. Before training again, the labels must be remapped,
balanced, split correctly, and verified visually.
