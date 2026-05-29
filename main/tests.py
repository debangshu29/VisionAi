import json
from unittest.mock import MagicMock, patch

import numpy as np
import cv2

from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse

from .companion_assistant import build_companion_reply
from .detector import CameraProcessor, SAFETY_CLASS_NAMES, _resolve_model_path
from .planner import (
    _classify_hand_pattern,
    answer_indoor_question,
    answer_scene_question,
    build_scene_guidance,
    infer_indoor_room,
    is_blocking_navigation_class,
    read_visible_text,
)
from .policy import FeedbackPolicy
from .tracker import reset_tracker, update_tracker


class PlannerTests(SimpleTestCase):
    def test_clear_path_when_no_tracks_are_present(self):
        scene = build_scene_guidance([], (480, 640, 3))

        self.assertEqual(scene["command"], "CLEAR")
        self.assertTrue(scene["path_clear"])
        self.assertEqual(scene["safe_direction"], "forward")

    def test_center_obstacle_triggers_stop(self):
        tracks = [
            {
                "track_id": 1,
                "xyxy": [220, 120, 430, 470],
                "class_name": "person",
                "confidence": 0.96,
            }
        ]

        scene = build_scene_guidance(tracks, (480, 640, 3))

        self.assertEqual(scene["command"], "STOP")
        self.assertFalse(scene["path_clear"])
        self.assertIn(scene["safe_direction"], {"left", "right", "wait"})

    def test_center_obstacle_does_not_report_clear_path_when_still_ahead(self):
        tracks = [
            {
                "track_id": 12,
                "xyxy": [260, 170, 380, 360],
                "class_name": "chair",
                "confidence": 0.9,
            }
        ]

        scene = build_scene_guidance(tracks, (480, 640, 3))

        self.assertIn(scene["command"], {"SLOW", "STOP"})
        self.assertFalse(scene["path_clear"])

    def test_left_side_obstacle_prefers_right_side(self):
        tracks = [
            {
                "track_id": 2,
                "xyxy": [20, 160, 230, 430],
                "class_name": "chair",
                "confidence": 0.88,
            }
        ]

        scene = build_scene_guidance(tracks, (480, 640, 3))

        self.assertEqual(scene["safe_direction"], "right")
        self.assertIn(scene["command"], {"MOVE_RIGHT", "CLEAR"})

    def test_question_answer_uses_scene_guidance(self):
        scene = build_scene_guidance(
            [
                {
                    "track_id": 3,
                    "xyxy": [410, 170, 610, 450],
                    "class_name": "car",
                    "confidence": 0.91,
                }
            ],
            (480, 640, 3),
        )

        answer = answer_scene_question("Which side is safer?", scene)

        self.assertEqual(answer["intent"], "safe_direction")
        self.assertIn(scene["safe_direction"], answer["answer"].lower())

    def test_unknown_daily_object_is_kept_in_scene_output(self):
        scene = build_scene_guidance(
            [
                {
                    "track_id": 4,
                    "xyxy": [250, 220, 340, 410],
                    "class_name": "bottle",
                    "confidence": 0.87,
                }
            ],
            (480, 640, 3),
        )

        self.assertEqual(scene["obstacles"][0]["class_name"], "bottle")
        self.assertEqual(scene["object_counts"]["bottle"], 1)

    def test_walkable_context_does_not_trigger_obstacle_guidance(self):
        scene = build_scene_guidance(
            [
                {
                    "track_id": 41,
                    "xyxy": [0, 160, 640, 470],
                    "class_name": "sidewalk",
                    "confidence": 0.91,
                }
            ],
            (480, 640, 3),
        )

        self.assertEqual(scene["command"], "CLEAR")
        self.assertTrue(scene["path_clear"])
        self.assertEqual(scene["obstacles"], [])
        self.assertEqual(scene["object_counts"]["sidewalk"], 1)
        self.assertFalse(is_blocking_navigation_class("zebra_cross"))
        self.assertTrue(is_blocking_navigation_class("traffic_cone"))

    def test_indoor_room_estimate_prefers_washroom_landmarks(self):
        scene = build_scene_guidance(
            [
                {
                    "track_id": 5,
                    "xyxy": [160, 120, 300, 430],
                    "class_name": "toilet",
                    "confidence": 0.95,
                },
                {
                    "track_id": 6,
                    "xyxy": [320, 160, 470, 420],
                    "class_name": "sink",
                    "confidence": 0.91,
                },
            ],
            (480, 640, 3),
        )

        guess = infer_indoor_room(scene)

        self.assertEqual(guess["key"], "washroom")
        self.assertIn("sink", guess["reason"].lower())

    def test_indoor_find_mode_reports_visible_object_direction(self):
        scene = build_scene_guidance(
            [
                {
                    "track_id": 7,
                    "xyxy": [420, 170, 610, 450],
                    "class_name": "chair",
                    "confidence": 0.93,
                }
            ],
            (480, 640, 3),
        )

        answer = answer_indoor_question("Find the chair", scene, "find")

        self.assertEqual(answer["mode"], "find")
        self.assertIn("chair", answer["answer"].lower())
        self.assertIn("right", answer["answer"].lower())

    def test_navigator_mode_routes_find_question(self):
        scene = build_scene_guidance(
            [
                {
                    "track_id": 70,
                    "xyxy": [420, 170, 610, 450],
                    "class_name": "chair",
                    "confidence": 0.93,
                }
            ],
            (480, 640, 3),
        )

        answer = answer_indoor_question("Find the chair", scene, "navigator")

        self.assertEqual(answer["mode"], "navigator")
        self.assertIn("chair", answer["answer"].lower())
        self.assertEqual(answer["insight"]["resolved_mode"], "find")

    @patch("main.planner.detect_hand_sign")
    @patch("main.planner.read_visible_text")
    def test_find_question_skips_ocr_and_hand_analysis(self, mock_read_visible_text, mock_detect_hand_sign):
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        scene = build_scene_guidance(
            [
                {
                    "track_id": 72,
                    "xyxy": [420, 170, 610, 450],
                    "class_name": "chair",
                    "confidence": 0.93,
                }
            ],
            frame.shape,
        )

        answer = answer_indoor_question("Find the chair", scene, "navigator", frame)

        self.assertIn("chair", answer["answer"].lower())
        mock_read_visible_text.assert_not_called()
        mock_detect_hand_sign.assert_not_called()

    @patch("main.planner._ocr_is_available", return_value=True)
    @patch("main.planner.pytesseract")
    def test_read_visible_text_interprets_common_sign(self, mock_tesseract, _mock_available):
        mock_tesseract.image_to_string.return_value = "WASHRROM"
        frame = np.full((120, 220, 3), 255, dtype=np.uint8)

        result = read_visible_text(frame)

        self.assertEqual(result["status"], "found")
        self.assertEqual(result["room_hint"], "washroom")
        self.assertIn("washroom", result["message"].lower())

    @patch("main.planner._door_like_hint")
    @patch("main.planner._ocr_is_available", return_value=True)
    @patch("main.planner.pytesseract")
    def test_read_visible_text_prefers_door_label_region_with_confidence(
        self,
        mock_tesseract,
        _mock_available,
        mock_door_hint,
    ):
        mock_door_hint.return_value = {
            "status": "found",
            "message": "I can also see a door-like vertical surface straight ahead.",
            "confidence": "high",
            "xyxy": [70, 20, 250, 220],
            "zone": "center",
        }
        mock_tesseract.image_to_data.return_value = {
            "text": ["WASHRROM"],
            "conf": ["94"],
            "block_num": [1],
            "par_num": [1],
            "line_num": [1],
            "top": [16],
            "left": [20],
        }
        mock_tesseract.image_to_string.return_value = ""
        frame = np.full((240, 320, 3), 255, dtype=np.uint8)

        result = read_visible_text(frame)

        self.assertEqual(result["status"], "found")
        self.assertEqual(result["confidence"], "high")
        self.assertEqual(result["source_region"], "door_upper")
        self.assertIn("door sign", result["message"].lower())
        self.assertIn("washroom", result["message"].lower())

    @patch("main.planner._door_like_hint")
    @patch("main.planner._ocr_is_available", return_value=True)
    @patch("main.planner.pytesseract")
    def test_read_visible_text_coaches_user_when_door_text_is_unclear(
        self,
        mock_tesseract,
        _mock_available,
        mock_door_hint,
    ):
        mock_door_hint.return_value = {
            "status": "found",
            "message": "I can also see a door-like vertical surface straight ahead.",
            "confidence": "medium",
            "xyxy": [70, 20, 250, 220],
            "zone": "center",
        }
        mock_tesseract.image_to_data.return_value = {
            "text": [],
            "conf": [],
            "block_num": [],
            "par_num": [],
            "line_num": [],
            "top": [],
            "left": [],
        }
        mock_tesseract.image_to_string.return_value = ""
        frame = np.full((240, 320, 3), 255, dtype=np.uint8)

        result = read_visible_text(frame)

        self.assertEqual(result["status"], "no_text")
        self.assertIn("upper half of that door", result["message"].lower())

    @patch("main.planner._ocr_is_available", return_value=True)
    @patch("main.planner.pytesseract")
    def test_room_mode_answers_with_read_sign_text(self, mock_tesseract, _mock_available):
        mock_tesseract.image_to_string.return_value = "Reception"
        frame = np.full((120, 220, 3), 255, dtype=np.uint8)
        scene = build_scene_guidance([], frame.shape)

        answer = answer_indoor_question("Read the sign in front of me", scene, "room", frame)

        self.assertEqual(answer["mode"], "room")
        self.assertIn("reception", answer["answer"].lower())

    @patch("main.planner._ocr_is_available", return_value=True)
    @patch("main.planner.pytesseract")
    def test_navigator_mode_routes_room_question(self, mock_tesseract, _mock_available):
        mock_tesseract.image_to_string.return_value = "Reception"
        frame = np.full((120, 220, 3), 255, dtype=np.uint8)
        scene = build_scene_guidance([], frame.shape)

        answer = answer_indoor_question("What is written on the door?", scene, "navigator", frame)

        self.assertEqual(answer["mode"], "navigator")
        self.assertIn("reception", answer["answer"].lower())
        self.assertEqual(answer["insight"]["resolved_mode"], "room")

    @patch("main.planner.detect_hand_sign")
    @patch("main.planner.read_visible_text")
    def test_explore_mode_empty_prompt_stays_lightweight(self, mock_read_visible_text, mock_detect_hand_sign):
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        frame[140:430, 280:360] = (255, 0, 0)
        scene = build_scene_guidance(
            [
                {
                    "track_id": 73,
                    "xyxy": [280, 140, 360, 430],
                    "class_name": "bottle",
                    "confidence": 0.95,
                }
            ],
            frame.shape,
        )

        answer = answer_indoor_question("", scene, "explore", frame)
        lowered = answer["answer"].lower()

        self.assertEqual(answer["mode"], "explore")
        self.assertIn("main visible object", lowered)
        mock_read_visible_text.assert_not_called()
        mock_detect_hand_sign.assert_not_called()

    def test_describe_mode_reports_color_shape_and_size(self):
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        frame[120:420, 280:360] = (255, 0, 0)
        scene = build_scene_guidance(
            [
                {
                    "track_id": 8,
                    "xyxy": [280, 120, 360, 420],
                    "class_name": "bottle",
                    "confidence": 0.94,
                }
            ],
            frame.shape,
        )

        answer = answer_indoor_question("Describe the bottle in front of me", scene, "describe", frame)
        lowered = answer["answer"].lower()

        self.assertIn("bottle", lowered)
        self.assertIn("blue", lowered)
        self.assertIn("shape", lowered)
        self.assertIn("frame width", lowered)

    def test_describe_mode_can_describe_full_scene(self):
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        frame[150:420, 60:220] = (0, 180, 0)
        frame[180:430, 330:390] = (255, 0, 0)
        scene = build_scene_guidance(
            [
                {
                    "track_id": 9,
                    "xyxy": [60, 150, 220, 420],
                    "class_name": "chair",
                    "confidence": 0.91,
                },
                {
                    "track_id": 10,
                    "xyxy": [330, 180, 390, 430],
                    "class_name": "bottle",
                    "confidence": 0.9,
                },
            ],
            frame.shape,
        )

        answer = answer_indoor_question("Describe everything in front of me", scene, "describe", frame)
        lowered = answer["answer"].lower()

        self.assertIn("chair", lowered)
        self.assertIn("bottle", lowered)

    def test_explore_question_can_identify_main_object_without_naming_it(self):
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        frame[140:430, 280:360] = (255, 0, 0)
        scene = build_scene_guidance(
            [
                {
                    "track_id": 11,
                    "xyxy": [280, 140, 360, 430],
                    "class_name": "bottle",
                    "confidence": 0.95,
                }
            ],
            frame.shape,
        )

        answer = answer_indoor_question("What is in front of me?", scene, "explore", frame)
        lowered = answer["answer"].lower()

        self.assertIn("bottle", lowered)
        self.assertIn("main visible object", lowered)

    def test_navigator_mode_redirects_full_description_to_describe_page(self):
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        frame[140:430, 280:360] = (255, 0, 0)
        scene = build_scene_guidance(
            [
                {
                    "track_id": 71,
                    "xyxy": [280, 140, 360, 430],
                    "class_name": "bottle",
                    "confidence": 0.95,
                }
            ],
            frame.shape,
        )

        answer = answer_indoor_question("Describe everything in front of me", scene, "navigator", frame)

        self.assertEqual(answer["mode"], "navigator")
        self.assertIn("describe page", answer["answer"].lower())

    @patch("main.planner.detect_hand_sign")
    def test_hand_sign_mode_reports_detected_gesture(self, mock_detect_hand_sign):
        mock_detect_hand_sign.return_value = {
            "status": "found",
            "label": "thumbs up",
            "message": "I can see a thumbs-up gesture.",
            "handedness": "right",
            "raised_count": 1,
            "raised_fingers": ["thumb"],
        }
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        scene = build_scene_guidance([], frame.shape)

        answer = answer_indoor_question("What hand sign do you see?", scene, "gesture", frame)

        self.assertEqual(answer["mode"], "gesture")
        self.assertIn("thumbs-up", answer["answer"].lower())

    @patch("main.planner.detect_hand_sign")
    def test_hand_sign_mode_reports_missing_dependency(self, mock_detect_hand_sign):
        mock_detect_hand_sign.return_value = {
            "status": "unavailable",
            "label": "",
            "message": "Hand-sign reading needs the mediapipe package installed in this environment.",
        }
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        scene = build_scene_guidance([], frame.shape)

        answer = answer_indoor_question("", scene, "gesture", frame)

        self.assertEqual(answer["mode"], "gesture")
        self.assertIn("mediapipe", answer["answer"].lower())

    def test_hand_sign_classifier_supports_letter_l_pattern(self):
        raised = {"thumb": True, "index": True, "middle": False, "ring": False, "pinky": False}
        metrics = {
            "thumb_index_spread": 1.24,
            "thumb_middle_gap": 1.1,
            "index_middle_spread": 0.25,
            "middle_ring_spread": 0.2,
            "ring_pinky_spread": 0.2,
            "thumb_outside": 1.05,
            "thumb_above_wrist": False,
            "thumb_middle_touch": False,
            "fingers_grouped": False,
        }

        self.assertEqual(_classify_hand_pattern(raised, metrics), "asl_letter_l")

    def test_hand_sign_classifier_supports_open_palm_pattern(self):
        raised = {"thumb": True, "index": True, "middle": True, "ring": True, "pinky": True}
        metrics = {
            "thumb_index_spread": 1.25,
            "thumb_middle_gap": 1.0,
            "index_middle_spread": 0.55,
            "middle_ring_spread": 0.5,
            "ring_pinky_spread": 0.48,
            "thumb_outside": 1.1,
            "thumb_above_wrist": False,
            "thumb_middle_touch": False,
            "fingers_grouped": False,
        }

        self.assertEqual(_classify_hand_pattern(raised, metrics), "open_palm")

    def test_hand_sign_classifier_supports_thumbs_up_pattern(self):
        raised = {"thumb": True, "index": False, "middle": False, "ring": False, "pinky": False}
        metrics = {
            "thumb_index_spread": 0.8,
            "thumb_middle_gap": 0.7,
            "index_middle_spread": 0.2,
            "middle_ring_spread": 0.2,
            "ring_pinky_spread": 0.2,
            "thumb_outside": 1.0,
            "thumb_above_wrist": True,
            "thumb_middle_touch": False,
            "fingers_grouped": False,
        }

        self.assertEqual(_classify_hand_pattern(raised, metrics), "thumbs_up")

    @patch("main.planner.detect_hand_sign")
    def test_hand_sign_mode_answers_letter_meaning_and_confidence(self, mock_detect_hand_sign):
        mock_detect_hand_sign.return_value = {
            "status": "found",
            "label": "ASL letter L",
            "message": "This looks like the ASL letter L, made with the thumb and index finger.",
            "category": "alphabet",
            "confidence": "high",
            "meaning": "the letter L",
            "handedness": "right",
            "raised_count": 2,
            "raised_fingers": ["thumb", "index"],
        }
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        scene = build_scene_guidance([], frame.shape)

        answer = answer_indoor_question(
            "What alphabet sign do you see, what does it mean, and how sure are you?",
            scene,
            "gesture",
            frame,
        )
        lowered = answer["answer"].lower()

        self.assertEqual(answer["mode"], "gesture")
        self.assertIn("letter l", lowered)
        self.assertIn("confidence is high", lowered)


class TrackerTests(SimpleTestCase):
    def setUp(self):
        reset_tracker()

    def test_tracker_keeps_same_id_for_same_box(self):
        first = update_tracker(
            [{"xyxy": [100, 100, 220, 260], "class_name": "person", "conf": 0.91}],
            None,
        )
        second = update_tracker(
            [{"xyxy": [106, 104, 226, 264], "class_name": "person", "conf": 0.93}],
            None,
        )

        self.assertEqual(len(first), 1)
        self.assertEqual(len(second), 1)
        self.assertEqual(first[0]["track_id"], second[0]["track_id"])

    def test_tracker_stabilizes_label_with_recent_history(self):
        update_tracker(
            [{"xyxy": [80, 120, 210, 300], "class_name": "chair", "conf": 0.86}],
            None,
        )
        update_tracker(
            [{"xyxy": [84, 122, 214, 304], "class_name": "chair", "conf": 0.89}],
            None,
        )
        stable = update_tracker(
            [{"xyxy": [88, 126, 218, 308], "class_name": "couch", "conf": 0.52}],
            None,
        )

        self.assertEqual(len(stable), 1)
        self.assertEqual(stable[0]["class_name"], "chair")

    def test_tracker_keeps_recent_track_for_short_detection_drop(self):
        update_tracker(
            [{"xyxy": [120, 110, 240, 290], "class_name": "person", "conf": 0.92}],
            None,
        )
        dropped_once = update_tracker([], None)

        self.assertEqual(len(dropped_once), 1)
        self.assertEqual(dropped_once[0]["class_name"], "person")
        self.assertEqual(dropped_once[0]["missed"], 1)


class FeedbackPolicyTests(SimpleTestCase):
    def test_pretrained_navigation_classes_include_common_indoor_obstacles(self):
        self.assertIn("chair", SAFETY_CLASS_NAMES)
        self.assertIn("dining table", SAFETY_CLASS_NAMES)
        self.assertIn("suitcase", SAFETY_CLASS_NAMES)
        self.assertEqual(_resolve_model_path().name, "yolov8n.pt")

    def test_policy_preserves_lateral_planner_command(self):
        policy = FeedbackPolicy()
        scene = {
            "command": "MOVE_RIGHT",
            "obstacles": [
                {
                    "class_name": "obstacle",
                    "confidence": 0.9,
                    "distance_m": 4.0,
                    "ttc_seconds": None,
                }
            ],
            "traversability_grid": None,
        }

        result = policy.evaluate(scene, ablation_level=1)

        self.assertEqual(result["command"], "MOVE_RIGHT")

    def test_policy_preserves_planner_stop_for_chair(self):
        policy = FeedbackPolicy()
        scene = {
            "command": "STOP",
            "obstacles": [
                {
                    "class_name": "chair",
                    "confidence": 0.9,
                    "distance_m": 1.4,
                    "ttc_seconds": None,
                }
            ],
            "traversability_grid": None,
        }

        result = policy.evaluate(scene, ablation_level=1)

        self.assertEqual(result["command"], "STOP")

    def test_detector_policy_keeps_planner_spoken_message_when_command_matches(self):
        processor = CameraProcessor()
        scene = {
            "command": "SLOW",
            "urgency": "high",
            "path_clear": False,
            "safe_direction": "left",
            "spoken_message": "Slow down. Person is ahead. Safest direction is left.",
            "palette": {"urgency": "#b04831"},
        }

        updated = processor._apply_policy_result(scene, {"command": "SLOW", "should_speak": False})

        self.assertEqual(updated["spoken_message"], "Slow down. Person is ahead. Safest direction is left.")

    def test_detector_policy_uses_natural_message_for_upgraded_stop(self):
        processor = CameraProcessor()
        scene = {
            "command": "SLOW",
            "urgency": "high",
            "path_clear": False,
            "safe_direction": "left",
            "estimated_clear_steps": 2,
            "spoken_message": "Slow down.",
            "primary_obstacle": {"class_name": "person", "steps_away": 2},
            "palette": {"urgency": "#b04831"},
        }

        updated = processor._apply_policy_result(scene, {"command": "STOP", "should_speak": True})

        self.assertEqual(updated["command"], "STOP")
        self.assertNotEqual(updated["spoken_message"], "STOP")
        self.assertIn("Stop.", updated["spoken_message"])


class CameraProcessorStartupTests(SimpleTestCase):
    @patch("main.detector.threading.Thread")
    def test_start_opens_camera_before_model_loading(self, mock_thread):
        processor = CameraProcessor()
        with patch.object(processor, "_open_camera") as mock_open_camera:
            with patch.object(processor, "_ensure_model") as mock_ensure_model:
                mock_open_camera.return_value = MagicMock()

                processor.start()

        mock_open_camera.assert_called_once()
        mock_ensure_model.assert_not_called()
        self.assertTrue(processor.running)
        mock_thread.return_value.start.assert_called()
        processor.stop()

    def test_latest_jpeg_falls_back_to_raw_frame_before_annotation(self):
        processor = CameraProcessor()
        with processor.frame_lock:
            processor.latest_frame = np.zeros((32, 32, 3), dtype=np.uint8)

        jpeg = processor.get_latest_jpeg()

        self.assertIsNotNone(jpeg)
        self.assertTrue(jpeg.startswith(b"\xff\xd8"))

    def test_unknown_obstacle_fallback_detects_large_center_object(self):
        processor = CameraProcessor()
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.rectangle(frame, (210, 210), (440, 470), (245, 245, 245), -1)

        detections = processor._detect_unknown_obstacles(frame, [])

        self.assertGreaterEqual(len(detections), 1)
        self.assertEqual(detections[0]["class_name"], "obstacle")
        self.assertEqual(detections[0]["source"], "unknown_obstacle_fallback")

    def test_unknown_obstacle_fallback_skips_known_detection_overlap(self):
        processor = CameraProcessor()
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.rectangle(frame, (210, 210), (440, 470), (245, 245, 245), -1)
        known = [{"xyxy": [200, 200, 450, 475], "class_name": "chair", "conf": 0.8}]

        detections = processor._detect_unknown_obstacles(frame, known)

        self.assertEqual(detections, [])


@override_settings(GEMINI_API_KEY="")
class CompanionAssistantTests(SimpleTestCase):
    def test_companion_routes_describe_request_to_describe_page(self):
        response, _memory = build_companion_reply(
            "Describe everything in front of me",
            {"page": "home"},
        )

        self.assertIn("describe page", response["reply"].lower())
        self.assertEqual(response["actions"][0]["tool"], "delegate_page")
        self.assertEqual(response["actions"][0]["page"], "describe")

    def test_companion_uses_memory_for_follow_up_contact_call(self):
        _response, memory = build_companion_reply(
            "Save contact Rahul 9876543210",
            {"page": "home"},
        )
        response, _memory = build_companion_reply(
            "Call him",
            {"page": "home"},
            memory,
        )

        self.assertEqual(response["actions"][0]["tool"], "call_contact")
        self.assertEqual(response["actions"][0]["target"], "Rahul")

    def test_companion_saves_contact_from_more_natural_phrase(self):
        response, _memory = build_companion_reply(
            "Save Rahul's number as 9876543210",
            {"page": "home"},
        )

        self.assertEqual(response["actions"][0]["tool"], "save_contact")
        self.assertEqual(response["actions"][0]["name"], "Rahul")
        self.assertEqual(response["actions"][0]["number"], "9876543210")

    def test_companion_opens_youtube_from_local_planner(self):
        response, _memory = build_companion_reply(
            "Open YouTube",
            {"page": "home"},
        )

        self.assertEqual(response["actions"][0]["tool"], "open_site")
        self.assertEqual(response["actions"][0]["site"], "youtube")

    def test_companion_searches_maps_from_local_planner(self):
        response, _memory = build_companion_reply(
            "Search maps for nearest ATM",
            {"page": "home"},
        )

        self.assertEqual(response["actions"][0]["tool"], "open_site")
        self.assertEqual(response["actions"][0]["site"], "maps")
        self.assertEqual(response["actions"][0]["query"], "nearest ATM")

    def test_companion_opens_google_search_for_generic_search_phrase(self):
        response, _memory = build_companion_reply(
            "Search for assistive smart glasses",
            {"page": "home"},
        )

        self.assertEqual(response["actions"][0]["tool"], "open_site")
        self.assertEqual(response["actions"][0]["site"], "google")
        self.assertEqual(response["actions"][0]["query"], "assistive smart glasses")

    def test_companion_does_not_mistake_broad_travel_question_for_indoor_page(self):
        response, _memory = build_companion_reply(
            "Where can I go today?",
            {"page": "home"},
            {"last_page_focus": "indoor", "turns": []},
        )

        self.assertEqual(response["actions"][0]["tool"], "open_site")
        self.assertEqual(response["actions"][0]["site"], "google")
        self.assertIn("where can i go today", response["actions"][0]["query"].lower())

    def test_companion_delegates_route_question_to_outdoor_page(self):
        response, _memory = build_companion_reply(
            "Is there any pharmacy on my route?",
            {"page": "outdoor"},
        )

        self.assertEqual(response["actions"][0]["tool"], "delegate_page")
        self.assertEqual(response["actions"][0]["page"], "current")

    def test_companion_opens_google_for_unrelated_question_when_gemini_is_unavailable(self):
        response, _memory = build_companion_reply(
            "Who won the world cup in 1998?",
            {"page": "home"},
        )

        self.assertEqual(response["actions"][0]["tool"], "open_site")
        self.assertEqual(response["actions"][0]["site"], "google")

    def test_companion_delegates_broader_live_follow_up_on_current_page(self):
        response, _memory = build_companion_reply(
            "Check this for me",
            {
                "page": "home",
                "current_guidance": "Path seems clear.",
                "assistant": {"reply": "I can see the path ahead."},
            },
        )

        self.assertEqual(response["actions"][0]["tool"], "delegate_page")
        self.assertEqual(response["actions"][0]["page"], "current")

    @patch("main.companion_assistant._plan_with_gemini", return_value=None)
    def test_companion_falls_back_to_local_delegate_when_gemini_is_unavailable(self, mock_plan_with_gemini):
        response, _memory = build_companion_reply(
            "What is in front of me?",
            {"page": "home"},
        )

        self.assertEqual(response["actions"][0]["tool"], "delegate_page")
        self.assertEqual(response["actions"][0]["page"], "current")
        mock_plan_with_gemini.assert_not_called()

    @patch("main.companion_assistant._plan_with_gemini")
    def test_companion_uses_gemini_plan_when_available(self, mock_plan_with_gemini):
        mock_plan_with_gemini.return_value = {
            "reply": "I can help with that from the current site context.",
            "actions": [],
        }

        response, _memory = build_companion_reply(
            "Be more adaptive for this situation.",
            {"page": "home"},
        )

        self.assertIn("current site context", response["reply"].lower())
        mock_plan_with_gemini.assert_called_once()

    @patch("main.companion_assistant._plan_with_gemini")
    def test_companion_keeps_simple_browser_action_local_without_spending_gemini(self, mock_plan_with_gemini):
        response, _memory = build_companion_reply(
            "Open YouTube",
            {"page": "home"},
        )

        self.assertEqual(response["actions"][0]["tool"], "open_site")
        self.assertEqual(response["actions"][0]["site"], "youtube")
        mock_plan_with_gemini.assert_not_called()


class ViewTests(SimpleTestCase):
    def test_home_page_loads(self):
        response = self.client.get(reverse("home"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Assistive Vision Navigator")

    @patch("main.views._camera")
    def test_home_page_render_does_not_start_camera(self, mock_camera):
        response = self.client.get(reverse("home"))

        self.assertEqual(response.status_code, 200)
        mock_camera.assert_not_called()

    def test_outdoor_navigation_page_loads(self):
        response = self.client.get(reverse("outdoor_navigation"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Outdoor Navigation")

    def test_indoor_assistant_page_loads(self):
        response = self.client.get(reverse("indoor_assistant"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Indoor Navigation")

    def test_indoor_describe_page_loads(self):
        response = self.client.get(reverse("indoor_describe"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Detailed object and scene explanation on a separate page.")

    @patch("main.views._ensure_camera_started")
    def test_latest_scene_api_requests_full_analysis_by_default(self, mock_ensure_camera_started):
        camera = mock_ensure_camera_started.return_value
        camera.analyze_current_scene.return_value = {
            "command": "CLEAR",
            "spoken_message": "Path seems clear.",
            "detections": [],
        }

        response = self.client.get(reverse("latest_scene_api"))

        self.assertEqual(response.status_code, 200)
        camera.analyze_current_scene.assert_called_once_with(profile="full")
        camera.get_latest_scene.assert_not_called()

    @patch("main.views._ensure_camera_started")
    def test_latest_safety_scene_api_requests_safety_view(self, mock_ensure_camera_started):
        camera = mock_ensure_camera_started.return_value
        camera.get_latest_scene.return_value = {
            "command": "CLEAR",
            "spoken_message": "Path seems clear.",
            "detections": [],
        }

        response = self.client.get(reverse("latest_safety_scene_api"))

        self.assertEqual(response.status_code, 200)
        camera.get_latest_scene.assert_called_once_with(view="safety")

    @patch("main.views.answer_indoor_question")
    @patch("main.views._ensure_camera_started")
    def test_indoor_assist_api_uses_full_scene_for_non_empty_prompt(
        self,
        mock_ensure_camera_started,
        mock_answer_indoor_question,
    ):
        camera = mock_ensure_camera_started.return_value
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        camera.get_latest_frame.return_value = frame
        camera.analyze_current_scene.return_value = build_scene_guidance([], frame.shape)
        mock_answer_indoor_question.return_value = {
            "question": "What is in front of me",
            "mode": "explore",
            "answer": "I can see an object.",
            "insight": {},
        }

        response = self.client.get(
            reverse("indoor_assist_api"),
            {"q": "What is in front of me", "mode": "explore"},
        )

        self.assertEqual(response.status_code, 200)
        camera.analyze_current_scene.assert_called_once_with(profile="full")

    @patch("main.views.requests.get")
    def test_directions_api_uses_timeout(self, mock_get):
        response_mock = mock_get.return_value
        response_mock.raise_for_status.return_value = None
        response_mock.json.return_value = {"routes": []}

        response = self.client.get(
            reverse("directions_api"),
            {"origin": "Kolkata", "destination": "Howrah"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_get.call_args.kwargs["timeout"], 10)


@override_settings(GEMINI_API_KEY="")
class CompanionViewTests(TestCase):
    @override_settings(GEMINI_API_KEY="")
    def test_companion_realtime_token_api_requires_configured_key(self):
        response = self.client.get(reverse("companion_realtime_token_api"))

        self.assertEqual(response.status_code, 503)

    @override_settings(
        GEMINI_API_KEY="test-key",
        GEMINI_LIVE_MODEL="gemini-2.5-flash-native-audio-preview-12-2025",
    )
    @patch("main.views.genai.Client")
    def test_companion_realtime_token_api_returns_gemini_payload(self, mock_client_cls):
        mock_client = mock_client_cls.return_value
        mock_client.auth_tokens.create.return_value = type(
            "_Token",
            (),
            {"name": "auth_tokens/demo_123"},
        )()

        response = self.client.get(reverse("companion_realtime_token_api"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["value"], "auth_tokens/demo_123")
        self.assertEqual(response.json()["provider"], "gemini")

    def test_companion_chat_api_returns_actions(self):
        response = self.client.post(
            reverse("companion_chat_api"),
            data=json.dumps(
                {
                    "message": "Open indoor navigation",
                    "context": {"page": "home"},
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["actions"][0]["tool"], "switch_page")
        self.assertEqual(payload["actions"][0]["page"], "indoor")

    def test_companion_chat_api_keeps_session_memory(self):
        self.client.post(
            reverse("companion_chat_api"),
            data=json.dumps(
                {
                    "message": "Save contact Rahul 9876543210",
                    "context": {"page": "home"},
                }
            ),
            content_type="application/json",
        )
        response = self.client.post(
            reverse("companion_chat_api"),
            data=json.dumps(
                {
                    "message": "Call him",
                    "context": {"page": "home"},
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["actions"][0]["tool"], "call_contact")
        self.assertEqual(payload["actions"][0]["target"], "Rahul")
