from collections import Counter
import difflib
import os
import re
import shutil

import cv2
import numpy as np

from .depth import NeuralDepthEstimator

depth_estimator = NeuralDepthEstimator()

try:
    import mediapipe as mp
except ImportError:  # pragma: no cover - depends on local environment
    mp = None


MAX_OBJECTS_IN_RESPONSE = 12
MAX_OBJECTS_IN_CAPTION = 5


CLASS_PROFILES = {
    "obstacle": {"kind": "obstacle", "risk": 3.1},
    "person": {"kind": "pedestrian", "risk": 2.8},
    "bicycle": {"kind": "vehicle", "risk": 3.0},
    "motorcycle": {"kind": "vehicle", "risk": 3.4},
    "car": {"kind": "vehicle", "risk": 3.8},
    "bus": {"kind": "vehicle", "risk": 4.2},
    "truck": {"kind": "vehicle", "risk": 4.4},
    "train": {"kind": "vehicle", "risk": 4.8},
    "dog": {"kind": "animal", "risk": 2.6},
    "cat": {"kind": "animal", "risk": 2.0},
    "door": {"kind": "indoor landmark", "risk": 2.2},
    "glass door": {"kind": "transparent barrier", "risk": 3.6},
    "window": {"kind": "indoor landmark", "risk": 1.3},
    "stair": {"kind": "level-change hazard", "risk": 4.6},
    "escalator": {"kind": "level-change hazard", "risk": 4.2},
    "ramp": {"kind": "slope landmark", "risk": 2.2},
    "curb": {"kind": "level-change hazard", "risk": 4.0},
    "pothole": {"kind": "ground hazard", "risk": 4.0},
    "puddle": {"kind": "ground hazard", "risk": 2.8},
    "wet floor": {"kind": "slip hazard", "risk": 3.5},
    "traffic cone": {"kind": "public-space obstacle", "risk": 3.2},
    "bollard": {"kind": "public-space obstacle", "risk": 3.5},
    "pole": {"kind": "public-space obstacle", "risk": 3.7},
    "barrier": {"kind": "public-space obstacle", "risk": 3.6},
    "fire hydrant": {"kind": "public-space obstacle", "risk": 3.0},
    "chair": {"kind": "furniture", "risk": 2.5},
    "bench": {"kind": "furniture", "risk": 2.4},
    "couch": {"kind": "furniture", "risk": 2.7},
    "table": {"kind": "furniture", "risk": 3.0},
    "dining table": {"kind": "furniture", "risk": 3.0},
    "potted plant": {"kind": "furniture", "risk": 2.2},
    "backpack": {"kind": "bag", "risk": 2.1},
    "suitcase": {"kind": "bag", "risk": 2.5},
    "handbag": {"kind": "bag", "risk": 2.0},
    "umbrella": {"kind": "portable obstacle", "risk": 2.4},
    "bottle": {"kind": "small object", "risk": 1.5},
    "cell phone": {"kind": "small object", "risk": 1.2},
    "toilet": {"kind": "room landmark", "risk": 1.5},
    "sink": {"kind": "room landmark", "risk": 1.5},
    "elevator": {"kind": "building landmark", "risk": 1.2},
    "handrail": {"kind": "support landmark", "risk": 1.0},
    "traffic light": {"kind": "traffic context", "risk": 0.7},
    "stop sign": {"kind": "traffic context", "risk": 0.7},
    "signboard": {"kind": "text landmark", "risk": 0.8},
    "sidewalk": {"kind": "walkable area", "risk": 0.2},
    "road": {"kind": "traffic area", "risk": 0.4},
    "zebra cross": {"kind": "crossing area", "risk": 0.2},
    "crosswalk": {"kind": "crossing area", "risk": 0.2},
}

NON_BLOCKING_CONTEXT_CLASSES = {
    "sidewalk",
    "road",
    "zebra cross",
    "crosswalk",
    "traffic light",
    "stop sign",
    "signboard",
    "elevator",
    "handrail",
}

ZONE_LABELS = {
    "left": "left side",
    "center": "straight ahead",
    "right": "right side",
}

URGENCY_COLORS = {
    "low": "#2d7a52",
    "medium": "#bf7b1d",
    "high": "#b04831",
    "critical": "#8e2a22",
}

IRREGULAR_PLURALS = {
    "person": "people",
}


def _clean_label(label):
    return (label or "obstacle").replace("_", " ").strip()


def is_blocking_navigation_class(label):
    return _clean_label(label).lower() not in NON_BLOCKING_CONTEXT_CLASSES


def _pluralize(label, count):
    if count == 1:
        return f"1 {label}"
    plural = IRREGULAR_PLURALS.get(label, f"{label}s")
    return f"{count} {plural}"


def _format_counts(counter):
    if not counter:
        return "nothing notable"
    parts = [_pluralize(label, count) for label, count in counter.most_common(MAX_OBJECTS_IN_CAPTION)]
    return ", ".join(parts)


def _zone_for_box(x1, x2, frame_width):
    center_x = (x1 + x2) / 2
    if center_x < frame_width * 0.34:
        return "left"
    if center_x > frame_width * 0.66:
        return "right"
    return "center"


def _distance_label(distance_m, area_ratio, bottom_ratio):
    if distance_m < 90.0:
        if distance_m <= 1.2:
            return "immediate"
        if distance_m <= 2.8:
            return "near"
        if distance_m <= 5.0:
            return "watch"
        return "far"
        
    if area_ratio >= 0.18 or bottom_ratio >= 0.92:
        return "immediate"
    if area_ratio >= 0.09 or bottom_ratio >= 0.82:
        return "near"
    if area_ratio >= 0.04 or bottom_ratio >= 0.68:
        return "watch"
    return "far"


def _steps_from_distance(distance_label):
    return {
        "immediate": 1,
        "near": 2,
        "watch": 4,
        "far": 6,
    }[distance_label]


def _risk_score(profile_risk, zone, area_ratio, bottom_ratio):
    zone_weight = {
        "left": 0.8,
        "center": 2.5,
        "right": 0.8,
    }[zone]
    return round(
        profile_risk
        + zone_weight
        + (area_ratio * 22.0)
        + (max(bottom_ratio - 0.55, 0.0) * 7.5),
        2,
    )


def describe_track(track, frame_shape, relative_depth_map=None):
    frame_height, frame_width = frame_shape[:2]
    frame_area = max(frame_height * frame_width, 1)

    x1, y1, x2, y2 = [int(v) for v in track["xyxy"]]
    width = max(x2 - x1, 1)
    height = max(y2 - y1, 1)
    area_ratio = (width * height) / frame_area
    bottom_ratio = y2 / max(frame_height, 1)
    zone = _zone_for_box(x1, x2, frame_width)
    class_name = _clean_label(track.get("class_name"))
    
    distance_m = depth_estimator.estimate_distance([x1, y1, x2, y2], class_name, frame_height, relative_depth_map)
    distance = _distance_label(distance_m, area_ratio, bottom_ratio)
    
    if distance_m < 90.0:
        steps_away = max(1, int(round(distance_m / 0.75)))
    else:
        steps_away = _steps_from_distance(distance)
    profile = CLASS_PROFILES.get(class_name, {"kind": "obstacle", "risk": 2.1})
    
    # Uncertainty Calibration: Weight the risk by the calibrated confidence.
    # This reduces the impact of 'ghost' detections or flickering tracks.
    confidence = float(track.get("confidence", 1.0))
    raw_risk = _risk_score(profile["risk"], zone, area_ratio, bottom_ratio)
    risk_score = round(raw_risk * max(confidence, 0.2), 2)

    # ── Motion / Time-to-Collision ────────────────────────────────────────
    # These fields come from _LightTrack.to_dict(); they default to safe
    # zero-values when absent (e.g. pseudo-tracks from _scene_from_detections).
    approach_rate = float(track.get("approach_rate", 0.0))
    is_approaching = bool(track.get("is_approaching", False))
    vx = float(track.get("vx", 0.0))
    vy = float(track.get("vy", 0.0))

    ttc_frames = None
    ttc_seconds = None
    approach_label = "stationary"

    if is_approaching and approach_rate > 0:
        # Danger threshold: area_ratio ≥ 0.18 triggers "immediate" in _distance_label.
        danger_area = 0.18 * frame_area
        current_area = width * height
        remaining = max(danger_area - current_area, 0.0)
        ttc_frames = int(round(remaining / approach_rate))
        ttc_seconds = round(ttc_frames / 30.0, 1)

        if ttc_frames <= 20:             # ∼0.7 s — imminent
            approach_label = "approaching fast"
            risk_score = round(risk_score + 3.5, 2)
        elif ttc_frames <= 40:           # ∼1.3 s — soon
            approach_label = "approaching"
            risk_score = round(risk_score + 1.5, 2)
        else:                            # moving closer but not yet urgent
            approach_label = "moving closer"
            risk_score = round(risk_score + 0.5, 2)
    # ─────────────────────────────────────────────────────────────────────

    # Enrich the per-obstacle summary with motion context.
    if approach_label == "stationary" or ttc_seconds is None:
        motion_suffix = ""
    else:
        motion_suffix = f", {approach_label} (~{ttc_seconds} s)"

    return {
        "track_id": int(track.get("track_id", 0)),
        "class_name": class_name,
        "kind": profile["kind"],
        "confidence": round(float(track.get("confidence") or track.get("conf") or 0.0), 3),
        "xyxy": [x1, y1, x2, y2],
        "zone": zone,
        "zone_label": ZONE_LABELS[zone],
        "distance": distance,
        "steps_away": steps_away,
        "risk_score": risk_score,
        "bottom_ratio": round(bottom_ratio, 3),
        "area_ratio": round(area_ratio, 3),
        "distance_m": distance_m,
        "summary": f"{class_name} about {steps_away} step{'s' if steps_away != 1 else ''} away on the {ZONE_LABELS[zone]}{motion_suffix}",
        # motion fields
        "vx": vx,
        "vy": vy,
        "approach_rate": approach_rate,
        "is_approaching": is_approaching,
        "approach_label": approach_label,
        "ttc_frames": ttc_frames,
        "ttc_seconds": ttc_seconds,
    }


def _choose_safe_direction(region_risk):
    if region_risk["center"] <= 2.8:
        return "forward"

    left_risk = region_risk["left"]
    right_risk = region_risk["right"]
    
    least_risky = "left" if left_risk <= right_risk else "right"
    if region_risk["center"] > 6.0 and left_risk > 6.0 and right_risk > 6.0:
        return f"surrounded|{least_risky}"

    return least_risky


def _recommended_steps(command, safe_direction, primary):
    obstacle_name = primary["class_name"]
    steps_away = primary["steps_away"]

    if command == "STOP":
        steps = [
            "Stop and keep your current position steady.",
            f"Turn slightly {safe_direction} and test the space with small foot movement.",
            f"If the path feels open, continue after about {steps_away} cautious step{'s' if steps_away != 1 else ''}.",
        ]
        if safe_direction == "wait":
            steps[1] = "Wait for the obstacle to move or for the center path to clear."
        elif "surrounded" in safe_direction:
            steps = [
                "Stop immediately and hold your ground.",
                "Slowly move your camera left and right to check the area.",
                "Wait for the crowd to clear before proceeding."
            ]
        return steps

    if command in {"MOVE_LEFT", "MOVE_RIGHT"}:
        turn_direction = "left" if command == "MOVE_LEFT" else "right"
        return [
            f"Angle your body a little to the {turn_direction}.",
            f"Take about {steps_away} careful step{'s' if steps_away != 1 else ''} to the {turn_direction}.",
            "Scan again before continuing straight.",
        ]

    if command == "SLOW":
        return [
            f"Slow down because a {obstacle_name} is close to the center path.",
            f"Keep scanning and prepare to move {safe_direction}.",
            "Only continue forward if the center space remains open.",
        ]

    return [
        "Continue forward at a calm pace.",
        "Scan the scene again after four steps.",
        "Stay ready to stop if a new obstacle appears in the center.",
    ]


def _describe_occupancy(grid):
    """Provides a natural language description of path blockage using the grid."""
    if grid is None:
        return ""
    
    gh, gw = grid.shape
    c1, c2 = (gw // 2) - 2, (gw // 2) + 2
    corridor = grid[:, c1:c2]
    blocked_mask = corridor > 0.45
    
    # Clear steps
    clear_steps = 0
    for r in range(gh - 1, -1, -1):
        if np.any(blocked_mask[r, :]):
            break
        clear_steps += 1
        
    # Stats
    blocked_count = np.count_nonzero(blocked_mask)
    total_cells = corridor.size
    pct = round((blocked_count / total_cells) * 100, 1)
    
    if pct <= 4.0:
        return "The center path is clear."
    
    label = "partially blocked"
    if pct > 70: label = "severely blocked"
    elif pct > 40: label = "heavily obstructed"
    
    phrase = f"The center path is {label} ({pct}%)."
    if clear_steps > 0:
        phrase += f" You have about {clear_steps} clear step{'s' if clear_steps != 1 else ''} ahead."
    else:
        phrase += " It is blocked immediately."
    
    # "X out of Y" reasoning
    phrase += f" Specifically, {blocked_count} out of {total_cells} segments ahead are obstructed."
    return phrase


def _clear_scene(frame_shape, grid=None, counts=None, context_objects=None):
    counts = counts or Counter()
    context_objects = context_objects or []
    object_phrase = _format_counts(counts)
    has_context = bool(counts)
    scene_caption = (
        f"I can see {object_phrase}, but no blocking obstacle right now."
        if has_context
        else "The camera does not see a major obstacle right now."
    )
    summary = (
        "Navigation context is visible, and the center path looks clear."
        if has_context
        else "No major obstacle detected. The path looks clear."
    )
    return {
        "command": "CLEAR",
        "urgency": "low",
        "path_clear": True,
        "safe_direction": "forward",
        "estimated_clear_steps": 4,
        "summary": summary,
        "spoken_message": "Path seems clear. Continue forward and scan again in four steps.",
        "scene_caption": scene_caption,
        "recommended_steps": [
            "Continue forward at a calm pace.",
            "Scan the scene again after four steps.",
            "Be ready to slow down if a new object appears in front of you.",
        ],
        "primary_obstacle": None,
        "obstacles": [],
        "context_objects": context_objects[:MAX_OBJECTS_IN_RESPONSE],
        "approaching_threats": [],
        "object_counts": dict(counts),
        "region_risk": {"left": 0.0, "center": 0.0, "right": 0.0},
        "palette": {"urgency": URGENCY_COLORS["low"]},
        "walkable_pct": 100.0 if grid is None else float(np.count_nonzero(grid < 0.4) / max(grid.size, 1) * 100),
    }


def build_scene_guidance(tracks, frame_shape, grid=None, relative_depth_map=None):
    if not tracks:
        return _clear_scene(frame_shape, grid=grid)

    # ── Hardware/Obstruction Check ──
    if any(t.get("class_name") == "camera_dark" for t in tracks):
        return {
            "command": "STOP",
            "urgency": "critical",
            "safe_direction": "wait",
            "summary": "Environment is too dark.",
            "spoken_message": "It is too dark. Please turn on lights.",
            "recommended_steps": ["Turn on a light or move to a lit area."],
            "primary_obstacle": None,
            "scene_caption": "Too dark.",
            "occupancy_reasoning": "No visual data.",
            "obstacles": [],
            "camera_obstructed": True,
            "path_clear": False,
        }
    if any(t.get("class_name") == "camera_blocked" for t in tracks):
        return {
            "command": "STOP",
            "urgency": "critical",
            "safe_direction": "wait",
            "summary": "Camera lens is blocked.",
            "spoken_message": "Camera blocked. Please check the lens.",
            "recommended_steps": ["Remove finger or clothing from the lens."],
            "primary_obstacle": None,
            "scene_caption": "Camera blocked.",
            "occupancy_reasoning": "No visual data.",
            "obstacles": [],
            "camera_obstructed": True,
            "path_clear": False,
        }

    described_items = [describe_track(track, frame_shape) for track in tracks]
    counts = Counter(item["class_name"] for item in described_items)
    context_objects = [
        item for item in described_items
        if not is_blocking_navigation_class(item["class_name"])
    ]
    obstacles = [
        item for item in described_items
        if is_blocking_navigation_class(item["class_name"])
    ]

    if not obstacles:
        context_objects.sort(key=lambda item: item["risk_score"], reverse=True)
        return _clear_scene(
            frame_shape,
            grid=grid,
            counts=counts,
            context_objects=context_objects,
        )

    obstacles.sort(key=lambda item: item["risk_score"], reverse=True)

    region_risk = {"left": 0.0, "center": 0.0, "right": 0.0}
    for obstacle in obstacles:
        region_risk[obstacle["zone"]] += obstacle["risk_score"]

    primary = obstacles[0]
    center_primary = next((item for item in obstacles if item["zone"] == "center"), None)

    # Context classes stay in object_counts/captions but do not decide STOP/CLEAR.
    # ── Safe Direction Refinement ──────────────────────────────────────────
    # If a traversability grid is available, use it to find the widest clear gap.
    # Otherwise fallback to the simple 3-zone risk sum.
    if grid is not None:
        gh, gw = grid.shape
        # Divide grid into 3 horizontal zones
        zone_w = gw // 3
        z_left = grid[:, :zone_w].mean()
        z_center = grid[:, zone_w:2*zone_w].mean()
        z_right = grid[:, 2*zone_w:].mean()
        
        least_risky_dir = "left" if z_left <= z_right else "right"
        
        if z_center <= 0.35:
            safe_direction = "forward"
        elif z_left > 0.6 and z_center > 0.6 and z_right > 0.6:
            safe_direction = f"surrounded|{least_risky_dir}"
        elif z_left <= z_right:
            safe_direction = "left"
        else:
            safe_direction = "right"
    else:
        safe_direction = _choose_safe_direction(region_risk)
    
    active_primary = center_primary or primary
    estimated_clear_steps = active_primary["steps_away"]

    if center_primary and (center_primary["risk_score"] >= 10.0 or center_primary["distance"] == "immediate"):
        primary = center_primary
        command = "STOP"
        urgency = "critical"
        if safe_direction == "forward":
            safe_direction = "wait"
        summary = (
            f"{primary['class_name'].title()} detected straight ahead and very close. "
            f"Stop and move {safe_direction}."
        )
        if safe_direction == "wait":
            summary = (
                f"{primary['class_name'].title()} detected straight ahead and very close. "
                "Stop and wait before moving."
            )
    elif center_primary and (center_primary["risk_score"] >= 7.5 or center_primary["steps_away"] <= 4):
        primary = center_primary
        command = "SLOW"
        urgency = "high" if primary["risk_score"] >= 7.5 else "medium"
        summary = (
            f"{primary['class_name'].title()} is close ahead. Slow down and prepare to move {safe_direction}."
        )
    elif primary["zone"] == "left" and primary["risk_score"] >= 6.5:
        command = "MOVE_RIGHT"
        urgency = "high"
        safe_direction = "right"
        summary = (
            f"{primary['class_name'].title()} is blocking the left side. Move right in about "
            f"{estimated_clear_steps} steps."
        )
    elif primary["zone"] == "right" and primary["risk_score"] >= 6.5:
        command = "MOVE_LEFT"
        urgency = "high"
        safe_direction = "left"
        summary = (
            f"{primary['class_name'].title()} is blocking the right side. Move left in about "
            f"{estimated_clear_steps} steps."
        )
    else:
        command = "CLEAR"
        urgency = "medium" if center_primary or region_risk["center"] > 2.5 else "low"
        if center_primary:
            summary = (
                f"{center_primary['class_name'].title()} is ahead but still has some space. "
                "Continue carefully and keep scanning."
            )
        elif region_risk["center"] > 2.5:
            summary = "The center path needs attention, but a careful forward move is still possible."
        else:
            summary = "Objects are visible, but the center path is currently open."

    object_phrase = _format_counts(counts)
    scene_caption = f"I can see {object_phrase}."

    spoken_message = summary
    if command == "STOP":
        if safe_direction == "wait":
            spoken_message = f"Stop. {primary['class_name'].title()} ahead. Wait."
        elif "surrounded" in safe_direction:
            spoken_message = f"Stop. Surrounded. Wait."
        else:
            spoken_message = f"Stop. {primary['class_name'].title()} ahead. Move {safe_direction} in {estimated_clear_steps} steps."
    elif command == "SLOW":
        spoken_message = f"Slow down. {primary['class_name'].title()} ahead. Move {safe_direction}."
    elif command == "MOVE_LEFT":
        spoken_message = f"Move left in {estimated_clear_steps} steps. {primary['class_name'].title()} on right."
    elif command == "MOVE_RIGHT":
        spoken_message = f"Move right in {estimated_clear_steps} steps. {primary['class_name'].title()} on left."

    # ── Ghost Alert Suppression ──────────────────────────────────────────
    # If the primary obstacle is low confidence and not immediately in 
    # front of the user, suppress the spoken message to avoid false alarms.
    is_uncertain = primary.get("confidence", 1.0) < 0.35
    is_immediate = primary.get("distance") == "immediate"
    
    if is_uncertain and not is_immediate and command != "CLEAR":
        # Downgrade the command and urgency if we aren't sure it's there.
        command = "CLEAR"
        urgency = "low"
        spoken_message = "Path seems mostly clear, though some uncertain objects are visible."
        summary = "Uncertain detections visible. Scanning continues."
    # ─────────────────────────────────────────────────────────────────────

    recommended_steps = _recommended_steps(command, safe_direction, primary)
    occupancy_reasoning = _describe_occupancy(grid)
    
    # We no longer append verbose occupancy_reasoning to spoken_message 
    # to keep the TTS clean and punchy for the user.

    # ── Approaching-threat collection ─────────────────────────────────────
    # Any obstacle that is actively closing in within ~1.3 s (40 frames).
    approaching_threats = [
        obs for obs in obstacles
        if obs.get("is_approaching")
        and obs.get("ttc_frames") is not None
        and obs["ttc_frames"] <= 40
    ]

    # ── Urgency upgrade for fast-approaching primary obstacle ─────────────
    # The static distance thresholds above are snapshot-based.  If the object
    # is closing in fast, escalate urgency one level and prepend the spoken
    # message so the user hears the motion warning first.
    URGENCY_LADDER = ("low", "medium", "high", "critical")
    primary_approach = primary.get("approach_label", "stationary")
    if primary_approach == "approaching fast":
        idx = URGENCY_LADDER.index(urgency)
        urgency = URGENCY_LADDER[min(idx + 1, len(URGENCY_LADDER) - 1)]
    elif primary_approach == "approaching":
        idx = URGENCY_LADDER.index(urgency)
        if idx == 0:          # only nudge low → medium; higher levels stay
            urgency = URGENCY_LADDER[1]
    # ─────────────────────────────────────────────────────────────────────

    return {
        "command": command,
        "urgency": urgency,
        "path_clear": command == "CLEAR" and center_primary is None and region_risk["center"] <= 2.5,
        "safe_direction": safe_direction,
        "estimated_clear_steps": estimated_clear_steps,
        "summary": summary,
        "spoken_message": spoken_message,
        "scene_caption": scene_caption,
        "recommended_steps": recommended_steps,
        "primary_obstacle": primary,
        "obstacles": obstacles[:MAX_OBJECTS_IN_RESPONSE],
        "context_objects": context_objects[:MAX_OBJECTS_IN_RESPONSE],
        "approaching_threats": approaching_threats,
        "object_counts": dict(counts),
        "region_risk": {key: round(value, 2) for key, value in region_risk.items()},
        "palette": {"urgency": URGENCY_COLORS[urgency]},
        "walkable_pct": 100.0 if grid is None else round(float(np.count_nonzero(grid < 0.4) / max(grid.size, 1) * 100), 1),
        "occupancy_reasoning": occupancy_reasoning,
    }


def answer_scene_question(question, scene):
    prompt = (question or "").strip()
    lowered = prompt.lower()
    primary = scene.get("primary_obstacle")
    safe_direction = scene.get("safe_direction", "forward")

    if not prompt:
        return {
            "question": "",
            "intent": "empty",
            "answer": "Ask about the path, nearby objects, or which side is safer.",
        }

    if any(token in lowered for token in ["avoid", "instruction", "steps", "do now", "help"]):
        answer = (
            f"{scene.get('spoken_message', '')} "
            f"Then: {scene.get('recommended_steps', ['Scan again.'])[0]}"
        ).strip()
        return {"question": prompt, "intent": "action", "answer": answer}

    if any(token in lowered for token in ["left", "right", "direction", "safer", "where"]):
        answer = f"The safest direction right now is {safe_direction}."
        if primary:
            answer += f" The main obstacle is a {primary['class_name']} {primary['zone_label']}."
        return {"question": prompt, "intent": "safe_direction", "answer": answer}

    if any(token in lowered for token in ["safe", "clear", "walk", "move now"]):
        if scene.get("path_clear"):
            answer = (
                "Yes, the path looks clear right now. Continue forward and scan again in a few steps."
            )
        else:
            answer = (
                f"Not yet. {scene.get('summary', '')} "
                f"The safest direction right now is {safe_direction}."
            ).strip()
        return {"question": prompt, "intent": "path_status", "answer": answer}

    if any(token in lowered for token in ["closest", "nearest", "obstacle"]):
        if primary:
            answer = (
                f"The closest concern is a {primary['class_name']} {primary['zone_label']}. "
                f"It looks {primary['distance']} and is about {primary['steps_away']} step"
                f"{'s' if primary['steps_away'] != 1 else ''} away."
            )
        else:
            answer = "I do not see a close obstacle right now."
        return {"question": prompt, "intent": "primary_obstacle", "answer": answer}

    if any(token in lowered for token in ["what", "see", "ahead", "front", "around"]):
        answer = (
            f"{scene.get('scene_caption', '')} {scene.get('summary', '')}"
        ).strip()
        return {"question": prompt, "intent": "scene_summary", "answer": answer}

    return {
        "question": prompt,
        "intent": "fallback",
        "answer": (
            "I can answer focused mobility questions such as what is ahead, whether the path is clear, "
            f"which side is safer, or how to avoid the current obstacle. Right now: {scene.get('summary', '')}"
        ).strip(),
    }


INDOOR_ROOM_PROFILES = {
    "washroom": {
        "label": "washroom",
        "weights": {"toilet": 6, "sink": 4, "toothbrush": 3, "hair drier": 2},
    },
    "kitchen": {
        "label": "kitchen",
        "weights": {
            "refrigerator": 4,
            "microwave": 3,
            "oven": 3,
            "toaster": 3,
            "sink": 2,
            "bottle": 1,
            "cup": 1,
            "bowl": 1,
            "dining table": 1,
        },
    },
    "bedroom": {
        "label": "bedroom",
        "weights": {"bed": 6, "book": 1, "clock": 1, "cell phone": 1, "laptop": 1},
    },
    "living_area": {
        "label": "living area",
        "weights": {"couch": 4, "tv": 3, "remote": 2, "chair": 1, "potted plant": 1, "book": 1},
    },
    "dining_area": {
        "label": "dining area",
        "weights": {"dining table": 4, "chair": 2, "bowl": 2, "cup": 2, "bottle": 1},
    },
    "office": {
        "label": "office area",
        "weights": {"laptop": 3, "keyboard": 3, "mouse": 3, "chair": 2, "book": 1, "tv": 1},
    },
    "patient_room": {
        "label": "patient room",
        "weights": {"bed": 5, "sink": 2, "chair": 1, "person": 1},
    },
    "reception": {
        "label": "reception area",
        "weights": {"bench": 3, "chair": 2, "laptop": 2, "tv": 1, "potted plant": 1, "book": 1},
    },
}

INDOOR_FIND_ALIASES = {
    "phone": "cell phone",
    "mobile": "cell phone",
    "cellphone": "cell phone",
    "sofa": "couch",
    "table": "dining table",
    "bathroom": "washroom",
    "restroom": "washroom",
    "toilet": "washroom",
    "washroom": "washroom",
    "kitchen": "kitchen",
    "bedroom": "bedroom",
    "living room": "living_area",
    "living area": "living_area",
    "office": "office",
    "reception": "reception",
    "patient room": "patient_room",
    "sign": "sign",
    "text": "sign",
    "board": "sign",
    "door text": "sign",
}

ROOM_TEXT_HINTS = {
    "washroom": "washroom",
    "restroom": "washroom",
    "toilet": "washroom",
    "wash room": "washroom",
    "ladies": "washroom",
    "gents": "washroom",
    "women": "washroom",
    "men": "washroom",
    "female": "washroom",
    "male": "washroom",
    "kitchen": "kitchen",
    "reception": "reception area",
    "office": "office area",
    "bedroom": "bedroom",
    "ward": "patient room",
    "icu": "patient room",
    "emergency": "patient room",
    "cafeteria": "dining area",
    "canteen": "dining area",
    "laboratory": "office area",
    "lab": "office area",
    "lift": "office area",
    "elevator": "office area",
}

SIGN_CONTEXT_HINTS = {
    "emergency exit": {
        "label": "emergency exit",
        "kind": "wayfinding",
        "room_hint": "",
        "meaning": "That likely points toward an emergency exit route.",
    },
    "exit": {
        "label": "exit",
        "kind": "wayfinding",
        "room_hint": "",
        "meaning": "That likely points toward an exit.",
    },
    "washroom": {
        "label": "washroom",
        "kind": "room_sign",
        "room_hint": "washroom",
        "meaning": "That likely marks the washroom entrance.",
    },
    "restroom": {
        "label": "restroom",
        "kind": "room_sign",
        "room_hint": "washroom",
        "meaning": "That likely marks the washroom entrance.",
    },
    "toilet": {
        "label": "toilet",
        "kind": "room_sign",
        "room_hint": "washroom",
        "meaning": "That likely marks the washroom entrance.",
    },
    "ladies": {
        "label": "ladies washroom",
        "kind": "room_sign",
        "room_hint": "washroom",
        "meaning": "That likely marks the ladies washroom.",
    },
    "gents": {
        "label": "gents washroom",
        "kind": "room_sign",
        "room_hint": "washroom",
        "meaning": "That likely marks the gents washroom.",
    },
    "women": {
        "label": "women washroom",
        "kind": "room_sign",
        "room_hint": "washroom",
        "meaning": "That likely marks the women washroom.",
    },
    "men": {
        "label": "men washroom",
        "kind": "room_sign",
        "room_hint": "washroom",
        "meaning": "That likely marks the men washroom.",
    },
    "female": {
        "label": "female washroom",
        "kind": "room_sign",
        "room_hint": "washroom",
        "meaning": "That likely marks the female washroom.",
    },
    "male": {
        "label": "male washroom",
        "kind": "room_sign",
        "room_hint": "washroom",
        "meaning": "That likely marks the male washroom.",
    },
    "reception": {
        "label": "reception",
        "kind": "room_sign",
        "room_hint": "reception area",
        "meaning": "That likely points to the reception area.",
    },
    "office": {
        "label": "office",
        "kind": "room_sign",
        "room_hint": "office area",
        "meaning": "That likely marks an office area.",
    },
    "kitchen": {
        "label": "kitchen",
        "kind": "room_sign",
        "room_hint": "kitchen",
        "meaning": "That likely marks the kitchen.",
    },
    "bedroom": {
        "label": "bedroom",
        "kind": "room_sign",
        "room_hint": "bedroom",
        "meaning": "That likely marks the bedroom.",
    },
    "ward": {
        "label": "ward",
        "kind": "room_sign",
        "room_hint": "patient room",
        "meaning": "That likely points to a patient room or ward.",
    },
    "icu": {
        "label": "ICU",
        "kind": "room_sign",
        "room_hint": "patient room",
        "meaning": "That likely points to the ICU or a critical care area.",
    },
    "pharmacy": {
        "label": "pharmacy",
        "kind": "service_sign",
        "room_hint": "",
        "meaning": "That likely points to the pharmacy.",
    },
    "laboratory": {
        "label": "laboratory",
        "kind": "service_sign",
        "room_hint": "",
        "meaning": "That likely points to a laboratory.",
    },
    "lab": {
        "label": "lab",
        "kind": "service_sign",
        "room_hint": "",
        "meaning": "That likely points to a laboratory.",
    },
    "billing": {
        "label": "billing",
        "kind": "service_sign",
        "room_hint": "",
        "meaning": "That likely points to a billing or payment counter.",
    },
    "lift": {
        "label": "lift",
        "kind": "wayfinding",
        "room_hint": "",
        "meaning": "That likely points toward a lift.",
    },
    "elevator": {
        "label": "elevator",
        "kind": "wayfinding",
        "room_hint": "",
        "meaning": "That likely points toward an elevator.",
    },
    "stairs": {
        "label": "stairs",
        "kind": "wayfinding",
        "room_hint": "",
        "meaning": "That likely points toward stairs.",
    },
    "staircase": {
        "label": "staircase",
        "kind": "wayfinding",
        "room_hint": "",
        "meaning": "That likely points toward stairs.",
    },
    "canteen": {
        "label": "canteen",
        "kind": "service_sign",
        "room_hint": "dining area",
        "meaning": "That likely points to a canteen or dining area.",
    },
}

OBJECT_SHAPE_HINTS = {
    "bottle": "tall and bottle-shaped, usually close to cylindrical",
    "cup": "small and cup-like with a compact opening",
    "bowl": "round and bowl-like",
    "cell phone": "flat and rectangular",
    "remote": "slim and rectangular",
    "book": "flat and rectangular",
    "pen": "very slim and narrow",
    "chair": "structured like a seat with a back support shape",
    "couch": "broad and cushioned in shape",
    "bed": "large and rectangular",
    "potted plant": "a rounded plant form above a pot",
}

OBJECT_USAGE_HINTS = {
    "bottle": "It looks like a handheld container you could grip with one hand.",
    "cup": "It looks like a small drinking container.",
    "bowl": "It looks like a shallow container for food or small items.",
    "cell phone": "It looks like a handheld flat device with a screen surface.",
    "remote": "It looks like a small handheld controller.",
    "book": "It looks like a flat object with a cover and page-like shape.",
    "chair": "It looks like seating furniture with a back support.",
    "couch": "It looks like soft seating furniture for more than one person.",
    "bed": "It looks like a large flat furniture surface for resting.",
    "potted plant": "It looks like a plant rising above a pot base.",
    "backpack": "It looks like a soft carrying bag.",
    "suitcase": "It looks like a rigid travel bag.",
    "handbag": "It looks like a small carrying bag.",
}

INDOOR_MODE_LABELS = {
    "navigator": "Indoor Navigator",
    "explore": "Explore",
    "room": "Read Sign / Room",
    "find": "Find",
    "describe": "Describe",
    "gesture": "Hand Sign",
}

OCR_VOCAB = sorted(
    {
        token
        for phrase in (
            list(ROOM_TEXT_HINTS)
            + list(SIGN_CONTEXT_HINTS)
            + list(INDOOR_FIND_ALIASES)
            + ["male", "female", "ladies", "gents", "room", "ward", "icu", "opd", "exit"]
        )
        for token in re.findall(r"[a-z0-9]+", phrase)
        if len(token) >= 3
    }
)
TESSERACT_CANDIDATE_PATHS = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    r"C:\ProgramData\chocolatey\bin\tesseract.exe",
)
_TESSERACT_CMD_CACHE = None
_HANDS_DETECTOR = None
_HANDS_DETECTOR_READY = False
HAND_SIGN_SUPPORT_MESSAGE = (
    "Hand Sign mode currently understands a small static vocabulary such as open palm, fist, "
    "pointing, thumbs up, finger counts, and likely ASL-style letters A, B, D, I, L, V, W, and Y."
)

HAND_SIGN_MEANINGS = {
    "open_palm": {
        "label": "open palm",
        "message": "I can see an open palm, which often means stop, hello, or attention.",
        "category": "common",
        "confidence": "high",
        "meaning": "a hello, stop, or attention gesture",
    },
    "fist": {
        "label": "fist",
        "message": "I can see a closed fist hand sign.",
        "category": "common",
        "confidence": "medium",
        "meaning": "a fist or yes-style gesture",
    },
    "pointing": {
        "label": "pointing finger",
        "message": "I can see a pointing gesture with one raised finger.",
        "category": "common",
        "confidence": "high",
        "meaning": "a pointing gesture",
    },
    "two_fingers": {
        "label": "two fingers",
        "message": "I can see two raised fingers, similar to a V sign.",
        "category": "common",
        "confidence": "medium",
        "meaning": "a two-finger sign",
    },
    "three_fingers": {
        "label": "three fingers",
        "message": "I can see three raised fingers.",
        "category": "common",
        "confidence": "medium",
        "meaning": "a three-finger sign",
    },
    "four_fingers": {
        "label": "four fingers",
        "message": "I can see four raised fingers.",
        "category": "common",
        "confidence": "medium",
        "meaning": "a four-finger sign",
    },
    "thumbs_up": {
        "label": "thumbs up",
        "message": "I can see a thumbs-up gesture.",
        "category": "common",
        "confidence": "high",
        "meaning": "approval or a positive gesture",
    },
    "asl_letter_a": {
        "label": "ASL letter A",
        "message": "This looks like the ASL letter A, a closed fist with the thumb outside.",
        "category": "alphabet",
        "confidence": "medium",
        "meaning": "the letter A",
    },
    "asl_letter_b": {
        "label": "ASL letter B",
        "message": "This looks like the ASL letter B, with four fingers up and the thumb folded in.",
        "category": "alphabet",
        "confidence": "high",
        "meaning": "the letter B",
    },
    "asl_letter_d": {
        "label": "ASL letter D",
        "message": "This likely looks like the ASL letter D, with one finger up and the thumb touching the curled fingers.",
        "category": "alphabet",
        "confidence": "medium",
        "meaning": "the letter D",
    },
    "asl_letter_i": {
        "label": "ASL letter I",
        "message": "This looks like the ASL letter I, with the pinky finger raised.",
        "category": "alphabet",
        "confidence": "high",
        "meaning": "the letter I",
    },
    "asl_letter_l": {
        "label": "ASL letter L",
        "message": "This looks like the ASL letter L, made with the thumb and index finger.",
        "category": "alphabet",
        "confidence": "high",
        "meaning": "the letter L",
    },
    "asl_letter_v": {
        "label": "ASL letter V",
        "message": "This looks like the ASL letter V, which many people also use as a peace sign.",
        "category": "alphabet",
        "confidence": "high",
        "meaning": "the letter V or a peace sign",
    },
    "asl_letter_w": {
        "label": "ASL letter W",
        "message": "This looks like the ASL letter W, with three fingers spread upward.",
        "category": "alphabet",
        "confidence": "medium",
        "meaning": "the letter W",
    },
    "asl_letter_y": {
        "label": "ASL letter Y",
        "message": "This looks like the ASL letter Y, which can also resemble a call-me hand sign.",
        "category": "alphabet",
        "confidence": "high",
        "meaning": "the letter Y or a call-me style sign",
    },
}


def _resolve_tesseract_cmd():
    global _TESSERACT_CMD_CACHE
    if _TESSERACT_CMD_CACHE is not None:
        return _TESSERACT_CMD_CACHE

    candidates = [shutil.which("tesseract")]
    if os.name == "nt":
        candidates.extend(TESSERACT_CANDIDATE_PATHS)

    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            _TESSERACT_CMD_CACHE = candidate
            if pytesseract is not None:
                try:
                    pytesseract.pytesseract.tesseract_cmd = candidate
                except Exception as e:
                    print(f"[Planner] Error setting tesseract_cmd: {e}")
                    pass
            return candidate

    _TESSERACT_CMD_CACHE = ""
    return ""


def _hand_sign_is_available():
    return mp is not None


def _get_hands_detector():
    global _HANDS_DETECTOR, _HANDS_DETECTOR_READY
    if _HANDS_DETECTOR_READY:
        return _HANDS_DETECTOR

    _HANDS_DETECTOR_READY = True
    if not _hand_sign_is_available():
        _HANDS_DETECTOR = None
        return None

    try:
        _HANDS_DETECTOR = mp.solutions.hands.Hands(
            static_image_mode=False,
            max_num_hands=1,
            model_complexity=0,
            min_detection_confidence=0.45,
            min_tracking_confidence=0.45,
        )
    except Exception as e:
        print(f"[Planner] Failed to initialize mediapipe Hands: {e}")
        _HANDS_DETECTOR = None
    return _HANDS_DETECTOR


def _landmark_pixel(landmark, frame_shape):
    frame_height, frame_width = frame_shape[:2]
    return landmark.x * frame_width, landmark.y * frame_height


def _landmark_distance(landmarks, first_index, second_index):
    first = landmarks[first_index]
    second = landmarks[second_index]
    return float(np.hypot(first.x - second.x, first.y - second.y))


def _finger_is_extended(landmarks, tip_index, pip_index, mcp_index):
    tip_to_wrist = _landmark_distance(landmarks, tip_index, 0)
    pip_to_wrist = _landmark_distance(landmarks, pip_index, 0)
    mcp_to_wrist = _landmark_distance(landmarks, mcp_index, 0)
    tip_above_pip = landmarks[tip_index].y < landmarks[pip_index].y + 0.02
    return (
        tip_to_wrist > (pip_to_wrist * 1.08)
        and tip_to_wrist > (mcp_to_wrist * 1.15)
        and tip_above_pip
    )


def _thumb_is_extended(landmarks, handedness_label):
    tip_to_index_mcp = _landmark_distance(landmarks, 4, 5)
    ip_to_index_mcp = _landmark_distance(landmarks, 3, 5)
    tip_to_palm = _landmark_distance(landmarks, 4, 9)
    ip_to_palm = _landmark_distance(landmarks, 3, 9)
    outward = landmarks[4].x > landmarks[3].x if handedness_label == "Right" else landmarks[4].x < landmarks[3].x
    vertical = landmarks[4].y < landmarks[2].y - 0.02
    return (
        tip_to_index_mcp > (ip_to_index_mcp * 1.05)
        and tip_to_palm > (ip_to_palm * 1.06)
        and (outward or vertical)
    )


def _raised_fingers(landmarks, handedness_label, frame_shape):
    del frame_shape
    return {
        "thumb": _thumb_is_extended(landmarks, handedness_label),
        "index": _finger_is_extended(landmarks, 8, 6, 5),
        "middle": _finger_is_extended(landmarks, 12, 10, 9),
        "ring": _finger_is_extended(landmarks, 16, 14, 13),
        "pinky": _finger_is_extended(landmarks, 20, 18, 17),
    }


def _hand_pose_metrics(landmarks):
    palm_scale = max(_landmark_distance(landmarks, 0, 9), _landmark_distance(landmarks, 5, 17), 1e-3)
    palm_center_x = np.mean([landmarks[index].x for index in (0, 5, 9, 13, 17)])
    palm_center_y = np.mean([landmarks[index].y for index in (0, 5, 9, 13, 17)])
    thumb_tip = landmarks[4]

    return {
        "thumb_index_spread": _landmark_distance(landmarks, 4, 8) / palm_scale,
        "thumb_middle_gap": _landmark_distance(landmarks, 4, 12) / palm_scale,
        "index_middle_spread": _landmark_distance(landmarks, 8, 12) / palm_scale,
        "middle_ring_spread": _landmark_distance(landmarks, 12, 16) / palm_scale,
        "ring_pinky_spread": _landmark_distance(landmarks, 16, 20) / palm_scale,
        "thumb_outside": float(np.hypot(thumb_tip.x - palm_center_x, thumb_tip.y - palm_center_y) / palm_scale),
        "thumb_above_wrist": thumb_tip.y < landmarks[0].y - 0.02,
        "thumb_middle_touch": (_landmark_distance(landmarks, 4, 12) / palm_scale) < 0.9,
        "fingers_grouped": (
            (_landmark_distance(landmarks, 8, 12) / palm_scale) < 0.7
            and (_landmark_distance(landmarks, 12, 16) / palm_scale) < 0.7
            and (_landmark_distance(landmarks, 16, 20) / palm_scale) < 0.7
        ),
    }


def _classify_hand_pattern(raised, metrics):
    raised_count = sum(1 for value in raised.values() if value)
    thumb_only = raised["thumb"] and not any(raised[finger] for finger in ("index", "middle", "ring", "pinky"))
    index_only = raised["index"] and not any(raised[finger] for finger in ("thumb", "middle", "ring", "pinky"))
    pinky_only = raised["pinky"] and not any(raised[finger] for finger in ("thumb", "index", "middle", "ring"))

    if all(raised.values()):
        return "open_palm"

    if raised_count == 0:
        return "asl_letter_a" if metrics["thumb_outside"] >= 0.95 else "fist"

    if thumb_only:
        return "thumbs_up" if metrics["thumb_above_wrist"] else "fist"

    if pinky_only:
        return "asl_letter_i"

    if raised["thumb"] and raised["pinky"] and not any(raised[finger] for finger in ("index", "middle", "ring")):
        return "asl_letter_y"

    if index_only:
        return "asl_letter_d" if metrics["thumb_middle_touch"] else "pointing"

    if raised["thumb"] and raised["index"] and not any(raised[finger] for finger in ("middle", "ring", "pinky")):
        return "asl_letter_l" if metrics["thumb_index_spread"] >= 1.15 else "pointing"

    if raised["index"] and raised["middle"] and not any(raised[finger] for finger in ("thumb", "ring", "pinky")):
        return "asl_letter_v" if metrics["index_middle_spread"] >= 0.62 else "two_fingers"

    if raised["index"] and raised["middle"] and raised["ring"] and not raised["thumb"] and not raised["pinky"]:
        if metrics["index_middle_spread"] >= 0.44 and metrics["middle_ring_spread"] >= 0.38:
            return "asl_letter_w"
        return "three_fingers"

    if raised["index"] and raised["middle"] and raised["ring"] and raised["pinky"] and not raised["thumb"]:
        return "asl_letter_b" if metrics["fingers_grouped"] else "four_fingers"

    if raised_count >= 4:
        return "open_palm"
    if raised_count == 3:
        return "three_fingers"
    if raised_count == 2:
        return "two_fingers"
    return "pointing"


def detect_hand_sign(frame):
    if frame is None or not hasattr(frame, "shape") or getattr(frame, "size", 0) == 0:
        return {
            "status": "no_frame",
            "label": "",
            "message": "I do not have a clear frame for hand-sign reading yet.",
        }

    detector = _get_hands_detector()
    if detector is None:
        return {
            "status": "unavailable",
            "label": "",
            "message": "Hand-sign reading needs the mediapipe package installed in this environment.",
        }

    try:
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = detector.process(rgb_frame)
    except Exception as e:
        print(f"[Planner] Hand sign processing error: {e}")
        return {
            "status": "error",
            "label": "",
            "message": "I could not process the hand sign from this frame.",
        }

    if not result.multi_hand_landmarks:
        return {
            "status": "no_hand",
            "label": "",
            "message": "I cannot see a clear hand gesture in front of the camera yet.",
        }

    handedness_label = "Right"
    if result.multi_handedness:
        try:
            handedness_label = result.multi_handedness[0].classification[0].label
        except Exception as e:
            print(f"[Planner] Handedness classification fallback: {e}")
            handedness_label = "Right"

    hand_landmarks = result.multi_hand_landmarks[0].landmark
    raised = _raised_fingers(hand_landmarks, handedness_label, frame.shape)
    raised_count = sum(1 for value in raised.values() if value)
    metrics = _hand_pose_metrics(hand_landmarks)
    sign_key = _classify_hand_pattern(raised, metrics)

    meaning = HAND_SIGN_MEANINGS[sign_key]
    return {
        "status": "found",
        "label": meaning["label"],
        "message": meaning["message"],
        "category": meaning.get("category", "common"),
        "confidence": meaning.get("confidence", "medium"),
        "meaning": meaning.get("meaning", ""),
        "handedness": handedness_label.lower(),
        "raised_count": raised_count,
        "raised_fingers": [finger for finger, is_up in raised.items() if is_up],
    }


def _scene_objects(scene):
    if not scene:
        return []
    return list(scene.get("detections") or scene.get("obstacles") or [])



def _natural_list(values):
    items = [str(value).strip() for value in (values or []) if str(value).strip()]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f", and {items[-1]}"



def _scene_counts(scene):
    counts = Counter(scene.get("object_counts") or {})
    if counts:
        return counts

    for item in _scene_objects(scene):
        label = _clean_label(item.get("class_name"))
        counts[label] += 1
    return counts



def _sorted_indoor_landmarks(scene, limit=5):
    return sorted(
        _scene_objects(scene),
        key=lambda item: (
            int(item.get("steps_away", 99)),
            -float(item.get("confidence", 0.0)),
            -float(item.get("risk_score", 0.0)),
        ),
    )[:limit]



def _format_landmark(item):
    label = _clean_label(item.get("class_name"))
    zone = item.get("zone_label") or ZONE_LABELS.get(item.get("zone"), "ahead")
    steps = item.get("steps_away")
    if steps:
        return f"{label} {zone}, about {steps} step{'s' if steps != 1 else ''} away"
    return f"{label} {zone}"



def _zone_phrase(items):
    labels = [_clean_label(item.get("class_name")) for item in items[:2]]
    return _natural_list(labels)



def _build_layout_summary(scene):
    landmarks = _sorted_indoor_landmarks(scene, limit=5)
    if not landmarks:
        return "The immediate indoor area looks open right now."

    zones = {"center": [], "left": [], "right": []}
    for item in landmarks:
        zones[item.get("zone", "center")].append(item)

    parts = []
    if zones["center"]:
        parts.append(f"Ahead I can see {_zone_phrase(zones['center'])}.")
    if zones["left"]:
        parts.append(f"On the left there is {_zone_phrase(zones['left'])}.")
    if zones["right"]:
        parts.append(f"On the right there is {_zone_phrase(zones['right'])}.")

    if not parts:
        parts.append(scene.get("scene_caption") or "I can see a few indoor objects around you.")

    if not scene.get("path_clear"):
        safe_direction = scene.get("safe_direction", "forward")
        if safe_direction == "wait":
            parts.append("Pause for a moment and scan again before moving.")
        else:
            parts.append(f"The safer movement direction right now is {safe_direction}.")
    elif scene.get("spoken_message"):
        parts.append(scene.get("spoken_message"))

    return " ".join(part.strip() for part in parts if part).strip()



def _room_score_details(counts):
    scoring = {}
    for key, profile in INDOOR_ROOM_PROFILES.items():
        score = 0
        reasons = []
        for label, weight in profile["weights"].items():
            count = counts.get(label, 0)
            if not count:
                continue
            score += count * weight
            reasons.append((label, count, weight))
        scoring[key] = {"score": score, "reasons": reasons, "label": profile["label"]}
    return scoring



def infer_indoor_room(scene):
    counts = _scene_counts(scene)
    scoring = _room_score_details(counts)
    ranked = sorted(scoring.items(), key=lambda item: item[1]["score"], reverse=True)
    if not ranked or ranked[0][1]["score"] <= 0:
        return {
            "key": "unknown",
            "label": "unknown indoor area",
            "confidence": "low",
            "confidence_label": "Low confidence",
            "certainty": "I cannot estimate the room type reliably yet.",
            "reason": "I need stronger indoor landmarks such as sink, toilet, bed, sofa, dining table, or appliances.",
            "score": 0,
        }

    best_key, best = ranked[0]
    second_score = ranked[1][1]["score"] if len(ranked) > 1 else 0
    margin = best["score"] - second_score

    if best["score"] >= 8 and margin >= 3:
        confidence = "high"
        certainty = f"This looks like a {best['label']}."
    elif best["score"] >= 5:
        confidence = "medium"
        certainty = f"This is likely a {best['label']}."
    else:
        confidence = "low"
        certainty = f"This may be a {best['label']}, but I am not fully sure yet."

    reason_parts = []
    for label, count, _weight in sorted(best["reasons"], key=lambda item: item[2], reverse=True)[:3]:
        if count == 1:
            reason_parts.append(label)
        else:
            reason_parts.append(f"{count} {IRREGULAR_PLURALS.get(label, label + 's')}")

    reason = (
        f"I am using visible landmarks like {_natural_list(reason_parts)}."
        if reason_parts
        else "I am using the strongest visible room landmarks in the frame."
    )

    return {
        "key": best_key,
        "label": best["label"],
        "confidence": confidence,
        "confidence_label": f"{confidence.title()} confidence",
        "certainty": certainty,
        "reason": reason,
        "score": best["score"],
    }



def _extract_find_target(question, scene):
    lowered = (question or "").strip().lower()
    if not lowered:
        return ""

    for alias in sorted(INDOOR_FIND_ALIASES, key=len, reverse=True):
        if re.search(rf"\b{re.escape(alias)}\b", lowered):
            return INDOOR_FIND_ALIASES[alias]

    for label in sorted(_scene_counts(scene).keys(), key=len, reverse=True):
        if re.search(rf"\b{re.escape(label)}\b", lowered):
            return label

    return ""



def _match_visible_objects(target, scene):
    if not target or target in INDOOR_ROOM_PROFILES or target == "sign":
        return []
    return [item for item in _scene_objects(scene) if _clean_label(item.get("class_name")) == target]



def _crop_from_item(frame, item):
    if frame is None or not hasattr(frame, "shape"):
        return None
    x1, y1, x2, y2 = [int(value) for value in item.get("xyxy", [0, 0, 0, 0])]
    height, width = frame.shape[:2]
    x1 = max(0, min(x1, width - 1))
    x2 = max(0, min(x2, width))
    y1 = max(0, min(y1, height - 1))
    y2 = max(0, min(y2, height))
    if x2 <= x1 or y2 <= y1:
        return None
    return frame[y1:y2, x1:x2].copy()


def _normalize_text_for_match(value):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").lower())).strip()


def _correct_ocr_phrase(text):
    normalized = _normalize_text_for_match(text)
    if not normalized:
        return ""

    for source, target in sorted(OCR_PHRASE_NORMALIZATIONS.items(), key=lambda item: len(item[0]), reverse=True):
        normalized = normalized.replace(source, target)

    corrected_tokens = []
    for token in normalized.split():
        if len(token) < 3 or token in OCR_VOCAB or token.isdigit():
            corrected_tokens.append(token)
            continue
        close_match = difflib.get_close_matches(token, OCR_VOCAB, n=1, cutoff=0.76)
        corrected_tokens.append(close_match[0] if close_match else token)
    return " ".join(corrected_tokens).strip()


def _display_phrase(text):
    words = [word for word in str(text or "").split() if word]
    rendered = []
    for word in words:
        lowered = word.lower()
        if lowered in OCR_FORCE_UPPER:
            rendered.append(lowered.upper())
        elif word.isdigit():
            rendered.append(word)
        else:
            rendered.append(word.title())
    return " ".join(rendered)


def _interpret_sign_text(text):
    normalized = _correct_ocr_phrase(text)
    label = ""
    sign_kind = ""
    meaning = ""
    room_hint = ""

    for keyword, meta in sorted(SIGN_CONTEXT_HINTS.items(), key=lambda item: len(item[0]), reverse=True):
        if re.search(rf"\b{re.escape(keyword)}\b", normalized):
            label = meta["label"]
            sign_kind = meta["kind"]
            meaning = meta["meaning"]
            room_hint = meta["room_hint"]
            break

    if not room_hint:
        for keyword, hint in sorted(ROOM_TEXT_HINTS.items(), key=lambda item: len(item[0]), reverse=True):
            if re.search(rf"\b{re.escape(keyword)}\b", normalized):
                room_hint = hint
                break

    room_number_match = re.search(r"\broom\s+\d+[a-z]?\b", normalized)
    if room_number_match and not label:
        label = room_number_match.group(0)
        sign_kind = "room_number"
        meaning = "That looks like a room number sign."

    return {
        "normalized_text": normalized,
        "label": _display_phrase(label) if label else "",
        "sign_kind": sign_kind,
        "meaning": meaning,
        "room_hint": room_hint,
    }



def _dominant_color_name(crop):
    if crop is None or getattr(crop, "size", 0) == 0:
        return "unclear"

    blurred = cv2.GaussianBlur(crop, (5, 5), 0)
    hsv = cv2.cvtColor(blurred, cv2.COLOR_BGR2HSV)
    mean_h, mean_s, mean_v, _alpha = cv2.mean(hsv)

    if mean_v < 40:
        return "very dark"
    if mean_s < 28:
        if mean_v > 210:
            return "white"
        if mean_v > 150:
            return "light gray"
        return "gray"

    if mean_h < 10 or mean_h >= 170:
        return "red"
    if mean_h < 18:
        return "brown" if mean_v < 165 else "orange"
    if mean_h < 30:
        return "yellow"
    if mean_h < 85:
        return "green"
    if mean_h < 105:
        return "cyan"
    if mean_h < 130:
        return "blue"
    if mean_h < 160:
        return "purple"
    return "pink"


def _color_phrase(crop):
    color = _dominant_color_name(crop)
    if color == "unclear":
        return ""

    hsv = cv2.cvtColor(cv2.GaussianBlur(crop, (5, 5), 0), cv2.COLOR_BGR2HSV)
    _mean_h, _mean_s, mean_v, _alpha = cv2.mean(hsv)
    if color in {"white", "light gray", "gray", "very dark"}:
        return color
    if mean_v < 90:
        return f"dark {color}"
    if mean_v > 190:
        return f"light {color}"
    return color



def _shape_hint(label, width, height):
    if label in OBJECT_SHAPE_HINTS:
        return OBJECT_SHAPE_HINTS[label]

    aspect_ratio = width / max(height, 1)
    if aspect_ratio < 0.55:
        return "tall and slim"
    if aspect_ratio > 1.75:
        return "wide and flat"
    if 0.85 <= aspect_ratio <= 1.15:
        return "fairly balanced and box-like"
    return "rectangular"


def _orientation_hint(width, height):
    aspect_ratio = width / max(height, 1)
    if aspect_ratio < 0.65:
        return "It stands more vertically than horizontally in this view."
    if aspect_ratio > 1.45:
        return "It spreads wider than it is tall in this view."
    return "Its proportions look fairly balanced in this view."


def _texture_hint(crop):
    if crop is None or getattr(crop, "size", 0) == 0:
        return ""

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 80, 160)
    density = float(np.count_nonzero(edges)) / max(edges.size, 1)
    if density < 0.035:
        return "The visible surface looks fairly smooth."
    if density < 0.09:
        return "The surface shows some visible detail."
    return "The surface looks quite textured or visually busy."



def _size_hint(width, height, frame_shape):
    frame_height, frame_width = frame_shape[:2]
    area_ratio = (width * height) / max(frame_height * frame_width, 1)
    if area_ratio < 0.02:
        return "small", area_ratio
    if area_ratio < 0.08:
        return "medium-sized", area_ratio
    if area_ratio < 0.16:
        return "large", area_ratio
    return "very large", area_ratio


def _vertical_position_label(y1, y2, frame_shape):
    frame_height = frame_shape[0]
    center_y = (y1 + y2) / 2
    if center_y < frame_height * 0.33:
        return "upper"
    if center_y > frame_height * 0.68:
        return "lower"
    return "middle"


def _position_phrase(item, frame_shape):
    zone = item.get("zone") or "center"
    x1, y1, x2, y2 = [int(value) for value in item.get("xyxy", [0, 0, 0, 0])]
    vertical = _vertical_position_label(y1, y2, frame_shape)

    if zone == "center":
        if vertical == "middle":
            return "near the middle of the view"
        return f"{vertical} and straight ahead"
    side = "left side" if zone == "left" else "right side"
    if vertical == "middle":
        return f"on the {side}"
    return f"on the {vertical} {side}"


def _door_like_hint(frame):
    if frame is None or not hasattr(frame, "shape") or getattr(frame, "size", 0) == 0:
        return {"status": "unavailable", "message": "", "confidence": "low"}

    frame_height, frame_width = frame.shape[:2]
    frame_area = max(frame_height * frame_width, 1)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), dtype=np.uint8), iterations=1)
    contours, _hierarchy = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best = None
    for contour in contours:
        contour_area = cv2.contourArea(contour)
        if contour_area <= frame_area * 0.05:
            continue

        x, y, width, height = cv2.boundingRect(contour)
        box_area = max(width * height, 1)
        area_ratio = box_area / frame_area
        aspect_ratio = width / max(height, 1)
        fill_ratio = contour_area / box_area
        height_ratio = height / max(frame_height, 1)
        width_ratio = width / max(frame_width, 1)

        if not (0.22 <= aspect_ratio <= 0.9):
            continue
        if height_ratio < 0.32 or width_ratio < 0.12:
            continue
        if not (0.06 <= area_ratio <= 0.58):
            continue
        if fill_ratio < 0.42:
            continue

        center_x = x + (width / 2)
        centrality = 1.0 - min(abs(center_x - (frame_width / 2)) / max(frame_width / 2, 1), 1.0)
        score = (area_ratio * 2.2) + height_ratio + fill_ratio + centrality + max(0.0, 0.8 - aspect_ratio)
        if best is None or score > best["score"]:
            best = {
                "xyxy": [x, y, x + width, y + height],
                "zone": _zone_for_box(x, x + width, frame_width),
                "score": score,
            }

    if not best:
        return {"status": "not_found", "message": "", "confidence": "low"}

    confidence = "high" if best["score"] >= 3.5 else "medium"
    position = _position_phrase(best, frame.shape)
    return {
        "status": "found",
        "message": f"I can also see a door-like vertical surface {position}.",
        "confidence": confidence,
        "xyxy": best["xyxy"],
        "zone": best["zone"],
    }


def _primary_object_hint(scene, frame=None):
    primary = _sorted_indoor_landmarks(scene, limit=1)
    if not primary:
        return "I do not see one strong indoor object directly in front of you yet."

    item = primary[0]
    label = _clean_label(item.get("class_name"))
    frame_shape = frame.shape if frame is not None and hasattr(frame, "shape") else (480, 640, 3)
    position = _position_phrase(item, frame_shape)
    steps = item.get("steps_away")
    message = f"The main visible object looks like a {label} {position}."
    if steps:
        message += f" It is about {steps} step{'s' if steps != 1 else ''} away."
    return message


def _build_discovery_summary(scene, frame, room_guess, ocr_result=None, door_hint=None):
    parts = [_primary_object_hint(scene, frame)]
    if door_hint and door_hint.get("status") == "found":
        parts.append(door_hint["message"])

    if ocr_result and ocr_result.get("status") == "found":
        parts.append(ocr_result["message"])
        if ocr_result.get("room_hint"):
            parts.append(f"That likely means this is the {ocr_result['room_hint']}.")
    elif room_guess.get("confidence") in {"medium", "high"}:
        parts.append(room_guess["certainty"])

    return " ".join(part.strip() for part in parts if part).strip()



def _describe_single_object(item, frame):
    label = _clean_label(item.get("class_name"))
    x1, y1, x2, y2 = [int(value) for value in item.get("xyxy", [0, 0, 0, 0])]
    width = max(x2 - x1, 1)
    height = max(y2 - y1, 1)
    frame_shape = frame.shape if frame is not None else (CAMERA_HEIGHT if 'CAMERA_HEIGHT' in globals() else 480, CAMERA_WIDTH if 'CAMERA_WIDTH' in globals() else 640, 3)
    frame_height, frame_width = frame_shape[:2]
    size_label, area_ratio = _size_hint(width, height, frame_shape)
    position = _position_phrase(item, frame_shape)
    steps = item.get("steps_away")
    crop = _crop_from_item(frame, item)
    color = _color_phrase(crop)
    shape = _shape_hint(label, width, height)
    orientation = _orientation_hint(width, height)
    texture = _texture_hint(crop)
    usage_hint = OBJECT_USAGE_HINTS.get(label, "")
    coverage = max(1, int(round(area_ratio * 100)))
    width_share = max(1, int(round((width / max(frame_width, 1)) * 100)))
    height_share = max(1, int(round((height / max(frame_height, 1)) * 100)))

    parts = [f"The {label} is {position}."]
    if color:
        parts.append(f"It looks mostly {color} in this view.")
    parts.append(f"Its shape looks {shape}.")
    parts.append(orientation)
    parts.append(
        f"It spans about {width_share} percent of the frame width and {height_share} percent of the frame height, "
        f"so it appears {size_label} and covers about {coverage} percent of the full view."
    )
    if steps:
        parts.append(f"It is about {steps} step{'s' if steps != 1 else ''} away.")
    if texture:
        parts.append(texture)
    if usage_hint:
        parts.append(usage_hint)
    return " ".join(part.strip() for part in parts if part).strip()



def _describe_visible_scene(scene, frame, limit=3):
    targets = _sorted_indoor_landmarks(scene, limit=limit)
    if not targets:
        return "I do not see a clear object to describe yet."

    intro = f"I can see {_format_counts(_scene_counts(scene))} in front of you."
    details = " ".join(_describe_single_object(item, frame) for item in targets)
    return f"{intro} {details}".strip()



def _ocr_is_available():
    return pytesseract is not None and bool(_resolve_tesseract_cmd())


def _expand_box(xyxy, frame_shape, x_margin_ratio=0.05, y_margin_ratio=0.05):
    if not xyxy or len(xyxy) != 4:
        return None

    frame_height, frame_width = frame_shape[:2]
    x1, y1, x2, y2 = [int(value) for value in xyxy]
    width = max(x2 - x1, 1)
    height = max(y2 - y1, 1)
    pad_x = int(width * x_margin_ratio)
    pad_y = int(height * y_margin_ratio)
    return [
        max(0, x1 - pad_x),
        max(0, y1 - pad_y),
        min(frame_width, x2 + pad_x),
        min(frame_height, y2 + pad_y),
    ]


def _clean_ocr_lines(raw_text):
    lines = []
    seen = set()
    for line in str(raw_text or "").splitlines():
        cleaned = re.sub(r"\s+", " ", line).strip(" -_|:/\\")
        alnum_count = sum(char.isalnum() for char in cleaned)
        if alnum_count < 3:
            continue
        normalized = cleaned.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        lines.append(cleaned)
    return lines



def _prepare_ocr_regions(frame, door_hint=None):
    if frame is None or getattr(frame, "size", 0) == 0:
        return []

    frame_height, frame_width = frame.shape[:2]
    regions = [{"name": "full_frame", "image": frame, "priority": 0.45}]

    def add_region(name, xyxy, priority):
        crop = _crop_from_item(frame, {"xyxy": xyxy})
        if crop is None or getattr(crop, "size", 0) == 0:
            return
        crop_height, crop_width = crop.shape[:2]
        if crop_height < 24 or crop_width < 40:
            return
        regions.append({"name": name, "image": crop, "priority": priority})

    add_region(
        "upper_center",
        [
            int(frame_width * 0.1),
            int(frame_height * 0.04),
            int(frame_width * 0.9),
            int(frame_height * 0.46),
        ],
        0.92,
    )
    add_region(
        "center",
        [
            int(frame_width * 0.1),
            int(frame_height * 0.14),
            int(frame_width * 0.9),
            int(frame_height * 0.82),
        ],
        0.72,
    )

    if door_hint and door_hint.get("status") == "found":
        expanded = _expand_box(door_hint.get("xyxy"), frame.shape, 0.06, 0.05)
        if expanded:
            add_region("door_panel", expanded, 1.05)
            x1, y1, x2, y2 = expanded
            width = max(x2 - x1, 1)
            height = max(y2 - y1, 1)
            add_region(
                "door_upper",
                [
                    x1 + int(width * 0.08),
                    y1 + int(height * 0.03),
                    x2 - int(width * 0.08),
                    y1 + int(height * 0.36),
                ],
                1.28,
            )

    return regions


def _prepare_ocr_variants(image):
    if image is None or getattr(image, "size", 0) == 0:
        return []

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    scale = 3.0 if min(gray.shape[:2]) < 160 else 2.0
    enlarged = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    clahe = cv2.createCLAHE(clipLimit=2.4, tileGridSize=(8, 8)).apply(enlarged)
    denoised = cv2.bilateralFilter(clahe, 7, 45, 45)
    blurred = cv2.GaussianBlur(denoised, (3, 3), 0)
    sharpened = cv2.addWeighted(denoised, 1.5, blurred, -0.5, 0)
    binary = cv2.threshold(sharpened, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    binary_inverse = cv2.threshold(sharpened, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    adaptive = cv2.adaptiveThreshold(
        sharpened,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        11,
    )
    return [sharpened, binary, binary_inverse, adaptive]


def _parse_ocr_confidence(value):
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.0
    if confidence < 0:
        return 0.0
    return min(max(confidence / 100.0, 0.0), 1.0)


def _collect_lines_from_ocr_data(data):
    if not isinstance(data, dict):
        return []

    texts = data.get("text")
    if not isinstance(texts, list):
        return []

    block_values = data.get("block_num") or [0] * len(texts)
    par_values = data.get("par_num") or [0] * len(texts)
    line_values = data.get("line_num") or list(range(len(texts)))
    top_values = data.get("top") or [0] * len(texts)
    left_values = data.get("left") or [0] * len(texts)
    conf_values = data.get("conf") or [0] * len(texts)
    line_buckets = {}

    for index, raw_word in enumerate(texts):
        cleaned_word = str(raw_word or "").strip()
        if sum(char.isalnum() for char in cleaned_word) < 2:
            continue

        block_num = block_values[index]
        par_num = par_values[index]
        line_num = line_values[index]
        top = int(top_values[index] or 0)
        left = int(left_values[index] or 0)
        confidence = _parse_ocr_confidence(conf_values[index])
        bucket = line_buckets.setdefault(
            (block_num, par_num, line_num),
            {"words": [], "confidences": [], "top": top, "left": left},
        )
        bucket["words"].append(cleaned_word)
        if confidence > 0:
            bucket["confidences"].append(confidence)
        bucket["top"] = min(bucket["top"], top)
        bucket["left"] = min(bucket["left"], left)

    collected = []
    for bucket in sorted(line_buckets.values(), key=lambda item: (item["top"], item["left"])):
        raw_line = " ".join(bucket["words"])
        cleaned_lines = _clean_ocr_lines(raw_line)
        if not cleaned_lines:
            continue
        avg_confidence = sum(bucket["confidences"]) / len(bucket["confidences"]) if bucket["confidences"] else 0.0
        collected.append({"text": cleaned_lines[0], "confidence": avg_confidence})
    return collected


def _score_ocr_candidate(candidate, sign_context):
    normalized = candidate["normalized_text"]
    score = candidate["region_priority"] + (candidate["confidence"] * 0.9)
    if sign_context.get("label"):
        score += 0.95
    if sign_context.get("room_hint"):
        score += 0.35
    if normalized.startswith(("room ", "ward ", "icu", "opd")):
        score += 0.2
    if len(normalized) <= 24:
        score += 0.08
    return round(score, 3)


def _confidence_label(value):
    if value >= 0.72:
        return "high"
    if value >= 0.44:
        return "medium"
    return "low"



def _call_gemini_vision(frame, prompt):
    try:
        from google import genai
        from google.genai import types
        from django.conf import settings
        import cv2
    except ImportError:
        return "Gemini SDK not available."

    api_key = getattr(settings, "GEMINI_API_KEY", "").strip()
    if not api_key:
        return "Gemini API key not configured."

    primary_model = getattr(settings, "NAVI_GEMINI_MODEL", "gemini-2.5-flash").strip()
    fallback_model = "gemini-2.0-flash-lite-preview-02-05"
    
    try:
        client = genai.Client(api_key=api_key)
        _, buffer = cv2.imencode('.jpg', frame)
        img_bytes = buffer.tobytes()
        img_part = types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg")

        try:
            # Try Primary Model
            response = client.models.generate_content(
                model=primary_model,
                contents=[img_part, prompt]
            )
            return response.text.strip()
        except Exception as e:
            error_str = str(e).lower()
            if "429" in error_str or "quota" in error_str or "exhausted" in error_str:
                print(f"[Planner] {primary_model} limit reached. Falling back to {fallback_model}...")
                response = client.models.generate_content(
                    model=fallback_model,
                    contents=[img_part, prompt]
                )
                return response.text.strip()
            else:
                raise e # Re-raise if it's not a rate limit error

    except Exception as e:
        print(f"[Planner] Gemini Vision Error: {e}")
        return f"Gemini analysis failed: {e}"

def read_visible_text(frame, door_hint=None):
    if frame is None:
        return {
            "status": "no_frame",
            "text": "",
            "message": "I do not have a clear frame for sign reading yet.",
            "room_hint": "",
            "sign_label": "",
            "sign_kind": "",
            "normalized_text": "",
            "lines": [],
            "confidence": "low",
            "source_region": "",
        }
    
    prompt = "Read any text visible in this image. Is there a room number or sign? Return only the text you see. If no text is clearly readable, reply 'No text found'."
    gemini_text = _call_gemini_vision(frame, prompt)
    
    if "No text found" in gemini_text or "Gemini" in gemini_text:
        return {
            "status": "no_text",
            "text": "",
            "message": "No clear text found.",
            "room_hint": "",
            "sign_label": "",
            "sign_kind": "",
            "normalized_text": "",
            "lines": [],
            "confidence": "low",
            "source_region": "",
        }
        
    return {
        "status": "success",
        "text": gemini_text,
        "message": f"I see: {gemini_text}",
        "room_hint": gemini_text,
        "sign_label": gemini_text,
        "sign_kind": "sign",
        "normalized_text": gemini_text,
        "lines": [gemini_text],
        "confidence": "high",
        "source_region": "gemini",
    }
def _build_find_answer(question, scene, room_guess):
    target = _extract_find_target(question, scene)
    if not target:
        visible = [_clean_label(item.get("class_name")) for item in _sorted_indoor_landmarks(scene, limit=4)]
        visible_hint = _natural_list(visible)
        hint = f" Right now I can see {visible_hint}." if visible_hint else ""
        return {
            "target": "",
            "status": "missing_target",
            "answer": "Tell me what to find, for example chair, sink, bottle, bed, phone, washroom, or a sign." + hint,
        }

    if target == "sign":
        return {
            "target": target,
            "status": "ocr_redirect",
            "answer": "Use Read Sign / Room mode to read visible letters, labels, door signs, and room names.",
        }

    if target in INDOOR_ROOM_PROFILES:
        if room_guess["key"] == target and room_guess["score"] > 0:
            return {
                "target": target,
                "status": "matched_room",
                "answer": f"{room_guess['certainty']} {room_guess['reason']}",
            }
        return {
            "target": target,
            "status": "room_not_confirmed",
            "answer": f"I cannot confirm a {INDOOR_ROOM_PROFILES[target]['label']} from this frame yet. {room_guess['certainty']} {room_guess['reason']}",
        }

    matches = _match_visible_objects(target, scene)
    if not matches:
        return {
            "target": target,
            "status": "not_found",
            "answer": f"I cannot see a {target} in the current camera view yet.",
        }

    matches.sort(key=lambda item: (int(item.get("steps_away", 99)), -float(item.get("confidence", 0.0))))
    nearest = matches[0]
    zone = nearest.get("zone_label") or ZONE_LABELS.get(nearest.get("zone"), "ahead")
    steps = nearest.get("steps_away") or "a few"
    count = len(matches)
    prefix = f"I can see {count} {IRREGULAR_PLURALS.get(target, target + 's')}" if count > 1 else f"I can see a {target}"
    answer = f"{prefix}. The nearest one is on the {zone}, about {steps} step{'s' if steps != 1 else ''} away."
    return {"target": target, "status": "found", "answer": answer}



def _build_describe_answer(question, scene, frame, room_guess):
    lowered = (question or "").strip().lower()
    target = _extract_find_target(question, scene)
    text_request = any(token in lowered for token in ["sign", "text", "read", "written", "letter", "label", "door"]) if lowered else False

    if text_request or target == "sign":
        text_result = read_visible_text(frame)
        if text_result["status"] == "found":
            if text_result["room_hint"]:
                return f"{text_result['message']} That likely means this is the {text_result['room_hint']}."
            return text_result["message"]
        return text_result["message"]

    if target in INDOOR_ROOM_PROFILES:
        if room_guess["key"] == target and room_guess["score"] > 0:
            return f"{room_guess['certainty']} {room_guess['reason']}"
        return f"I cannot confirm a {INDOOR_ROOM_PROFILES[target]['label']} from this frame yet. {room_guess['certainty']} {room_guess['reason']}"

    if target:
        matches = _match_visible_objects(target, scene)
        if matches:
            matches.sort(key=lambda item: (int(item.get("steps_away", 99)), -float(item.get("confidence", 0.0))))
            return _describe_single_object(matches[0], frame)
        primary = _sorted_indoor_landmarks(scene, limit=1)
        if primary:
            return (
                f"I cannot confirm a {target} clearly from this frame. "
                f"The most visible object I can describe right now is this: {_describe_single_object(primary[0], frame)}"
            )
        return f"I cannot see a {target} clearly enough to describe it right now."

    if any(token in lowered for token in ["everything", "all", "whole scene", "around me", "front of me"]) or not lowered:
        return _describe_visible_scene(scene, frame, limit=3)

    primary = _sorted_indoor_landmarks(scene, limit=1)
    if primary:
        return _describe_single_object(primary[0], frame)
    return "I do not see a strong object to describe yet."



INDOOR_OCR_IDLE_MESSAGE = "Text reading stays off until you ask me to read a sign or door label."
INDOOR_HAND_IDLE_MESSAGE = "Hand-sign reading stays off until you ask for it."


def _idle_ocr_result(message=INDOOR_OCR_IDLE_MESSAGE):
    return {
        "status": "idle",
        "text": "",
        "message": message,
        "room_hint": "",
        "sign_label": "",
        "sign_kind": "",
        "normalized_text": "",
        "lines": [],
        "confidence": "low",
        "source_region": "",
    }


def _idle_hand_result(message=INDOOR_HAND_IDLE_MESSAGE):
    return {
        "status": "idle",
        "label": "",
        "message": message,
        "category": "",
        "confidence": "low",
        "meaning": "",
        "handedness": "",
        "raised_count": 0,
        "raised_fingers": [],
    }


def _indoor_prompt_flags(prompt, selected_mode, target):
    lowered_prompt = (prompt or "").strip().lower()
    text_tokens = ("text", "read", "written", "letter", "label", "board", "sign", "door")
    hand_tokens = ("hand sign", "gesture", "thumbs up", "palm", "fingers", "alphabet", "letter")

    wants_hand_read = selected_mode == "gesture" or any(token in lowered_prompt for token in hand_tokens)
    wants_text_read = (selected_mode == "room" or target == "sign" or any(token in lowered_prompt for token in text_tokens)) and not wants_hand_read
    wants_describe = any(
        token in lowered_prompt for token in ("describe", "detail", "look like", "color", "shape", "holding", "what am i holding")
    )
    return {
        "wants_text_read": wants_text_read,
        "wants_hand_read": wants_hand_read,
        "wants_describe": wants_describe,
    }


def build_indoor_insight(scene, mode, frame=None, include_door=False, include_ocr=False, include_hand=False):
    room_guess = infer_indoor_room(scene)
    landmarks = [_format_landmark(item) for item in _sorted_indoor_landmarks(scene, limit=4)]
    include_door = bool(include_door or include_ocr)
    door_hint = _door_like_hint(frame) if include_door else {
        "status": "idle",
        "message": "",
        "confidence": "low",
    }
    ocr_result = read_visible_text(frame, door_hint=door_hint) if include_ocr else _idle_ocr_result()
    hand_result = detect_hand_sign(frame) if include_hand else _idle_hand_result()

    if include_ocr and ocr_result["status"] == "found":
        sign_support = ocr_result["message"]
        if ocr_result["room_hint"]:
            sign_support += f" That likely points to the {ocr_result['room_hint']}."
    else:
        sign_support = ocr_result["message"]
        if include_door and door_hint.get("status") == "found":
            sign_support = f"{door_hint['message']} {sign_support}".strip()

    focus_tip_map = {
        "navigator": "Use Indoor Navigator for everyday indoor help. It combines layout exploration, room/sign reading, object finding, and hand-sign reading in one place.",
        "explore": "Use this mode to discover what is in front of you, including the main object, doorway clues, visible text, and the safer side to move.",
        "room": "Use this mode when you want room clues, visible text, door labels, or sign guidance.",
        "find": "Use this mode when you want one object or place cue such as chair, bottle, sink, or washroom.",
        "describe": "Use this mode when you want a full description of one object or of the visible scene, including color, shape, size, and position.",
        "gesture": "Use this mode when a hand is visible and you want the assistant to interpret a static hand sign, finger-count gesture, or a small letter vocabulary such as A, B, D, I, L, V, W, or Y.",
    }
    return {
        "mode_label": INDOOR_MODE_LABELS.get(mode, "Explore"),
        "layout_summary": _build_layout_summary(scene),
        "room_estimate": room_guess,
        "visible_landmarks": landmarks,
        "focus_tip": focus_tip_map.get(mode, focus_tip_map["explore"]),
        "sign_support": sign_support,
        "ocr_result": ocr_result,
        "door_hint": door_hint,
        "discovery_preview": _build_discovery_summary(
            scene,
            frame,
            room_guess,
            ocr_result if include_ocr else None,
            door_hint if include_door else None,
        ),
        "hand_result": hand_result,
    }



def answer_indoor_question(question, scene, mode="explore", frame=None):
    selected_mode = mode if mode in INDOOR_MODE_LABELS else "navigator"
    prompt = (question or "").strip()
    lowered_prompt = prompt.lower()
    working_mode = selected_mode
    target = _extract_find_target(prompt, scene)
    prompt_flags = _indoor_prompt_flags(prompt, selected_mode, target)

    if selected_mode == "navigator":
        if prompt and prompt_flags["wants_describe"]:
            insight = build_indoor_insight(scene, selected_mode, frame)
            answer = (
                "For a full visual description with color, shape, and size details, use the separate Describe page. "
                f"Right now: {insight['discovery_preview']}"
            )
            insight["resolved_mode"] = "navigator"
            return {
                "question": prompt,
                "mode": selected_mode,
                "answer": answer.strip(),
                "insight": insight,
            }
        if prompt and prompt_flags["wants_hand_read"]:
            working_mode = "gesture"
        elif target == "sign" or target in INDOOR_ROOM_PROFILES or any(
            token in lowered_prompt for token in ["text", "read", "written", "letter", "label", "door", "room", "washroom", "kitchen", "reception"]
        ):
            working_mode = "room"
        elif target:
            working_mode = "find"
        else:
            working_mode = "explore"

    include_ocr = prompt_flags["wants_text_read"] and frame is not None
    include_hand = prompt_flags["wants_hand_read"] and frame is not None
    include_door = include_ocr and frame is not None
    insight = build_indoor_insight(
        scene,
        selected_mode,
        frame,
        include_door=include_door,
        include_ocr=include_ocr,
        include_hand=include_hand,
    )
    room_guess = insight["room_estimate"]

    if selected_mode == "navigator":
        insight["resolved_mode"] = working_mode
        insight["resolved_mode_label"] = INDOOR_MODE_LABELS.get(working_mode, "Explore")

    if working_mode == "find":
        result = _build_find_answer(prompt, scene, room_guess)
        insight["find_result"] = result
        return {
            "question": prompt,
            "mode": selected_mode,
            "answer": result["answer"],
            "insight": insight,
        }

    if working_mode == "describe":
        answer = _build_describe_answer(prompt, scene, frame, room_guess)
        insight["describe_preview"] = answer
        return {
            "question": prompt,
            "mode": selected_mode,
            "answer": answer,
            "insight": insight,
        }

    if working_mode == "gesture":
        hand_result = insight["hand_result"]
        lowered = lowered_prompt
        if hand_result["status"] == "found":
            answer = hand_result["message"]
            if any(token in lowered for token in ["which hand", "left hand", "right hand"]):
                answer += f" It appears to be the {hand_result.get('handedness', 'unknown')} hand."
            if any(token in lowered for token in ["how many", "count", "finger"]):
                answer += f" I can see about {hand_result.get('raised_count', 0)} raised finger"
                answer += "s." if hand_result.get("raised_count", 0) != 1 else "."
            if any(token in lowered for token in ["letter", "alphabet"]):
                if hand_result.get("category") == "alphabet":
                    answer += f" I would describe it as {hand_result.get('meaning', 'a likely alphabet sign')}."
                else:
                    answer += " This looks more like a common hand gesture than a specific alphabet letter."
            if any(token in lowered for token in ["mean", "meaning", "what does this sign mean"]):
                meaning_text = hand_result.get("meaning")
                if meaning_text:
                    answer += f" Its likely meaning is {meaning_text}."
            if any(token in lowered for token in ["confidence", "sure", "certain", "how sure"]):
                answer += f" My confidence is {hand_result.get('confidence', 'medium')}."
        else:
            answer = hand_result["message"]
            if hand_result["status"] == "unavailable":
                answer += " Install mediapipe to enable this mode."
            answer += f" {HAND_SIGN_SUPPORT_MESSAGE}"

        return {
            "question": prompt,
            "mode": selected_mode,
            "answer": answer.strip(),
            "insight": insight,
        }

    if working_mode == "room":
        lowered = lowered_prompt
        ocr_result = insight["ocr_result"]
        if any(token in lowered for token in ["sign language", "gesture", "hand sign"]):
            answer = (
                "This mode reads printed signs, labels, room names, and visible text from the camera. "
                "Use Hand Sign mode for visible hand gestures or a small static alphabet-sign vocabulary."
            )
        elif not prompt or any(token in lowered for token in ["sign", "text", "read", "board", "written", "letter", "label", "door"]):
            if ocr_result["status"] == "found":
                answer = ocr_result["message"]
                if ocr_result["room_hint"]:
                    answer += f" That likely means this is the {ocr_result['room_hint']}."
                else:
                    answer += f" {room_guess['certainty']} {room_guess['reason']}"
            else:
                answer = f"{ocr_result['message']} {room_guess['certainty']} {room_guess['reason']}"
        elif prompt:
            target = _extract_find_target(prompt, scene)
            if target in INDOOR_ROOM_PROFILES:
                if room_guess["key"] == target:
                    answer = f"Yes. {room_guess['certainty']} {room_guess['reason']}"
                else:
                    answer = f"I cannot confirm a {INDOOR_ROOM_PROFILES[target]['label']} from this frame. {room_guess['certainty']} {room_guess['reason']}"
            else:
                answer = f"{room_guess['certainty']} {room_guess['reason']} {insight['sign_support']}"
        else:
            answer = f"{room_guess['certainty']} {room_guess['reason']} {insight['sign_support']}"
        return {
            "question": prompt,
            "mode": selected_mode,
            "answer": answer.strip(),
            "insight": insight,
        }

    if prompt and any(token in lowered_prompt for token in ["safe", "clear", "obstacle", "direction", "avoid"]):
        answer = answer_scene_question(prompt, scene)["answer"]
    elif prompt and any(token in lowered_prompt for token in ["describe", "detail", "look like", "what is it", "what is this", "what am i holding", "holding", "everything", "all", "color", "shape"]):
        answer = _build_describe_answer(prompt, scene, frame, room_guess)
    elif prompt and any(token in lowered_prompt for token in ["text", "read", "written", "letter", "sign", "door"]):
        ocr_result = insight["ocr_result"]
        if ocr_result.get("status") == "found":
            answer = ocr_result["message"]
            if ocr_result.get("room_hint"):
                answer += f" That likely means this is the {ocr_result['room_hint']}."
            elif insight["door_hint"].get("status") == "found":
                answer += f" {insight['door_hint']['message']}"
        elif insight["door_hint"].get("status") == "found":
            answer = f"{insight['door_hint']['message']} I cannot read clear text from it yet."
        else:
            answer = "I do not see clear readable text or a strong door-like surface in this frame yet."
    elif prompt and any(token in lowered_prompt for token in ["front of me", "around me", "what do you see", "what is ahead", "what is near", "nearest object", "closest object", "main object"]):
        answer = insight["discovery_preview"]
    elif prompt:
        answer = f"{insight['discovery_preview']} {insight['layout_summary']}".strip()
    else:
        answer = insight["discovery_preview"]

    return {
        "question": prompt,
        "mode": selected_mode,
        "answer": answer.strip(),
        "insight": insight,
    }
