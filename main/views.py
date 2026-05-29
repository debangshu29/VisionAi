import json
import time
from datetime import datetime, timedelta, timezone

from django.conf import settings
from django.http import HttpResponse, JsonResponse, StreamingHttpResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt

from .companion_assistant import answer_companion_message
from .detector import get_camera_processor
from .planner import answer_indoor_question, answer_scene_question

try:
    from google import genai
    from google.genai import types as genai_types
except ImportError:  # pragma: no cover - exercised in runtime environments without the SDK.
    genai = None
    genai_types = None

MJPEG_STREAM_SLEEP_SECONDS = 0.015


def _companion_context(active_page, **extra):
    context = {
        "startup_error": "",
        "active_page": active_page,
        "companion_realtime_enabled": "true" if getattr(settings, "GEMINI_API_KEY", "").strip() else "false",
    }
    context.update(extra)
    return context


def _camera():
    return get_camera_processor()


def _ensure_camera_started():
    camera = _camera()
    if not camera.running:
        camera.start()
    return camera


def home(request):
    return render(request, "home.html", _companion_context("home"))


def live(request):
    return render(request, "live.html", _companion_context("live"))


def outdoor_navigation(request):
    return render(
        request,
        "outdoor.html",
        _companion_context(
            "outdoor",
            google_maps_api_key=settings.GOOGLE_MAPS_API_KEY,
        ),
    )


def indoor_assistant(request):
    return render(
        request,
        "indoor.html",
        _companion_context(
            "indoor",
            indoor_default_mode="navigator",
            indoor_mode_locked="true",
        ),
    )


def indoor_describe(request):
    return render(
        request,
        "indoor_describe.html",
        _companion_context(
            "describe",
            indoor_default_mode="describe",
            indoor_mode_locked="true",
        ),
    )


def mjpeg_feed(request):
    try:
        camera = _ensure_camera_started()
    except Exception as exc:
        return HttpResponse(f"Failed to start camera: {exc}", status=503)

    def gen():
        while True:
            jpeg = camera.get_latest_jpeg()
            if jpeg is None:
                time.sleep(MJPEG_STREAM_SLEEP_SECONDS)
                continue
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n"
            time.sleep(MJPEG_STREAM_SLEEP_SECONDS)

    return StreamingHttpResponse(
        gen(),
        content_type="multipart/x-mixed-replace; boundary=frame",
    )


def latest_detections_api(request):
    try:
        camera = _ensure_camera_started()
    except Exception as exc:
        return JsonResponse({"error": str(exc)}, status=503)
    return JsonResponse({"detections": camera.get_latest_detections()})


def latest_scene_api(request):
    view = request.GET.get("view", "full")
    try:
        camera = _ensure_camera_started()
    except Exception as exc:
        return JsonResponse({"error": str(exc)}, status=503)
    if view == "full":
        return JsonResponse({"scene": camera.analyze_current_scene(profile="full")})
    return JsonResponse({"scene": camera.get_latest_scene(view=view)})


def latest_safety_scene_api(request):
    try:
        camera = _ensure_camera_started()
    except Exception as exc:
        return JsonResponse({"error": str(exc)}, status=503)
    return JsonResponse({"scene": camera.get_latest_scene(view="safety")})


def latest_context_scene_api(request):
    try:
        camera = _ensure_camera_started()
    except Exception as exc:
        return JsonResponse({"error": str(exc)}, status=503)
    return JsonResponse({"scene": camera.get_latest_scene(view="context")})


import base64
import cv2
import numpy as np

def indoor_assist_api(request):
    question = request.GET.get("q", "")
    mode = request.GET.get("mode", "navigator")
    try:
        camera = _ensure_camera_started()
    except Exception as exc:
        return JsonResponse({"error": str(exc), "question": question, "mode": mode}, status=503)

    from .companion_assistant import answer_companion_message
    import base64

    frame = camera.get_latest_frame()

    # Offload "describe" entirely to the LLM (Gemini) to save local compute
    if mode == "describe":
        prompt = question if question.strip() else "Describe this scene in detail for a blind person."
        
        if frame is not None:
            from .planner import _call_gemini_vision
            answer_text = _call_gemini_vision(frame, prompt)
        else:
            answer_text = "I do not have a clear view to describe the scene right now."
            
        scene = camera.get_latest_scene(view="context")
        return JsonResponse({
            "question": question, 
            "mode": mode, 
            "answer": answer_text, 
            "scene": scene
        })

    if question.strip():
        try:
            scene = camera.analyze_current_scene(profile="full")
        except Exception as e:
            print(f"[Views] Error analyzing full scene: {e}")
            scene = camera.get_latest_scene(view="context")
    else:
        scene = camera.get_latest_scene(view="context")
        
    answer = answer_indoor_question(question, scene, mode, frame)
    return JsonResponse({"question": question, "mode": mode, "answer": answer, "scene": scene})





import requests

def scene_question_api(request):
    question = request.GET.get("q", "")
    try:
        camera = _ensure_camera_started()
    except Exception as exc:
        return JsonResponse({"error": str(exc), "question": question}, status=503)

    safety_scene = camera.get_latest_scene(view="safety")
    answer = answer_scene_question(question, safety_scene)
    return JsonResponse({"question": question, "answer": answer, "scene": camera.get_latest_scene(view="context")})

def directions_api(request):
    origin = request.GET.get('origin')
    destination = request.GET.get('destination')
    
    if not origin or not destination:
        return JsonResponse({"error": "Missing origin or destination"}, status=400)
        
    api_key = getattr(settings, "GOOGLE_MAPS_API_KEY", "").strip()
    if not api_key:
        return JsonResponse({"error": "Google Maps API Key not configured"}, status=503)
        
    url = "https://maps.googleapis.com/maps/api/directions/json"
    params = {
        "origin": origin,
        "destination": destination,
        "mode": "walking",
        "key": api_key
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return JsonResponse(response.json())
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
def companion_realtime_token_api(request):
    if request.method != "GET":
        return JsonResponse({"error": "GET is required."}, status=405)

    api_key = getattr(settings, "GEMINI_API_KEY", "").strip()
    if not api_key:
        return JsonResponse({"error": "Realtime voice is not configured on the server."}, status=503)
    if genai is None or genai_types is None:
        return JsonResponse({"error": "Gemini SDK is not installed on the server."}, status=503)

    model = getattr(settings, "GEMINI_LIVE_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025").strip()
    now = datetime.now(timezone.utc)
    try:
        client = genai.Client(
            api_key=api_key,
            http_options=genai_types.HttpOptions(api_version="v1alpha"),
        )
        token = client.auth_tokens.create(
            config=genai_types.CreateAuthTokenConfig(
                uses=1,
                expire_time=now + timedelta(minutes=20),
                new_session_expire_time=now + timedelta(minutes=5),
                http_options=genai_types.HttpOptions(api_version="v1alpha"),
                live_connect_constraints=genai_types.LiveConnectConstraints(
                    model=model,
                    config=genai_types.LiveConnectConfig(
                        response_modalities=["AUDIO"],
                        input_audio_transcription=genai_types.AudioTranscriptionConfig(),
                        output_audio_transcription=genai_types.AudioTranscriptionConfig(),
                    ),
                ),
                lock_additional_fields=[
                    "response_modalities",
                    "input_audio_transcription",
                    "output_audio_transcription",
                ],
            )
        )
    except Exception as e:
        print(f"[Views] Gemini realtime token creation failed: {e}")
        return JsonResponse({"error": "Failed to create a realtime session token."}, status=503)

    return JsonResponse(
        {
            "provider": "gemini",
            "value": getattr(token, "name", ""),
            "model": model,
        }
    )


@csrf_exempt
def companion_chat_api(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)

    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        return JsonResponse({"error": "Invalid JSON payload."}, status=400)

    message = str(payload.get("message") or "").strip()
    if not message:
        return JsonResponse({"error": "A message is required."}, status=400)

    context = payload.get("context") or {}
    response = answer_companion_message(message, context, request.session)
    return JsonResponse(response)

