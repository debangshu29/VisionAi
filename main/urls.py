from django.urls import path

from . import views


urlpatterns = [
    path("", views.home, name="home"),
    path("live/", views.live, name="live"),
    path("outdoor/", views.outdoor_navigation, name="outdoor_navigation"),
    path("indoor/", views.indoor_assistant, name="indoor_assistant"),
    path("describe/", views.indoor_describe, name="indoor_describe"),
    path("video_feed/", views.mjpeg_feed, name="video_feed"),
    path("api/latest/", views.latest_detections_api, name="latest_detections_api"),
    path("api/scene/", views.latest_scene_api, name="latest_scene_api"),
    path("api/scene/safety/", views.latest_safety_scene_api, name="latest_safety_scene_api"),
    path("api/scene/context/", views.latest_context_scene_api, name="latest_context_scene_api"),
    path("api/ask/", views.scene_question_api, name="scene_question_api"),
    path("api/directions/", views.directions_api, name="directions_api"),
    path("api/indoor/", views.indoor_assist_api, name="indoor_assist_api"),
    path("api/companion/realtime-token/", views.companion_realtime_token_api, name="companion_realtime_token_api"),
    path("api/companion/chat/", views.companion_chat_api, name="companion_chat_api"),
]


