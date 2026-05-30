import numpy as np

from .depth import GeometricDepthEstimator


class FeedbackPolicy:
    def __init__(self, confidence_threshold=0.28, critical_y_threshold=0.8):
        """
        Policy to determine stable movement feedback for a blind user.

        The planner owns the human-readable guidance text. This policy only
        stabilizes or upgrades the movement command so detector.py can keep
        command and spoken guidance coherent.
        """
        self.conf_thresh = confidence_threshold
        self.crit_y = critical_y_threshold
        self.last_command = "CLEAR"
        self.command_repeat_limit = 30
        self.repeat_counter = 0

        self.current_state = "CLEAR"
        self.evidence_counter = 0
        self.required_evidence_frames = 10

        self.depth_estimator = GeometricDepthEstimator()

    def evaluate(self, scene, ablation_level=4):
        """
        Return a stable policy result for the current scene.

        The result is a dict with:
        - command: stable movement command
        - should_speak: whether a speech engine should announce this repeat
        """
        obstacles = scene.get("obstacles", [])
        
        # If camera is obstructed, do NOT override the planner's STOP command
        if scene.get("camera_obstructed"):
            self.current_state = "STOP"
            return self._build_result("STOP", should_speak=True)
        
        grid = scene.get("traversability_grid")
        if grid is not None:
            grid = np.array(grid)

        new_command = self._calculate_command(scene, obstacles, grid)

        if ablation_level < 4:
            self.current_state = new_command
            return self._build_result(new_command, should_speak=True)

        if new_command == self.current_state:
            self.evidence_counter = 0
        else:
            self.evidence_counter += 1
            if self.evidence_counter >= self.required_evidence_frames:
                is_escalation = self._is_more_urgent(new_command, self.current_state)
                if is_escalation or self.evidence_counter >= (self.required_evidence_frames * 1.5):
                    self.current_state = new_command
                    self.evidence_counter = 0

        should_speak = True
        if self.current_state == self.last_command:
            self.repeat_counter += 1
            if self.repeat_counter < self.command_repeat_limit:
                should_speak = False
        else:
            self.last_command = self.current_state
            self.repeat_counter = 0

        return self._build_result(self.current_state, should_speak=should_speak)

    def _build_result(self, command, should_speak=True):
        return {
            "command": command or "CLEAR",
            "should_speak": bool(should_speak),
        }

    def _is_more_urgent(self, new, old):
        order = {
            "CLEAR": 0,
            "CAUTION: OBJECTS UNCLEAR": 1,
            "SLOW": 2,
            "MOVE_LEFT": 2,
            "MOVE_RIGHT": 2,
            "STOP": 3,
        }
        return order.get(new, 0) > order.get(old, 0)

    def _calculate_command(self, scene, obstacles, grid):
        planner_command = scene.get("command", "CLEAR")

        if len(obstacles) > 0:
            max_conf = max([o.get("confidence", 0) for o in obstacles])
            if max_conf < self.conf_thresh:
                return "CAUTION: OBJECTS UNCLEAR"
        else:
            return "CLEAR"

        for obs in obstacles:
            cls_name = obs.get("class_name", "obstacle")
            conf = obs.get("confidence", 0)
            dist_m = obs.get("distance_m", 99.0)
            ttc = obs.get("ttc_seconds")

            stop_thresh = 1.3 if self.current_state == "STOP" else 1.05
            ttc_thresh = 1.5 if self.current_state == "STOP" else 1.15

            is_close = dist_m <= stop_thresh
            is_imminent = ttc is not None and ttc <= ttc_thresh

            if (is_close or is_imminent) and conf > self.conf_thresh:
                if cls_name in [
                    "person",
                    "obstacle",
                    "car",
                    "bicycle",
                    "motorcycle",
                    "bus",
                    "truck",
                    "train",
                    "bench",
                    "backpack",
                    "umbrella",
                    "handbag",
                    "suitcase",
                    "chair",
                    "couch",
                    "potted plant",
                    "bed",
                    "dining table",
                    "bottle",
                    "stair",
                    "escalator",
                    "curb",
                    "pothole",
                    "puddle",
                    "wet floor",
                    "traffic cone",
                    "bollard",
                    "pole",
                    "barrier",
                    "fire hydrant",
                    "glass door",
                    "dog",
                ]:
                    return "STOP"

        if planner_command == "STOP":
            return "STOP"

        if planner_command in {"MOVE_LEFT", "MOVE_RIGHT"}:
            return planner_command

        for obs in obstacles:
            conf = obs.get("confidence", 0)
            dist_m = obs.get("distance_m", 99.0)
            ttc = obs.get("ttc_seconds")

            slow_thresh = 3.2 if self.current_state == "SLOW" else 2.6
            slow_ttc = 3.5 if self.current_state == "SLOW" else 2.8

            is_near = dist_m <= slow_thresh
            is_approaching = ttc is not None and ttc <= slow_ttc

            if (is_near or is_approaching) and conf > self.conf_thresh:
                return "SLOW"

        if grid is not None:
            rows, cols = grid.shape
            c1, c2 = cols // 4, 3 * cols // 4
            corridor = grid[rows // 2 :, c1:c2]
            blocked_cells = np.count_nonzero(corridor > 0.45)
            total_cells = corridor.size

            if blocked_cells > total_cells * 0.35:
                return "SLOW"

        if planner_command in {"STOP", "SLOW", "MOVE_LEFT", "MOVE_RIGHT"}:
            return planner_command
        return "CLEAR"


