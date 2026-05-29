import math
import numpy as np
import logging

class GeometricDepthEstimator:
    """
    Estimates real-world distance $Z$ (in meters) to objects using camera geometry.
    
    This estimator fuses two independent monocular depth cues without requiring LIDAR:
    
    1. Inverse Perspective Mapping (Ground-Plane Assumption):
       Calculates the distance to the point where the object touches the ground.
    
    2. Size Priors (Similar Triangles):
       Uses known real-world heights $H_{real}$ to estimate distance based on pixel height $h_{pixel}$.
    """
    def __init__(self, camera_height=1.3, camera_pitch_deg=10.0, vfov_deg=60.0):
        self.H = camera_height  # Height of camera from ground in meters
        self.pitch = math.radians(camera_pitch_deg)  # Positive means pointing DOWN
        self.vfov = math.radians(vfov_deg)
        
        # Approximate real-world heights (meters) for known classes
        self.size_priors = {
            "person": 1.7,
            "door": 2.1,
            "glass door": 2.1,
            "car": 1.5,
            "bicycle": 1.0,
            "motorcycle": 1.1,
            "bus": 3.0,
            "truck": 3.0,
            "chair": 0.9,
            "table": 0.75,
            "bench": 0.8,
            "couch": 0.85,
            "bed": 0.6,
            "sink": 0.9,
            "toilet": 0.75,
            "traffic cone": 0.7,
            "pole": 2.0,
            "bollard": 0.9,
            "barrier": 1.0,
            "fire hydrant": 0.75,
            "suitcase": 0.7,
            "backpack": 0.5,
            "bottle": 0.25,
            "dog": 0.55,
            "stair": 0.2,  # height of one step
            "curb": 0.15,
            "pothole": 0.1,
            "puddle": 0.02,
        }

    def estimate_distance(self, bbox, class_name, frame_height):
        x1, y1, x2, y2 = bbox
        
        ground_dist = self._distance_from_ground(y2, frame_height)
        prior_dist = self._distance_from_size(y1, y2, class_name, frame_height)
        
        if ground_dist is not None and prior_dist is not None:
            if ground_dist > prior_dist * 1.5:
                return round(prior_dist, 2)
            return round((ground_dist + prior_dist) / 2.0, 2)
            
        if ground_dist is not None:
            return round(ground_dist, 2)
            
        if prior_dist is not None:
            return round(prior_dist, 2)
            
        return 99.9 # Unknown/infinity

    def _distance_from_ground(self, y_bottom, frame_height):
        y_center = frame_height / 2.0
        alpha = math.atan(((y_bottom - y_center) / y_center) * math.tan(self.vfov / 2.0))
        theta_ray = self.pitch + alpha
        
        if theta_ray <= 0:
            return None
            
        distance = self.H / math.tan(theta_ray)
        return max(0.1, distance)

    def _distance_from_size(self, y_top, y_bottom, class_name, frame_height):
        h_real = self.size_priors.get(class_name)
        if not h_real:
            return None
            
        h_pixel = max(y_bottom - y_top, 1)
        distance = (h_real * frame_height) / (2.0 * h_pixel * math.tan(self.vfov / 2.0))
        return max(0.1, distance)


class NeuralDepthEstimator:
    """
    Industry-standard monocular dense depth estimator.
    Uses MiDaS relative depth maps and anchors them to true metric distances 
    using the GeometricDepthEstimator as a fallback calibration.
    """
    def __init__(self, fallback_estimator=None):
        self.fallback = fallback_estimator or GeometricDepthEstimator()
        self.scale_factor = 1.0  # Automatically calibrated at runtime

    def estimate_distance(self, bbox, class_name, frame_height, relative_depth_map=None):
        # 1. Always compute the geometric distance as a safety anchor
        geom_dist = self.fallback.estimate_distance(bbox, class_name, frame_height)
        
        # 2. If no neural map is provided (e.g. on frames where MiDaS was skipped to save CPU),
        #    instantly fall back to geometry.
        if relative_depth_map is None:
            return geom_dist
            
        x1, y1, x2, y2 = [int(v) for v in bbox]
        
        h, w = relative_depth_map.shape
        x1, x2 = max(0, min(x1, w-1)), max(0, min(x2, w-1))
        y1, y2 = max(0, min(y1, h-1)), max(0, min(y2, h-1))
        
        if x2 <= x1 or y2 <= y1:
            return geom_dist
            
        # 3. Extract the median relative depth (disparity) for this bounding box
        box_depths = relative_depth_map[y1:y2, x1:x2]
        median_rel_depth = np.median(box_depths)
        
        if median_rel_depth <= 0.001:
            return geom_dist
            
        # 4. Anchor Calibration
        # We only trust specific object classes to calibrate our metric scale.
        # e.g., A person is almost always ~1.7m tall. If geometry says they are 2.5m away,
        # we lock the neural network's scale to match that reality.
        trusted_classes = {"person", "door", "glass door", "car", "chair", "bed", "toilet"}
        
        if class_name in trusted_classes and geom_dist < 99.0:
            # MiDaS outputs disparity (inverse depth). 
            # Metric Distance = Scale / Disparity  =>  Scale = Metric Distance * Disparity
            new_scale = geom_dist * median_rel_depth
            
            # Exponential Moving Average (EMA) to prevent wild scale jumps
            if self.scale_factor == 1.0:
                self.scale_factor = new_scale
            else:
                self.scale_factor = 0.85 * self.scale_factor + 0.15 * new_scale

        # 5. Calculate Final Neural Metric Depth
        # Even if this object isn't a trusted class (like a weird puddle or unknown box),
        # it now inherits the highly accurate metric scale calibrated by the trusted objects!
        neural_dist = self.scale_factor / median_rel_depth
        
        # Sanity Check: If the neural math explodes (e.g., object too close to camera), trust geometry.
        if neural_dist > 50.0 or neural_dist < 0.1:
            return geom_dist
            
        return round(float(neural_dist), 2)
