import sys
import os
import time
import csv
import cv2

# Ensure Django project root is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main.detector import CameraProcessor

def run_ablation(video_path, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    
    levels = {
        1: "Baseline (Raw YOLO)",
        2: "Baseline + Tracking",
        3: "Tracking + Smoothing",
        4: "Full Logic (Tracking + Smoothing + Hysteresis)"
    }
    
    metrics = []
    
    for level, name in levels.items():
        print(f"\n--- Running Ablation Level {level}: {name} ---")
        
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            print(f"Error: Could not open video {video_path}")
            return
            
        # Initialize processor with specific ablation level
        processor = CameraProcessor(ablation_level=level)
        processor._ensure_model()
        
        frame_count = 0
        command_flips = 0
        last_command = "CLEAR"
        start_time = time.time()
        latencies = []
        
        out_video = cv2.VideoWriter(
            os.path.join(output_dir, f"ablation_level_{level}.mp4"),
            cv2.VideoWriter_fourcc(*'mp4v'),
            30.0,
            (640, 480)
        )
        
        while True:
            ret, frame = cap.read()
            if not ret:
                break
                
            frame = cv2.resize(frame, (640, 480))
            frame_count += 1
            frame_start = time.time()
            
            # Manually run the pipeline synchronously for deterministic testing
            with processor.inference_lock:
                results = processor._predict(
                    processor.model_nav,
                    frame,
                    image_size=processor.safety_image_size,
                    conf_thresh=processor.conf_thresh,
                    class_ids=processor.safety_allowed_ids,
                    max_det=18,
                )
            detections = processor._extract_detections(processor.model_nav, results, conf_thresh=0.28, allowed=processor.safety_allowed)
            
            # Level 2+: Tracking
            if level >= 2:
                from main.tracker import update_tracker
                tracks = update_tracker(detections, frame)
            else:
                tracks = [{"track_id": i + 1, "xyxy": d["xyxy"], "class_name": d["class_name"], "confidence": d["conf"]} for i, d in enumerate(detections)]
                
            from main.planner import build_scene_guidance
            grid = processor._traversability.compute_grid(tracks, frame.shape)
            raw_scene = build_scene_guidance(tracks, frame.shape, grid=grid)
            
            # Level 3+: Temporal Smoothing
            if level >= 3:
                scene = processor._stabilizer.update(raw_scene)
            else:
                scene = raw_scene
                
            # Level 4+: Hysteresis
            policy_result = processor._policy.evaluate(scene, ablation_level=level)
            scene = processor._apply_policy_result(scene, policy_result)
            
            # Metric: Command Flips (Instability)
            current_command = scene.get("command", "CLEAR")
            if current_command != last_command:
                command_flips += 1
                last_command = current_command
                
            annotated = processor._annotate_frame(frame, scene)
            cv2.putText(annotated, f"Ablation Level: {level}", (16, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
            out_video.write(annotated)
            
            frame_end = time.time()
            latencies.append((frame_end - frame_start) * 1000)
            
            if frame_count % 30 == 0:
                print(f"Processed {frame_count} frames...")
                
        end_time = time.time()
        fps = frame_count / max((end_time - start_time), 1.0)
        
        cap.release()
        out_video.release()
        
        avg_latency = sum(latencies) / len(latencies) if latencies else 0
        
        metrics.append({
            "Level": level,
            "Name": name,
            "Frames": frame_count,
            "Command_Flips": command_flips,
            "Flip_Rate_Per_Second": round(command_flips / (frame_count / 30.0), 2) if frame_count else 0,
            "Processing_FPS": round(fps, 1),
            "Avg_Latency_ms": round(avg_latency, 2)
        })
        
        print(f"Level {level} completed. Command Flips: {command_flips} | FPS: {fps:.1f} | Avg Latency: {avg_latency:.1f}ms")
        
    # Write CSV
    csv_path = os.path.join(output_dir, "ablation_metrics.csv")
    with open(csv_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=["Level", "Name", "Frames", "Command_Flips", "Flip_Rate_Per_Second", "Processing_FPS", "Avg_Latency_ms"])
        writer.writeheader()
        writer.writerows(metrics)
        
    print(f"\nAll levels completed. Metrics saved to {csv_path}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python run_ablation_video.py <input_video.mp4> <output_directory>")
        sys.exit(1)
        
    run_ablation(sys.argv[1], sys.argv[2])
