from collections import deque
import logging

TRACKER_MATCH_IOU = 0.24
TRACKER_MAX_MISSED = 8
TRACKER_OUTPUT_MISSED = 2
TRACKER_HISTORY_SIZE = 6
TRACKER_BOX_ALPHA = 0.66

#: Number of raw bounding boxes kept per track for motion estimation in legacy tracker.
TRACKER_MOTION_HISTORY = 8

#: Minimum bbox area growth (px² / frame) that is classified as "approaching".
TRACKER_APPROACH_THRESHOLD = 200

# ── Dynamic Fallback Mechanism ──
_USE_SORT = False
try:
    import numpy as np
    from scipy.optimize import linear_sum_assignment
    _USE_SORT = True
except ImportError:
    logging.warning("scipy or numpy not found. Falling back to simple IoU _LightTracker.")


def _iou(box_a, box_b):
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


def _blend_boxes(old_box, new_box):
    return [
        int((old_box[index] * (1.0 - TRACKER_BOX_ALPHA)) + (new_box[index] * TRACKER_BOX_ALPHA))
        for index in range(4)
    ]

# ─────────────────────────────────────────────────────────────────────────────────
# 1. NEW INDUSTRY-STANDARD TRACKER (SORT w/ KALMAN FILTERS)
# ─────────────────────────────────────────────────────────────────────────────────

if _USE_SORT:
    class KalmanBoxTracker:
        """Lightweight NumPy Kalman Filter for 2D bounding boxes.
        State: [u, v, s, r, u_dot, v_dot, s_dot]
        Obs:   [u, v, s, r]
        """
        def __init__(self, bbox):
            self.kf_x = np.zeros((7, 1))
            u, v, s, r = self._bbox_to_z(bbox).flatten()
            self.kf_x[:4] = np.array([[u], [v], [s], [r]])
            
            self.kf_F = np.eye(7)
            self.kf_F[0, 4] = 1
            self.kf_F[1, 5] = 1
            self.kf_F[2, 6] = 1
            
            self.kf_H = np.zeros((4, 7))
            self.kf_H[0, 0] = 1
            self.kf_H[1, 1] = 1
            self.kf_H[2, 2] = 1
            self.kf_H[3, 3] = 1
            
            self.kf_P = np.eye(7)
            self.kf_P[4:, 4:] *= 1000.  # high uncertainty in initial velocities
            self.kf_P *= 10.
            
            self.kf_Q = np.eye(7)
            self.kf_Q[4:, 4:] *= 0.01
            
            self.kf_R = np.eye(4) * 1.0

        def _bbox_to_z(self, bbox):
            w = bbox[2] - bbox[0]
            h = bbox[3] - bbox[1]
            u = bbox[0] + w / 2.
            v = bbox[1] + h / 2.
            s = w * h
            r = w / float(h) if h > 0 else 0
            return np.array([[u], [v], [s], [r]])

        def _z_to_bbox(self, z):
            u, v, s, r = z.flatten()
            w = np.sqrt(max(0, s * r))
            h = s / w if w > 0 else 0
            return [int(u - w/2), int(v - h/2), int(u + w/2), int(v + h/2)]

        def predict(self):
            self.kf_x = np.dot(self.kf_F, self.kf_x)
            self.kf_P = np.dot(np.dot(self.kf_F, self.kf_P), self.kf_F.T) + self.kf_Q
            return self._z_to_bbox(self.kf_x[:4])

        def update(self, bbox):
            z = self._bbox_to_z(bbox)
            y = z - np.dot(self.kf_H, self.kf_x)
            S = np.dot(np.dot(self.kf_H, self.kf_P), self.kf_H.T) + self.kf_R
            K = np.dot(np.dot(self.kf_P, self.kf_H.T), np.linalg.inv(S))
            self.kf_x = self.kf_x + np.dot(K, y)
            I = np.eye(7)
            self.kf_P = np.dot(I - np.dot(K, self.kf_H), self.kf_P)

    class SortTrack:
        def __init__(self, track_id, detection):
            self.track_id = track_id
            self.kf = KalmanBoxTracker(detection["xyxy"])
            self.xyxy = [int(v) for v in detection["xyxy"]]
            self.class_votes = {}
            self.class_history = deque(maxlen=TRACKER_HISTORY_SIZE)
            self.conf_history = deque(maxlen=TRACKER_HISTORY_SIZE)
            
            self.hits = 1
            self.missed = 0
            self.last_updated_frame = 0
            
            self._update_class(detection)

        def _update_class(self, detection):
            class_name = detection.get("class_name", "") or "obstacle"
            confidence = float(detection.get("conf", 0.0))
            self.class_history.append(class_name)
            self.conf_history.append(confidence)
            self.class_votes[class_name] = self.class_votes.get(class_name, 0.0) + max(confidence, 0.05)

        def predict(self):
            self.xyxy = self.kf.predict()

        def update(self, detection, frame_number):
            self.kf.update(detection["xyxy"])
            self.xyxy = self.kf._z_to_bbox(self.kf.kf_x[:4])
            self._update_class(detection)
            self.hits += 1
            self.missed = 0
            self.last_updated_frame = frame_number

        @property
        def stable_class_name(self):
            if not self.class_votes:
                return "obstacle"
            return max(self.class_votes.items(), key=lambda item: item[1])[0]

        @property
        def stable_confidence(self):
            if not self.conf_history:
                return 0.0
            return sum(self.conf_history) / len(self.conf_history)

        @property
        def calibrated_confidence(self):
            c = self.stable_confidence
            persistence_factor = 1.0 - (0.5 * (0.65 ** max(self.hits, 1)))
            stale_factor = 0.80 ** self.missed
            return round(float(c * persistence_factor * stale_factor), 4)

        @property
        def motion(self):
            vx = float(self.kf.kf_x[4])
            vy = float(self.kf.kf_x[5])
            s_dot = float(self.kf.kf_x[6])
            return {
                "vx": round(vx, 1),
                "vy": round(vy, 1),
                "approach_rate": round(s_dot, 1),
                "is_approaching": s_dot > TRACKER_APPROACH_THRESHOLD,
            }

        def to_dict(self):
            m = self.motion
            return {
                "track_id": int(self.track_id),
                "xyxy": [int(value) for value in self.xyxy],
                "class_name": self.stable_class_name,
                "confidence": self.calibrated_confidence,
                "hits": int(self.hits),
                "missed": int(self.missed),
                "vx": m["vx"],
                "vy": m["vy"],
                "approach_rate": m["approach_rate"],
                "is_approaching": m["is_approaching"],
            }

    class SortTracker:
        def __init__(self):
            self.next_id = 1
            self.frame_number = 0
            self.tracks = {}

        def reset(self):
            self.next_id = 1
            self.frame_number = 0
            self.tracks = {}

        def _match_detections(self, detections, tracks):
            if len(tracks) == 0:
                return [], list(range(len(detections))), []
            if len(detections) == 0:
                return [], [], list(range(len(tracks)))

            iou_matrix = np.zeros((len(tracks), len(detections)), dtype=np.float32)
            for t, trk in enumerate(tracks):
                for d, det in enumerate(detections):
                    iou_matrix[t, d] = _iou(trk.xyxy, det["xyxy"])

            cost_matrix = 1.0 - iou_matrix
            cost_matrix[iou_matrix < TRACKER_MATCH_IOU] = 1.0

            trk_indices, det_indices = linear_sum_assignment(cost_matrix)
            
            matched = []
            unmatched_dets = set(range(len(detections)))
            unmatched_trks = set(range(len(tracks)))
            
            for trk_idx, det_idx in zip(trk_indices, det_indices):
                if iou_matrix[trk_idx, det_idx] < TRACKER_MATCH_IOU:
                    continue
                matched.append((trk_idx, det_idx))
                unmatched_dets.remove(det_idx)
                unmatched_trks.remove(trk_idx)
                
            return matched, list(unmatched_dets), list(unmatched_trks)

        def update(self, detections):
            self.frame_number += 1
            
            # Predict
            for track in self.tracks.values():
                track.predict()
                
            active_tracks = list(self.tracks.values())
            
            # Match
            matched, unmatched_dets, unmatched_trks = self._match_detections(detections, active_tracks)
            
            # Update Matched
            for trk_idx, det_idx in matched:
                track = active_tracks[trk_idx]
                track.update(detections[det_idx], self.frame_number)
                
            # Create New
            for det_idx in unmatched_dets:
                new_track = SortTrack(self.next_id, detections[det_idx])
                new_track.last_updated_frame = self.frame_number
                self.tracks[self.next_id] = new_track
                self.next_id += 1
                
            # Remove Stale
            stale_ids = []
            for track_id, track in self.tracks.items():
                if track.last_updated_frame != self.frame_number:
                    track.missed += 1
                    if track.missed > TRACKER_MAX_MISSED:
                        stale_ids.append(track_id)
                        
            for track_id in stale_ids:
                self.tracks.pop(track_id)
                
            visible_tracks = [
                track for track in self.tracks.values()
                if track.missed <= TRACKER_OUTPUT_MISSED
            ]
            visible_tracks.sort(key=lambda t: (t.missed, t.track_id))
            return [t.to_dict() for t in visible_tracks]


# ─────────────────────────────────────────────────────────────────────────────────
# 2. LEGACY TRACKER (Basic IoU) - MAINTAINED AS FALLBACK
# ─────────────────────────────────────────────────────────────────────────────────

class _LightTrack:
    def __init__(self, track_id, detection):
        self.track_id = track_id
        self.xyxy = [int(value) for value in detection["xyxy"]]
        self.class_votes = {}
        self.class_history = deque(maxlen=TRACKER_HISTORY_SIZE)
        self.conf_history = deque(maxlen=TRACKER_HISTORY_SIZE)
        self.bbox_history: deque = deque(maxlen=TRACKER_MOTION_HISTORY)
        self.hits = 1
        self.missed = 0
        self.last_updated_frame = 0
        self.update(detection, frame_number=0)

    def update(self, detection, frame_number):
        bbox = [int(value) for value in detection["xyxy"]]
        self.bbox_history.append(bbox)
        self.xyxy = _blend_boxes(self.xyxy, bbox) if self.hits else bbox
        class_name = detection.get("class_name", "") or "obstacle"
        confidence = float(detection.get("conf", 0.0))

        self.class_history.append(class_name)
        self.conf_history.append(confidence)
        self.class_votes[class_name] = self.class_votes.get(class_name, 0.0) + max(confidence, 0.05)

        self.hits += 1
        self.missed = 0
        self.last_updated_frame = frame_number

    @property
    def stable_class_name(self):
        if not self.class_votes:
            return "obstacle"
        return max(self.class_votes.items(), key=lambda item: item[1])[0]

    @property
    def stable_confidence(self):
        if not self.conf_history:
            return 0.0
        return sum(self.conf_history) / len(self.conf_history)

    @property
    def calibrated_confidence(self):
        c = self.stable_confidence
        persistence_factor = 1.0 - (0.5 * (0.65 ** max(self.hits, 1)))
        stale_factor = 0.80 ** self.missed
        return round(float(c * persistence_factor * stale_factor), 4)

    @property
    def motion(self):
        if len(self.bbox_history) < 2:
            return {"vx": 0.0, "vy": 0.0, "approach_rate": 0.0, "is_approaching": False}

        old = self.bbox_history[0]
        new = self.bbox_history[-1]
        n = max(len(self.bbox_history) - 1, 1)

        old_cx = (old[0] + old[2]) / 2.0
        old_cy = (old[1] + old[3]) / 2.0
        new_cx = (new[0] + new[2]) / 2.0
        new_cy = (new[1] + new[3]) / 2.0

        old_area = max(old[2] - old[0], 0) * max(old[3] - old[1], 0)
        new_area = max(new[2] - new[0], 0) * max(new[3] - new[1], 0)
        approach_rate = (new_area - old_area) / n

        return {
            "vx": round((new_cx - old_cx) / n, 1),
            "vy": round((new_cy - old_cy) / n, 1),
            "approach_rate": round(approach_rate, 1),
            "is_approaching": approach_rate > TRACKER_APPROACH_THRESHOLD,
        }

    def to_dict(self):
        m = self.motion
        return {
            "track_id": int(self.track_id),
            "xyxy": [int(value) for value in self.xyxy],
            "class_name": self.stable_class_name,
            "confidence": self.calibrated_confidence,
            "hits": int(self.hits),
            "missed": int(self.missed),
            "vx": m["vx"],
            "vy": m["vy"],
            "approach_rate": m["approach_rate"],
            "is_approaching": m["is_approaching"],
        }


class _LightTracker:
    def __init__(self):
        self.next_id = 1
        self.frame_number = 0
        self.tracks = {}

    def reset(self):
        self.next_id = 1
        self.frame_number = 0
        self.tracks = {}

    def update(self, detections):
        self.frame_number += 1
        active_tracks = list(self.tracks.values())
        unmatched_tracks = set(track.track_id for track in active_tracks)
        unmatched_detections = set(range(len(detections)))
        matches = []

        scored_pairs = []
        for track in active_tracks:
            for detection_index, detection in enumerate(detections):
                iou_score = _iou(track.xyxy, detection["xyxy"])
                if iou_score >= TRACKER_MATCH_IOU:
                    scored_pairs.append((iou_score, track.track_id, detection_index))

        scored_pairs.sort(reverse=True)
        for _, track_id, detection_index in scored_pairs:
            if track_id not in unmatched_tracks or detection_index not in unmatched_detections:
                continue
            unmatched_tracks.remove(track_id)
            unmatched_detections.remove(detection_index)
            matches.append((track_id, detection_index))

        updated_tracks = []
        for track_id, detection_index in matches:
            track = self.tracks[track_id]
            track.update(detections[detection_index], self.frame_number)
            updated_tracks.append(track)

        for detection_index in unmatched_detections:
            new_track = _LightTrack(self.next_id, detections[detection_index])
            new_track.last_updated_frame = self.frame_number
            self.tracks[self.next_id] = new_track
            updated_tracks.append(new_track)
            self.next_id += 1

        stale_ids = []
        for track_id, track in self.tracks.items():
            if track.last_updated_frame == self.frame_number:
                continue
            track.missed += 1
            track.hits = 0
            if track.missed > TRACKER_MAX_MISSED:
                stale_ids.append(track_id)

        for track_id in stale_ids:
            self.tracks.pop(track_id, None)

        visible_tracks = [
            track
            for track in self.tracks.values()
            if track.missed <= TRACKER_OUTPUT_MISSED
        ]
        visible_tracks.sort(key=lambda track: (track.missed, track.track_id))
        return [track.to_dict() for track in visible_tracks]

# ─────────────────────────────────────────────────────────────────────────────────
# 3. ROUTER / MANAGER
# ─────────────────────────────────────────────────────────────────────────────────

_active_tracker = None

def _get_tracker():
    global _active_tracker
    if _active_tracker is None:
        if _USE_SORT:
            logging.info("Initializing high-performance SORT Tracker (Kalman + Hungarian).")
            _active_tracker = SortTracker()
        else:
            logging.info("Initializing fallback LightTracker (IoU only).")
            _active_tracker = _LightTracker()
    return _active_tracker

def reset_tracker():
    _get_tracker().reset()

def update_tracker(detections, frame=None):
    del frame
    try:
        return _get_tracker().update(detections)
    except Exception as e:
        # Graceful, silent failover to legacy tracker if the mathematical matrix fails
        global _active_tracker
        logging.error(f"SORT tracker failed: {e}. Falling back to LightTracker.")
        _active_tracker = _LightTracker()
        return _active_tracker.update(detections)

def get_active_tracker_name():
    t = _get_tracker()
    if t.__class__.__name__ == "SortTracker":
        return "SORT (Kalman)"
    return "Legacy (IoU)"
