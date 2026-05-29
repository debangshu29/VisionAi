import numpy as np
import cv2

GRID_WIDTH = 16
GRID_HEIGHT = 12
DEFAULT_FRAME_SHAPE = (480, 640, 3)

class TraversabilityEstimator:
    """
    Estimates walkable vs. blocked areas using a projected 2D Occupancy Grid.
    
    This module maps 3D obstacle constraints from a monocular camera into a 
    top-down 2D costmap matrix $C \in \mathbb{R}^{H_{grid} \times W_{grid}}$. 
    
    It employs:
    1. Grid Discretization: $\\mathbf{P}_{grid} = \\lfloor \\mathbf{P}_{pixel} \\cdot \\frac{S_{grid}}{S_{pixel}} \\rfloor$
    2. Footprint Blocking: Assumes the bottom edge of a bounding box $y_2$ touches the ground.
    3. Vertical Shadowing (Obscuration): Marks cells "behind" the object as obstructed, as monocular vision cannot see through solid objects.
    """

    def __init__(self, width=GRID_WIDTH, height=GRID_HEIGHT):
        self.width = width
        self.height = height
        self.grid = np.zeros((height, width), dtype=np.float32)

    def compute_grid(self, tracks, frame_shape=DEFAULT_FRAME_SHAPE, depth_map=None):
        """
        Processes bounding box tracks and updates the occupancy costmap.
        
        Args:
            tracks: List of obstacle dictionaries containing 'xyxy' bounding boxes.
            frame_shape: Resolution of the camera frame $(H_{pixel}, W_{pixel})$.
            depth_map: Dense 3D relative disparity map from MiDaS (optional).
            
        Returns:
            np.ndarray: The updated $12 \times 16$ Gaussian-smoothed costmap grid.
        """
        h, w = frame_shape[:2]
        new_grid = np.zeros((self.height, self.width), dtype=np.float32)

        # 1. Distance uncertainty: Top 35% of the frame is usually far-field/horizon.
        uncertain_rows = int(self.height * 0.35)
        new_grid[:uncertain_rows, :] = 0.25

        # Pre-process 3D map for ultra-fast grid mapping
        if depth_map is not None:
            # Resize full depth map down to 12x16 for instant lookup
            small_depth = cv2.resize(depth_map, (self.width, self.height), interpolation=cv2.INTER_NEAREST)
        else:
            small_depth = None

        for track in tracks:
            xyxy = track.get("xyxy")
            if not xyxy:
                continue

            x1, y1, x2, y2 = xyxy
            
            # Map pixels to grid coordinates
            gx1 = int((x1 / w) * self.width)
            gx2 = int((x2 / w) * self.width)
            gy1 = int((y1 / h) * self.height)
            gy2 = int((y2 / h) * self.height)

            # Clamp to grid bounds
            gx1 = max(0, min(gx1, self.width - 1))
            gx2 = max(0, min(gx2, self.width - 1))
            gy1 = max(0, min(gy1, self.height - 1))
            gy2 = max(0, min(gy2, self.height - 1))

            if small_depth is not None:
                # ── 3D Silhouette Fusion ──
                # Extract the 3D depth slice for this YOLO bounding box
                box_depths = small_depth[gy1:gy2+1, gx1:gx2+1]
                if box_depths.size > 0:
                    max_disp = np.max(box_depths)
                    # Isolate the physical object (high disparity/close) from the background
                    threshold = max_disp * 0.75
                    
                    for r in range(gy1, gy2 + 1):
                        for c in range(gx1, gx2 + 1):
                            if small_depth[r, c] >= threshold:
                                new_grid[r, c] = 1.0
                                
                                # Vertical Shadowing (Obscuration): We still can't see through it
                                for shadow_r in range(0, r):
                                    obscure_cost = 0.7 if shadow_r > uncertain_rows else 0.4
                                    new_grid[shadow_r, c] = max(new_grid[shadow_r, c], obscure_cost)
            else:
                # ── 2D Legacy Fallback ──
                # Block the cells directly covered by the bottom of the box footprint
                footprint_y = gy2
                for col in range(gx1, gx2 + 1):
                    new_grid[footprint_y, col] = 1.0
                    
                    # Obscuration (Shadowing)
                    for row in range(0, footprint_y):
                        obscure_cost = 0.7 if row > uncertain_rows else 0.4
                        new_grid[row, col] = max(new_grid[row, col], obscure_cost)

        # 2. Smoothing: Soften the "caution" zones around obstacles.
        self.grid = cv2.GaussianBlur(new_grid, (3, 3), 0)
        return self.grid

    def find_safe_corridor(self):
        """Finds the best vertical path from bottom-center to top.
        
        Returns a list of (col, row) grid coordinates.
        """
        path = []
        # Start at bottom center
        curr_col = self.width // 2
        
        # Traverse from bottom (height-1) to top (0)
        for row in range(self.height - 1, -1, -1):
            # Look at current column and immediate neighbors for lowest cost
            candidates = []
            for dc in [-1, 0, 1]:
                nc = curr_col + dc
                if 0 <= nc < self.width:
                    candidates.append((nc, self.grid[row, nc]))
            
            if not candidates:
                break
                
            # Pick neighbor with lowest cost, favoring center (dc=0) on ties
            best_col, min_cost = min(candidates, key=lambda x: (x[1], abs(x[0] - self.width // 2)))
            curr_col = best_col
            path.append((curr_col, row))
            
        return path

    def get_walkability_stats(self):
        """Returns percentage of grid that is walkable (low cost)."""
        walkable = np.count_nonzero(self.grid < 0.4)
        total = self.grid.size
        return round((walkable / total) * 100, 1)

    def get_corridor_occupancy(self, center_width=4):
        """Analyzes the central corridor of the grid to quantify blockage.
        
        center_width: number of columns in the middle to analyze (default 4/16 = 25%)
        """
        c1 = (self.width // 2) - (center_width // 2)
        c2 = c1 + center_width
        
        # Extract the center vertical slice
        corridor = self.grid[:, c1:c2]
        # Threshold for 'blocked' or 'heavily cautioned'
        blocked_mask = corridor > 0.45
        
        # 1. Clear steps: Rows from the bottom (closest) before the first obstruction.
        clear_steps = 0
        for r in range(self.height - 1, -1, -1):
            if np.any(blocked_mask[r, :]):
                break
            clear_steps += 1
            
        # 2. Blockage Percentage: Fraction of the center path occupied.
        blocked_count = np.count_nonzero(blocked_mask)
        total_cells = corridor.size
        pct = (blocked_count / total_cells) * 100
        
        # 3. Qualitative density label.
        if pct > 70:
            label = "severely blocked"
        elif pct > 40:
            label = "heavily obstructed"
        elif pct > 12:
            label = "partially blocked"
        elif pct > 4:
            label = "mostly clear"
        else:
            label = "clear"
            
        return {
            "percentage": round(pct, 1),
            "clear_steps": int(clear_steps),
            "label": label,
            "blocked_count": int(blocked_count),
            "total_cells": int(total_cells),
            # "3 out of 10 blocks" style stat
            "ratio_phrase": f"{blocked_count} out of {total_cells} blocks"
        }

def reset_traversability():
    """Helper to maintain pattern consistency with tracker/stabilizer."""
    pass
