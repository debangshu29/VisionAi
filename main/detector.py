import os
import threading
import time
import queue
from pathlib import Path

import cv2
import numpy as np

from .planner import build_scene_guidance
from .stabilizer import SceneStabilizer, reset_stabilizer
from .tracker import reset_tracker, update_tracker, get_active_tracker_name
from .traversability import TraversabilityEstimator, reset_traversability
from .policy import FeedbackPolicy

try:
    import torch
except ImportError:  # pragma: no cover - depends on local environment
    torch = None

try:
    from ultralytics import YOLO
except ImportError:  # pragma: no cover - depends on local environment
    YOLO = None


CONF_THRESH = 0.26
ANNOT_JPEG_QUALITY = 62
CAMERA_INDEX_DEFAULT = 0
CAMERA_WIDTH = 640
CAMERA_HEIGHT = 480
CAMERA_TARGET_FPS = 30
CAPTURE_SLEEP_SECONDS = 0.001
PROCESS_IDLE_SLEEP_SECONDS = 0.001
MAX_ANNOTATED_OBSTACLES = 6
SAFETY_CONF_THRESH = 0.28
SAFETY_IMAGE_SIZE_CPU = 192
SAFETY_IMAGE_SIZE_GPU = 512
FULL_IMAGE_SIZE_CPU = 192
FULL_IMAGE_SIZE_GPU = 640
HAZARD_IMAGE_SIZE_CPU = 256
SAFETY_MAX_DET = 18
FULL_MAX_DET = 40
FULL_SCENE_CACHE_TTL_SECONDS = 1.0
UNKNOWN_OBSTACLE_MIN_AREA_RATIO = 0.045
UNKNOWN_OBSTACLE_MIN_WIDTH_RATIO = 0.12
UNKNOWN_OBSTACLE_MIN_HEIGHT_RATIO = 0.14
UNKNOWN_OBSTACLE_MIN_BOTTOM_RATIO = 0.55
UNKNOWN_OBSTACLE_MAX_DETECTIONS = 3
UNKNOWN_OBSTACLE_DUPLICATE_IOU = 0.25

SAFETY_CLASS_NAMES = (
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "bus",
    "train",
    "truck",
    "traffic light",
    "fire hydrant",
    "stop sign",
    "parking meter",
    "bench",
    "cat",
    "dog",
    "backpack",
    "umbrella",
    "handbag",
    "suitcase",
    "bottle",
    "cup",
    "chair",
    "couch",
    "potted plant",
    "bed",
    "dining table",
    "toilet",
    "tv",
    "laptop",
    "mouse",
    "remote",
    "keyboard",
    "cell phone",
    "microwave",
    "oven",
    "sink",
    "refrigerator",
    "book",
    "clock",
    "vase",
    "scissors",
    "toothbrush",
)

ALLOWED_CLASSES = None

# Use .pt files (PyTorch) – faster than OpenVINO on this CPU at 320x320
MODEL_BASE_PATH = Path(__file__).resolve().parent.parent / "yolov8n.pt"
MODEL_HAZARD_PATH = Path(__file__).resolve().parent.parent / "models" / "custom_hazard_model.pt"

# Hazard model runs every Nth frame to save CPU; cached results fill the gap
HAZARD_RUN_EVERY_N = 6


def _resolve_model_path() -> Path:
    """Return the resolved path to the base YOLO model file.

    Used by tests to verify the expected model is on disk without
    instantiating a full CameraProcessor.
    """
    return MODEL_BASE_PATH

cv2.setUseOptimized(True)


class CameraProcessor:
    def __init__(self, camera_index=CAMERA_INDEX_DEFAULT, ablation_level=4):
        self.ablation_level = ablation_level
        import torch
        torch.set_num_threads(2)
        self.model_base_path = MODEL_BASE_PATH
        self.model_hazard_path = MODEL_HAZARD_PATH
        self.conf_thresh = CONF_THRESH
        self.allowed = ALLOWED_CLASSES
        self.allowed_ids = None
        self.safety_allowed = SAFETY_CLASS_NAMES
        self.safety_allowed_ids = None
        self.camera_index = camera_index
        self.device = "cpu"
        self.use_half = False
        self.safety_image_size = 160
        self.full_image_size = 160
        self.hazard_image_size = 160
        self.model_lock = threading.Lock()
        self.start_lock = threading.Lock()
        
        # ── Depth Model (MiDaS) ──
        # Initialized lazily in _ensure_model to prevent multiprocessing OOM on boot
        self.midas = None
        self.midas_transform = None
        self._cached_depth_map = None
        
        self.model_base = None
        self.model_hazard = None
        self._hazard_frame_counter = 0
        self._cached_hazard_dets = []
        self.logic_queue = queue.Queue(maxsize=1)
        self.context_queue = queue.Queue(maxsize=1)

        self.cap = None
        self.capture_thread = None
        self.inference_thread = None
        self.logic_thread = None
        self.context_thread = None
        self.running = False

        self.lock = threading.Lock()
        self.frame_lock = threading.Lock()
        self.latest_frame = None
        self.latest_frame_number = 0
        self.last_processed_frame_number = 0

        self.latest_annotated_jpeg = None
        self.latest_detections = []
        self.latest_guidance = build_scene_guidance([], (CAMERA_HEIGHT, CAMERA_WIDTH, 3))
        self.latest_context_detections = []
        self.latest_context_scene = build_scene_guidance([], (CAMERA_HEIGHT, CAMERA_WIDTH, 3))
        self.latest_timestamp = 0.0
        self.latest_context_timestamp = 0.0
        self.latest_error = ""
        self.latest_processing_ms = 0.0
        self.latest_processing_fps = 0.0
        self.latest_context_processing_ms = 0.0
        self.latest_context_processing_fps = 0.0
        self.last_full_scene = None
        self.last_full_scene_frame_number = 0
        self.last_full_scene_at = 0.0
        self._last_safety_finished_at = 0.0
        self._last_full_finished_at = 0.0

        # Temporal stabilizer – keeps short-term frame memory so that
        # alert commands (STOP / SLOW / CLEAR) do not flicker between frames.
        self._stabilizer = SceneStabilizer()
        
        # Spatial traversability estimator – predicts walkable corridors.
        self._traversability = TraversabilityEstimator()

        # User-centric Feedback Policy
        self._policy = FeedbackPolicy()

    def _choose_device(self):
        if torch is not None and torch.cuda.is_available():
            self.device = "cuda:0"
            self.use_half = True
            self.safety_image_size = SAFETY_IMAGE_SIZE_GPU
            self.full_image_size = FULL_IMAGE_SIZE_GPU
            torch.backends.cudnn.benchmark = True
        else:
            self.device = "cpu"
            self.use_half = False
            self.safety_image_size = SAFETY_IMAGE_SIZE_CPU
            self.full_image_size = FULL_IMAGE_SIZE_CPU
            self.hazard_image_size = HAZARD_IMAGE_SIZE_CPU

    def _ensure_model(self):
        if self.model_base is not None and self.model_hazard is not None:
            return
        with self.model_lock:
            if self.model_base is not None and self.model_hazard is not None:
                return
            if YOLO is None:
                raise RuntimeError("The 'ultralytics' package is not installed in this environment.")

            self._choose_device()
            
            # OpenVINO manages its own threading – do NOT restrict with torch.set_num_threads

            # Load Base Model (COCO)
            self.model_base = YOLO(str(self.model_base_path), task="detect")
            try:
                self.model_base.fuse()
            except Exception:
                pass
                
            # Load Hazard Model (14 custom classes)
            self.model_hazard = YOLO(str(self.model_hazard_path), task="detect")
            try:
                self.model_hazard.fuse()
            except Exception:
                pass
                
            # Load Depth Model (MiDaS)
            try:
                self.midas = torch.hub.load("intel-isl/MiDaS", "MiDaS_small", trust_repo=True)
                self.midas.eval()
                if self.device.startswith("cuda"):
                    self.midas = self.midas.to(self.device)
                midas_transforms = torch.hub.load("intel-isl/MiDaS", "transforms", trust_repo=True)
                self.midas_transform = midas_transforms.small_transform
            except Exception as e:
                self.midas = None
                print(f"Failed to load MiDaS depth model lazily: {e}")

            names_base = getattr(self.model_base, "names", {}) or {}
            self.safety_allowed_ids = [class_id for class_id, name in names_base.items() if name in self.safety_allowed]

    def _open_camera(self):
        backends = [cv2.CAP_DSHOW, None] if os.name == "nt" else [None]
        
        # Try primary index then secondary
        for idx in [self.camera_index, 1 - self.camera_index if self.camera_index < 2 else None]:
            if idx is None:
                continue
                
            for backend in backends:
                try:
                    if backend is not None:
                        cap = cv2.VideoCapture(idx, backend)
                    else:
                        cap = cv2.VideoCapture(idx)
                        
                    if not cap.isOpened():
                        continue
                        
                    # Verify we can actually read a frame
                    cap.set(cv2.CAP_PROP_FRAME_WIDTH, CAMERA_WIDTH)
                    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CAMERA_HEIGHT)
                    ret, _ = cap.read()
                    if not ret:
                        cap.release()
                        continue
                        
                    # Successfully opened and verified
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
                    cap.set(cv2.CAP_PROP_FPS, CAMERA_TARGET_FPS)
                    return cap
                except Exception as e:
                    print(f"[CameraProcessor] Failed to open camera idx {idx} with backend {backend}: {e}")
                    continue

        raise RuntimeError(f"Cannot open a working camera at index {self.camera_index} (tried fallback index and backends)")

    def start(self):
        with self.start_lock:
            if self.running:
                return

            reset_tracker()
            reset_stabilizer()
            reset_traversability()
            self._stabilizer.reset()
            self.cap = self._open_camera()
            self.running = True

            self.capture_thread = threading.Thread(target=self._capture_loop, daemon=True, name="CaptureThread")
            self.inference_thread = threading.Thread(target=self._inference_loop, daemon=True, name="InferenceThread")
            self.logic_thread = threading.Thread(target=self._logic_loop, daemon=True, name="LogicThread")
            self.context_thread = threading.Thread(target=self._context_loop, daemon=True, name="ContextThread")

            self.capture_thread.start()
            self.inference_thread.start()
            self.logic_thread.start()
            self.context_thread.start()

    def stop(self):
        self.running = False
        if self.capture_thread:
            self.capture_thread.join(timeout=1.0)
        if self.inference_thread:
            self.inference_thread.join(timeout=1.0)
        if self.logic_thread:
            self.logic_thread.join(timeout=1.0)
        if self.context_thread:
            self.context_thread.join(timeout=1.0)
        if self.cap:
            self.cap.release()
        self.cap = None

    def _store_error(self, message):
        with self.lock:
            self.latest_error = message
            self.latest_guidance = {
                **self.latest_guidance,
                "summary": message,
                "spoken_message": message,
            }

    def _apply_policy_result(self, scene, policy_result):
        command = (policy_result or {}).get("command")
        if not command:
            return scene

        scene["_policy_command"] = command
        scene["_policy_should_speak"] = bool((policy_result or {}).get("should_speak", True))

        if command == scene.get("command"):
            return scene

        primary = scene.get("primary_obstacle") or {}
        safe_direction = scene.get("safe_direction", "forward")
        obstacle_name = primary.get("class_name", "object")
        steps = scene.get("estimated_clear_steps") or primary.get("steps_away") or 2

        scene["command"] = command
        scene["path_clear"] = command == "CLEAR"

        if command == "CLEAR":
            scene["urgency"] = "low"
            scene["safe_direction"] = "forward"
            scene["summary"] = "Path seems clear after recent checks."
            scene["spoken_message"] = "Path seems clear. Continue forward and scan again in four steps."
        elif command == "CAUTION: OBJECTS UNCLEAR":
            scene["urgency"] = "medium"
            scene["path_clear"] = False
            scene["summary"] = "Unclear objects are visible. Slow down and scan again."
            scene["spoken_message"] = "Caution. Objects are unclear. Slow down and scan again before moving."
        elif command == "STOP":
            scene["urgency"] = "critical"
            scene["path_clear"] = False
            if safe_direction == "wait":
                scene["spoken_message"] = f"Stop. {obstacle_name} very close ahead. Wait and scan again."
            else:
                scene["spoken_message"] = (
                    f"Stop. {obstacle_name} very close ahead. Move {safe_direction} in about "
                    f"{steps} step{'s' if steps != 1 else ''}."
                )
            scene["summary"] = scene["spoken_message"]
        elif command == "SLOW":
            scene["urgency"] = "high"
            scene["path_clear"] = False
            scene["summary"] = f"{obstacle_name.title()} is close enough to require slower movement."
            scene["spoken_message"] = f"Slow down. {obstacle_name} is nearby. Safest direction is {safe_direction}."
        elif command in {"MOVE_LEFT", "MOVE_RIGHT"}:
            turn_direction = "left" if command == "MOVE_LEFT" else "right"
            scene["urgency"] = "high"
            scene["path_clear"] = False
            scene["safe_direction"] = turn_direction
            scene["summary"] = f"{obstacle_name.title()} is blocking one side. Move {turn_direction}."
            scene["spoken_message"] = (
                f"Move {turn_direction}. {obstacle_name} is nearby. Take about "
                f"{steps} careful step{'s' if steps != 1 else ''}."
            )

        urgency_colors = {
            "low": "#2d7a52",
            "medium": "#bf7b1d",
            "high": "#b04831",
            "critical": "#8e2a22",
        }
        scene["palette"] = {"urgency": urgency_colors.get(scene.get("urgency"), "#2d7a52")}
        return scene

    def _capture_loop(self):
        failed_reads = 0
        while self.running:
            if self.cap is None:
                time.sleep(0.5)
                continue
                
            ret, frame = self.cap.read()
            if not ret:
                failed_reads += 1
                if failed_reads > 100:  # ~3 seconds of failure
                    self._store_error("Camera hardware is not providing frames. Check if another app is using it.")
                    failed_reads = 0 # reset to avoid spamming but keep warning
                time.sleep(CAPTURE_SLEEP_SECONDS)
                continue

            failed_reads = 0
            with self.frame_lock:
                self.latest_frame = frame
                self.latest_frame_number += 1

    def _extract_detections(self, model, results, conf_thresh=None, allowed=None):
        threshold = self.conf_thresh if conf_thresh is None else conf_thresh
        allowed_names = allowed
        detections = []
        for result in results:
            for box in result.boxes:
                try:
                    xyxy = box.xyxy[0].cpu().numpy().astype(int).tolist()
                    conf = float(box.conf[0].cpu().numpy())
                    cls = int(box.cls[0].cpu().numpy())
                except Exception:
                    # Fallback for different tensor formats
                    xyxy = box.xyxy[0].numpy().astype(int).tolist()
                    conf = float(box.conf[0])
                    cls = int(box.cls[0])

                class_name = model.names.get(cls, str(cls))
                if conf < threshold:
                    continue
                if allowed_names is not None and class_name not in allowed_names:
                    continue

                detections.append(
                    {
                        "xyxy": [int(value) for value in xyxy],
                        "conf": round(conf, 4),
                        "class_name": class_name,
                    }
                )
        return detections

    def _box_iou(self, box_a, box_b):
        ax1, ay1, ax2, ay2 = box_a
        bx1, by1, bx2, by2 = box_b
        inter_x1 = max(ax1, bx1)
        inter_y1 = max(ay1, by1)
        inter_x2 = min(ax2, bx2)
        inter_y2 = min(ay2, by2)
        inter_w = max(0, inter_x2 - inter_x1)
        inter_h = max(0, inter_y2 - inter_y1)
        inter_area = inter_w * inter_h
        if inter_area <= 0:
            return 0.0
        area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
        area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
        union = area_a + area_b - inter_area
        if union <= 0:
            return 0.0
        return inter_area / union

    def _nms_combined(self, base_dets, hazard_dets, iou_threshold=0.45):
        """Merge detections using Class-Reliability Weighted NMS.
        Prevents weak hazard classes (like stair/door) from overriding highly confident base model classes.
        """
        # Historical mAP50 scores from training
        HAZARD_RELIABILITY = {
            "trash_bin": 0.99, "zebra_cross": 0.98, "open_drain": 0.96, 
            "puddle": 0.95, "bollard": 0.97, "window": 0.97, "traffic_cone": 0.91,
            "obstacle": 0.89, "pole": 0.84, "pothole": 0.82, "manhole": 0.78, 
            "barrier": 0.75, "door": 0.54, "stair": 0.43
        }
        
        all_dets = []
        
        # Calculate 'trust' score: detection_confidence * historical_model_reliability
        for h in hazard_dets:
            reliability = HAZARD_RELIABILITY.get(h["class_name"], 0.75)
            h["trust_score"] = h["conf"] * reliability
            all_dets.append(h)
            
        for b in base_dets:
            # Base COCO model is highly generalized and heavily trained
            b["trust_score"] = b["conf"] * 0.90 
            all_dets.append(b)
            
        # Sort by highest trust score first
        all_dets.sort(key=lambda d: d["trust_score"], reverse=True)
        
        kept_dets = []
        for det in all_dets:
            overlap = False
            for kept in kept_dets:
                if self._box_iou(det["xyxy"], kept["xyxy"]) > iou_threshold:
                    overlap = True
                    break
            if not overlap:
                kept_dets.append(det)
                
        # Clean up temp keys
        for k in kept_dets:
            k.pop("trust_score", None)
            
        # Final sort by raw confidence
        kept_dets.sort(key=lambda d: d["conf"], reverse=True)
        return kept_dets

    def _detect_unknown_obstacles(self, frame, known_detections=None):
        """Find large unnamed objects that block the walking corridor.

        This is intentionally class-agnostic. YOLO may not know a random box,
        bucket, bag, or partially visible object, but a large solid/edged region
        in the lower half of the frame should still behave as an obstacle.
        """
        known_detections = known_detections or []
        frame_height, frame_width = frame.shape[:2]
        frame_area = max(frame_height * frame_width, 1)

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(gray, 45, 120)

        lower_mask = np.zeros_like(edges)
        lower_start = int(frame_height * 0.28)
        lower_mask[lower_start:, :] = 255
        edges = cv2.bitwise_and(edges, lower_mask)

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
        closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
        closed = cv2.dilate(closed, kernel, iterations=1)

        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        candidates = []
        for contour in contours:
            contour_area = cv2.contourArea(contour)
            if contour_area <= 0:
                continue

            x, y, width, height = cv2.boundingRect(contour)
            x2 = x + width
            y2 = y + height
            bbox_area = width * height
            area_ratio = bbox_area / frame_area
            width_ratio = width / max(frame_width, 1)
            height_ratio = height / max(frame_height, 1)
            bottom_ratio = y2 / max(frame_height, 1)
            center_x = x + (width / 2.0)
            in_walking_band = frame_width * 0.18 <= center_x <= frame_width * 0.82

            if area_ratio < UNKNOWN_OBSTACLE_MIN_AREA_RATIO:
                continue
            if width_ratio < UNKNOWN_OBSTACLE_MIN_WIDTH_RATIO:
                continue
            if height_ratio < UNKNOWN_OBSTACLE_MIN_HEIGHT_RATIO:
                continue
            if bottom_ratio < UNKNOWN_OBSTACLE_MIN_BOTTOM_RATIO:
                continue
            if not in_walking_band:
                continue

            xyxy = [int(x), int(y), int(x2), int(y2)]
            overlaps_known = any(
                self._box_iou(xyxy, detection.get("xyxy", [0, 0, 0, 0])) >= UNKNOWN_OBSTACLE_DUPLICATE_IOU
                for detection in known_detections
            )
            if overlaps_known:
                continue

            candidates.append((area_ratio, xyxy))

        candidates.sort(reverse=True, key=lambda item: item[0])
        return [
            {
                "xyxy": xyxy,
                "conf": 0.38,
                "class_name": "obstacle",
                "source": "unknown_obstacle_fallback",
            }
            for _area_ratio, xyxy in candidates[:UNKNOWN_OBSTACLE_MAX_DETECTIONS]
        ]

    def _scene_from_detections(self, detections, frame_shape):
        pseudo_tracks = [
            {
                "track_id": index + 1,
                "xyxy": item["xyxy"],
                "class_name": item["class_name"],
                "confidence": item.get("conf", 0.0),
            }
            for index, item in enumerate(detections)
        ]
        return build_scene_guidance(pseudo_tracks, frame_shape)

    def _smoothed_fps(self, previous_fps, finished_at, previous_finished_at, processing_ms):
        if previous_finished_at > 0:
            elapsed = max(finished_at - previous_finished_at, 1e-6)
            instant_fps = 1.0 / elapsed
        else:
            instant_fps = 1000.0 / max(processing_ms, 1.0)

        if previous_fps <= 0:
            return instant_fps
        return (previous_fps * 0.72) + (instant_fps * 0.28)

    def _annotate_frame(self, frame, scene):
        annotated = frame.copy()
        color = tuple(int(scene["palette"]["urgency"].lstrip("#")[index : index + 2], 16) for index in (4, 2, 0))

        # ── Traversability Grid Overlay ──────────────────────────────────────
        grid = scene.get("traversability_grid")
        if grid is not None:
            # If grid was converted to list for JSON serialization, convert back for numpy operations
            if isinstance(grid, list):
                grid = np.array(grid)
                
            gh, gw = grid.shape
            cell_w, cell_h = CAMERA_WIDTH // gw, CAMERA_HEIGHT // gh
            overlay = annotated.copy()
            for r in range(gh):
                for c in range(gw):
                    cost = grid[r, c]
                    if cost > 0.72:      # Blocked (Red)
                        cv2.rectangle(overlay, (c*cell_w, r*cell_h), ((c+1)*cell_w, (r+1)*cell_h), (0, 0, 160), -1)
                    elif cost > 0.38:    # Caution (Orange)
                        cv2.rectangle(overlay, (c*cell_w, r*cell_h), ((c+1)*cell_w, (r+1)*cell_h), (0, 120, 240), -1)
            cv2.addWeighted(overlay, 0.20, annotated, 0.80, 0, annotated)

            path = scene.get("safe_path", [])
            if path:
                points = np.array([(c*cell_w + cell_w//2, r*cell_h + cell_h//2) for c, r in path], np.int32)
                cv2.polylines(annotated, [points], False, (255, 210, 0), 2, cv2.LINE_AA)
        # ─────────────────────────────────────────────────────────────────────

        for obstacle in scene.get("obstacles", [])[:MAX_ANNOTATED_OBSTACLES]:
            x1, y1, x2, y2 = obstacle["xyxy"]
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
            approach = obstacle.get("approach_label", "stationary")
            ttc = obstacle.get("ttc_seconds")
            ttc_str = f" ({ttc}s)" if ttc is not None else ""
            
            label = (
                f"ID:{obstacle.get('track_id', 0)} {obstacle.get('class_name', 'object')} "
                f"{obstacle.get('zone', 'center')} {obstacle.get('distance', 'unknown')}"
            )
            if approach != "stationary":
                label += f" | {approach}{ttc_str}"

            cv2.putText(
                annotated,
                label[:64],
                (x1, max(22, y1 - 8)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.48,
                (247, 247, 247),
                1,
                cv2.LINE_AA,
            )

        header = annotated[0:78, :, :]
        overlay = header.copy()
        overlay[:] = color
        annotated[0:78, :, :] = cv2.addWeighted(overlay, 0.24, header, 0.76, 0)
        
        command_text = str(scene.get('command', 'CLEAR')).replace('_', ' ')
        cv2.putText(
            annotated,
            f"Command: {command_text}",
            (16, 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.72,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            annotated,
            str(scene.get("summary", "Scanning..."))[:92],
            (16, 56),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (245, 245, 245),
            1,
            cv2.LINE_AA,
        )
        cv2.putText(
            annotated,
            f"{self.latest_processing_ms:.0f} ms | {self.latest_processing_fps:.1f} FPS | {self.device} | {get_active_tracker_name()}",
            (16, 74),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42,
            (245, 245, 245),
            1,
            cv2.LINE_AA,
        )
        return annotated

    def _predict(self, model, frame, *, image_size, conf_thresh, class_ids=None, max_det=FULL_MAX_DET):
        kwargs = {
            "imgsz": image_size,
            "conf": conf_thresh,
            "verbose": False,
            "max_det": max_det,
        }
        if class_ids:
            kwargs["classes"] = class_ids
        if self.device.startswith("cuda"):
            kwargs["device"] = 0
            kwargs["half"] = self.use_half
        return model.predict(frame, **kwargs)

    def _inference_loop(self):
        """Thread 2: Heavy Math (AI Inference)"""
        while self.running:
            with self.frame_lock:
                frame_number = self.latest_frame_number
                frame = None if self.latest_frame is None else self.latest_frame.copy()

            if frame is None or frame_number == self.last_processed_frame_number:
                time.sleep(PROCESS_IDLE_SLEEP_SECONDS)
                continue

            self.last_processed_frame_number = frame_number
            started = time.perf_counter()
            try:
                # ── Obstruction / Low Light Check ──
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                mean_val, std_val = cv2.meanStdDev(gray)
                is_dark = mean_val[0][0] < 40.0 and std_val[0][0] < 40.0
                is_blocked = std_val[0][0] < 15.0 and mean_val[0][0] >= 40.0
                
                if is_dark or is_blocked:
                    obstructed_det = [{
                        "class_id": -1,
                        "class_name": "camera_dark" if is_dark else "camera_blocked",
                        "conf": 1.0,
                        "xyxy": [0, 0, frame.shape[1], frame.shape[0]],
                        "center": (frame.shape[1]//2, frame.shape[0]//2)
                    }]
                    if not self.logic_queue.full():
                        self.logic_queue.put((frame, obstructed_det, started), block=False)
                    continue

                self._ensure_model()
                
                # ── Base model: runs EVERY frame (~97ms) ──
                results_base = self._predict(
                    self.model_base,
                    frame,
                    image_size=self.safety_image_size,
                    conf_thresh=SAFETY_CONF_THRESH,
                    class_ids=self.safety_allowed_ids,
                    max_det=SAFETY_MAX_DET,
                )
                detections_base = self._extract_detections(self.model_base, results_base, conf_thresh=SAFETY_CONF_THRESH, allowed=self.safety_allowed)
                
                # ── Hazard model: runs every Nth frame (~149ms), cached otherwise ──
                self._hazard_frame_counter += 1
                if self._hazard_frame_counter >= HAZARD_RUN_EVERY_N:
                    self._hazard_frame_counter = 0
                    results_hazard = self._predict(
                        self.model_hazard,
                        frame,
                        image_size=self.hazard_image_size,
                        conf_thresh=SAFETY_CONF_THRESH,
                        class_ids=None,
                        max_det=SAFETY_MAX_DET,
                    )
                    self._cached_hazard_dets = self._extract_detections(self.model_hazard, results_hazard, conf_thresh=SAFETY_CONF_THRESH)
                    
                # ── MiDaS Depth Model: runs offset from Hazard model to save CPU ──
                # If hazard runs on 0, 6, 12... MiDaS runs on 3, 9, 15...
                if self.midas is not None and (self._hazard_frame_counter == int(HAZARD_RUN_EVERY_N / 2)):
                    try:
                        input_batch = self.midas_transform(frame)
                        if self.device.startswith("cuda"):
                            input_batch = input_batch.to(self.device)
                        with torch.no_grad():
                            prediction = self.midas(input_batch)
                            prediction = torch.nn.functional.interpolate(
                                prediction.unsqueeze(1),
                                size=frame.shape[:2],
                                mode="bicubic",
                                align_corners=False,
                            ).squeeze()
                        self._cached_depth_map = prediction.cpu().numpy()
                    except Exception:
                        pass
                
                detections_hazard = self._cached_hazard_dets
                
                # Merge with NMS (Hazard priority) to avoid collisions
                combined_detections = self._nms_combined(detections_base, detections_hazard)

                # Fallback: Detect unknown large obstacles (edges) - only update when hazard runs to save ~5-10ms per frame
                if self._hazard_frame_counter == 0 or not hasattr(self, "_cached_unknown_dets"):
                    self._cached_unknown_dets = self._detect_unknown_obstacles(frame, combined_detections)
                combined_detections.extend(self._cached_unknown_dets)
                
                # Push results to the logic assembly line
                if not self.logic_queue.full():
                    self.logic_queue.put((frame, combined_detections, started, self._cached_depth_map), block=False)
                
            except Exception as exc:
                self._store_error(f"Inference failed: {exc}")
                time.sleep(0.01)

    def _logic_loop(self):
        """Thread 3: Assembly Line (Tracking, Planning, Summarizing)"""
        while self.running:
            try:
                # Wait for next detection set from the inference thread
                item = self.logic_queue.get(timeout=0.1)
                
                # Handle old tuple formats gracefully if there's a race condition
                if len(item) == 3:
                    frame, detections, started = item
                    depth_map = None
                else:
                    frame, detections, started, depth_map = item
                
                # ── Ablation Level 2+: Tracking ──
                if len(detections) == 1 and detections[0].get("class_name") in ("camera_dark", "camera_blocked"):
                    # Bypass tracker for obstruction so it triggers instantly and doesn't get smoothed away
                    tracks = detections
                elif self.ablation_level >= 2:
                    tracks = update_tracker(detections, frame)
                else:
                    # Baseline: Pseudo-tracks directly from raw detections
                    tracks = [
                        {
                            "track_id": index + 1,
                            "xyxy": d["xyxy"],
                            "class_name": d["class_name"],
                            "confidence": d["conf"],
                        }
                        for index, d in enumerate(detections)
                    ]

                # ── Traversability Estimation ──────────────────────────────────
                grid = self._traversability.compute_grid(tracks, frame.shape, depth_map=depth_map)
                raw_scene = build_scene_guidance(tracks, frame.shape, grid=grid, relative_depth_map=depth_map)
                raw_scene["traversability_grid"] = grid.tolist()
                raw_scene["safe_path"] = self._traversability.find_safe_corridor()
                raw_scene["occupancy_stats"] = self._traversability.get_corridor_occupancy()

                # ── Ablation Level 3+: Temporal stabilization ──────────────────
                if self.ablation_level >= 3:
                    scene = self._stabilizer.update(raw_scene)
                else:
                    scene = raw_scene

                # ── User-Centric Command Policy ─────────────────────────────────
                # Ablation Level 4 uses full hysteresis inside the policy
                policy_result = self._policy.evaluate(scene, ablation_level=self.ablation_level)
                scene = self._apply_policy_result(scene, policy_result)

                finished_at = time.perf_counter()
                self.latest_processing_ms = (finished_at - started) * 1000.0
                self.latest_processing_fps = self._smoothed_fps(
                    self.latest_processing_fps,
                    finished_at,
                    self._last_safety_finished_at,
                    self.latest_processing_ms,
                )
                self._last_safety_finished_at = finished_at

                annotated = self._annotate_frame(frame, scene)

                ok, jpeg = cv2.imencode(
                    ".jpg",
                    annotated,
                    [int(cv2.IMWRITE_JPEG_QUALITY), ANNOT_JPEG_QUALITY],
                )
                if not ok:
                    continue

                with self.lock:
                    self.latest_annotated_jpeg = jpeg.tobytes()
                    self.latest_detections = scene.get("obstacles", [])
                    self.latest_guidance = scene
                    self.latest_context_detections = scene.get("obstacles", [])
                    self.latest_context_scene = scene
                    self.latest_timestamp = time.time()
                    self.latest_context_timestamp = self.latest_timestamp
                    self.latest_error = ""
                    self.latest_context_processing_ms = self.latest_processing_ms
            except queue.Empty:
                continue
            except Exception as exc:
                self._store_error(f"Logic assembly failed: {exc}")
                time.sleep(0.01)

    def _context_loop(self):
        """Thread 4: On-Demand Heavy Context Loop"""
        model_context = None

        while self.running:
            try:
                frame, frame_number = self.context_queue.get(timeout=0.5)

                if model_context is None:
                    try:
                        # Context loop strictly uses the Base model (COCO) to avoid reading out navigation hazards in the general summary
                        model_context = YOLO(str(self.model_base_path), task="detect")
                        model_context.fuse()
                    except Exception as exc:
                        self._store_error(f"Context model failed to load: {exc}")
                        time.sleep(0.5)
                        continue

                started = time.perf_counter()
                kwargs = {
                    "imgsz": self.full_image_size,
                    "conf": self.conf_thresh,
                    "verbose": False,
                    "max_det": FULL_MAX_DET,
                }
                if self.allowed_ids:
                    kwargs["classes"] = self.allowed_ids
                if self.device.startswith("cuda"):
                    kwargs["device"] = 0
                    kwargs["half"] = self.use_half
                
                results = model_context.predict(frame, **kwargs)
                detections = self._extract_detections(model_context, results, conf_thresh=self.conf_thresh, allowed=self.allowed)
                scene = self._scene_from_detections(detections, frame.shape)
                finished_at = time.perf_counter()
                
                processing_ms = (finished_at - started) * 1000.0
                now = time.time()
                
                enriched = {
                    **scene,
                    "detections": list(scene["obstacles"]),
                    "timestamp": now,
                    "frame_number": int(frame_number),
                    "running": self.running,
                    "error": "",
                    "processing_ms": round(processing_ms, 1),
                    "fps": round(1000.0 / max(processing_ms, 1.0), 1),
                    "device": self.device,
                    "analysis_profile": "full",
                }
                
                with self.lock:
                    self.last_full_scene = dict(enriched)
                    self.last_full_scene_frame_number = int(frame_number)
                    self.last_full_scene_at = now
                    self.latest_context_processing_fps = enriched["fps"]
                    
            except queue.Empty:
                continue
            except Exception as exc:
                self._store_error(f"Context processing failed: {exc}")
                time.sleep(0.1)

    def get_latest_jpeg(self):
        with self.lock:
            annotated_jpeg = self.latest_annotated_jpeg
        if annotated_jpeg is not None:
            return annotated_jpeg

        frame = self.get_latest_frame()
        if frame is None:
            return None

        ok, jpeg = cv2.imencode(
            ".jpg",
            frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), ANNOT_JPEG_QUALITY],
        )
        if not ok:
            return None
        return jpeg.tobytes()

    def get_latest_detections(self):
        with self.lock:
            return list(self.latest_detections)

    def get_latest_frame(self):
        with self.frame_lock:
            return None if self.latest_frame is None else self.latest_frame.copy()

    def analyze_current_scene(self, profile="full"):
        with self.frame_lock:
            frame_number = self.latest_frame_number
            frame = None if self.latest_frame is None else self.latest_frame.copy()

        if frame is None:
            return build_scene_guidance([], (CAMERA_HEIGHT, CAMERA_WIDTH, 3))

        now = time.time()
        
        # If we have a recent full scene (within cache TTL), return it
        if (
            profile == "full"
            and self.last_full_scene is not None
            and (now - self.last_full_scene_at) <= FULL_SCENE_CACHE_TTL_SECONDS
        ):
            return dict(self.last_full_scene)

        # Trigger background execution if not already processing
        if profile == "full" and not self.context_queue.full():
            try:
                self.context_queue.put((frame, frame_number), block=False)
            except queue.Full:
                pass
                
        # Return whatever we have for now, the UI will poll again and get the fresh data
        if self.last_full_scene:
            return dict(self.last_full_scene)
            
        return build_scene_guidance([], (CAMERA_HEIGHT, CAMERA_WIDTH, 3))

    def get_latest_safety_scene(self):
        with self.lock:
            return {
                **self.latest_guidance,
                "detections": list(self.latest_detections),
                "timestamp": self.latest_timestamp,
                "frame_number": int(self.last_processed_frame_number),
                "running": self.running,
                "error": self.latest_error,
                "processing_ms": round(self.latest_processing_ms, 1),
                "fps": round(self.latest_processing_fps, 1),
                "analysis_profile": "safety",
                "device": self.device,
            }

    def get_latest_context_scene(self):
        with self.lock:
            return {
                **self.latest_context_scene,
                "detections": list(self.latest_context_detections),
                "timestamp": self.latest_context_timestamp,
                "frame_number": int(self.last_processed_frame_number),
                "running": self.running,
                "error": self.latest_error,
                "processing_ms": round(self.latest_context_processing_ms, 1),
                "fps": round(self.latest_context_processing_fps, 1),
                "analysis_profile": "context",
                "device": self.device,
            }

    def get_latest_scene(self, view="full"):
        if view == "safety":
            scene = self.get_latest_safety_scene()
            compact = {
                key: scene.get(key)
                for key in (
                    "command",
                    "urgency",
                    "path_clear",
                    "safe_direction",
                    "estimated_clear_steps",
                    "summary",
                    "spoken_message",
                    "recommended_steps",
                    "primary_obstacle",
                    "timestamp",
                    "frame_number",
                    "running",
                    "error",
                    "processing_ms",
                    "fps",
                    "analysis_profile",
                    "device",
                    "palette",
                )
            }
            compact["detections"] = []
            return compact
        if view == "context":
            return self.get_latest_context_scene()
        return self.get_latest_context_scene()


_camera_processor_singleton = None


def get_camera_processor():
    global _camera_processor_singleton
    if _camera_processor_singleton is None:
        _camera_processor_singleton = CameraProcessor()
    return _camera_processor_singleton

