import json
import re
import requests

from django.conf import settings

try:
    from google import genai
except ImportError:  # pragma: no cover - exercised in runtime environments without the SDK.
    genai = None

MEMORY_SESSION_KEY = "navi_companion_memory"
MAX_MEMORY_TURNS = 8
SUPPORTED_TOOLS = {
    "delegate_page",
    "switch_page",
    "repeat_guidance",
    "save_contact",
    "call_contact",
    "open_site",
    "open_music",
    "stop_music",
    "set_reminder",
    "list_reminders",
    "get_time",
    "get_date",
    "get_battery",
    "get_weather",
    "reply_only",
}
PAGE_LABELS = {
    "home": "the main dashboard",
    "indoor": "indoor navigation",
    "describe": "the describe page",
    "outdoor": "outdoor navigation",
    "current": "the current page",
}
PAGE_KEYWORDS = {
    "home": ("main dashboard", "main page", "dashboard", "home"),
    "indoor": ("indoor navigation", "indoor page", "indoor mode", "indoor"),
    "describe": ("describe page", "description page", "describe", "description"),
    "outdoor": ("outdoor navigation", "outdoor page", "outdoor mode", "outdoor"),
}
PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {
            "type": "string",
            "description": "Short conversational reply for spoken output. Keep it concise and natural.",
        },
        "actions": {
            "type": "array",
            "description": "Optional website actions Navi wants the app to perform.",
            "items": {
                "type": "object",
                "properties": {
                    "tool": {
                        "type": "string",
                        "enum": sorted(SUPPORTED_TOOLS),
                        "description": "Action name.",
                    },
                    "page": {
                        "type": ["string", "null"],
                        "description": "Target page for switch or delegate actions.",
                    },
                    "question": {
                        "type": ["string", "null"],
                        "description": "Question to send to the page assistant when delegating.",
                    },
                    "name": {
                        "type": ["string", "null"],
                        "description": "Contact name for save actions.",
                    },
                    "number": {
                        "type": ["string", "null"],
                        "description": "Phone number for save actions.",
                    },
                    "query": {
                        "type": ["string", "null"],
                        "description": "Search query for music actions.",
                    },
                    "site": {
                        "type": ["string", "null"],
                        "description": "Browser destination like maps, youtube, google, gmail, calendar, drive, or whatsapp.",
                    },
                    "text": {
                        "type": ["string", "null"],
                        "description": "Free-form text for reminders or direct replies.",
                    },
                    "target": {
                        "type": ["string", "null"],
                        "description": "Target contact or number to call.",
                    },
                    "delay_ms": {
                        "type": ["integer", "null"],
                        "description": "Reminder delay in milliseconds.",
                    },
                    "delay_value": {
                        "type": ["integer", "null"],
                        "description": "Human-readable reminder delay amount.",
                    },
                    "delay_unit": {
                        "type": ["string", "null"],
                        "description": "Reminder delay unit.",
                    },
                },
                "required": ["tool"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["reply", "actions"],
    "additionalProperties": False,
}
SCOPE_REPLY = (
    "My fuller Gemini assistant is not reachable right now. I can still help with "
    "assistive guidance on this website, page guidance, contacts, maps, YouTube, music, "
    "reminders, time, date, battery, weather, or open a Google search for you."
)
HELP_REPLY = (
    "I can switch pages, explain what this site is showing, continue indoor or outdoor "
    "assistive help, describe objects, start walking navigation from any page, search "
    "places along your route, repeat guidance, save contacts, call saved contacts, open "
    "maps, Google, YouTube, Gmail, Calendar, Drive, music, set reminders, and answer "
    "general questions along with time, date, battery, or weather."
)


def answer_companion_message(message, page_context, session):
    memory = _load_memory(session)
    response, memory = build_companion_reply(message, page_context, memory)
    _save_memory(session, memory)
    return response


def build_companion_reply(message, page_context=None, memory=None):
    text = _clean_text(message)
    context = _compact_context(page_context or {})
    memory = _normalize_memory(memory)

    if not text:
        response = {"reply": "I did not catch that. Please try again.", "actions": []}
        return response, memory

    local_plan = _plan_locally(text, context, memory)
    if _should_use_local_plan_first(local_plan):
        plan = local_plan
    else:
        plan = _plan_with_llm(text, context, memory) or local_plan

    memory = _update_memory(memory, text, plan, context)
    return {
        "reply": plan.get("reply", "").strip(),
        "actions": plan.get("actions", []),
        "memory": {
            "last_page_focus": memory.get("last_page_focus", ""),
            "last_contact_name": memory.get("last_contact_name", ""),
            "last_music_query": memory.get("last_music_query", ""),
            "recent_turns": len(memory.get("turns", [])),
        },
    }, memory


def _compact_context(page_context):
    safety = page_context.get("safety") or {}
    scene = page_context.get("scene") or page_context.get("context") or {}
    route = page_context.get("route") or {}
    assistant = page_context.get("assistant") or {}
    assistant_reply = (
        assistant.get("assistantReply")
        or assistant.get("reply")
        or page_context.get("assistant_reply")
        or ""
    )
    current_guidance = (
        page_context.get("current_guidance")
        or page_context.get("guidance")
        or assistant.get("guidance")
        or ""
    )
    object_counts = scene.get("object_counts") or {}
    top_objects = sorted(
        object_counts.items(),
        key=lambda item: (-int(item[1] or 0), item[0]),
    )[:5]

    return {
        "page": page_context.get("page") or "home",
        "current_guidance": _clean_text(current_guidance),
        "assistant_reply": _clean_text(assistant_reply),
        "assistant_mode": _clean_text(assistant.get("mode") or ""),
        "safety": {
            "command": safety.get("command") or "",
            "spoken_message": _clean_text(safety.get("spoken_message") or ""),
            "safe_direction": safety.get("safe_direction") or "",
            "path_clear": bool(safety.get("path_clear")),
            "urgency": safety.get("urgency") or "",
            "estimated_clear_steps": safety.get("estimated_clear_steps") or "",
            "primary_obstacle": (safety.get("primary_obstacle") or {}).get("class_name", ""),
        },
        "scene": {
            "scene_caption": _clean_text(scene.get("scene_caption") or ""),
            "summary": _clean_text(scene.get("summary") or ""),
            "top_objects": [name for name, _count in top_objects],
        },
        "route": {
            "destination_label": _clean_text(
                route.get("destination_label")
                or assistant.get("destinationLabel")
                or ""
            ),
            "next_instruction": _clean_text(
                route.get("next_instruction")
                or assistant.get("nextInstruction")
                or ""
            ),
            "status": _clean_text(route.get("status") or assistant.get("routeStatus") or ""),
        },
    }


def _plan_with_llm(message, context, memory):
    provider = getattr(settings, "NAVI_LLM_PROVIDER", "gemini").lower().strip()
    if provider == "ollama":
        return _plan_with_ollama(message, context, memory)
    return _plan_with_gemini(message, context, memory)


def _plan_with_ollama(message, context, memory):
    endpoint = getattr(settings, "NAVI_LLM_ENDPOINT", "http://127.0.0.1:11434/api/chat").strip()
    model = getattr(settings, "NAVI_LLM_MODEL", "llama3.2:3b").strip()
    timeout = getattr(settings, "NAVI_LLM_TIMEOUT_SECONDS", 12.0)
    max_tokens = int(getattr(settings, "NAVI_LLM_MAX_TOKENS", 220))

    if not endpoint or not model:
        return None

    system_prompt = (
        "You are Navi, a voice-first assistive companion inside a vision-aid website for "
        "blind and low-vision users. Sound warm, calm, and human. Replies should usually "
        "be one or two short spoken sentences, not paragraphs. You are both the website's "
        "assistive companion and a broader helper. Answer general questions "
        "naturally when no website action is needed. Use the website context when the user "
        "asks about the current page, current scene, current route, or what is happening on "
        "this site. Use switch_page to move between home, indoor, outdoor, or describe. Use "
        "delegate_page when the current or target page assistant should answer a scene, route, "
        "indoor, or description question. Use save_contact when the user wants to save a name "
        "and phone number. Use call_contact to call a saved person or phone number. Use "
        "open_site for common browser destinations like maps, youtube, google, gmail, "
        "calendar, drive, or whatsapp, and include a query when the user asks to search there. "
        "If the user asks to search the web, open Google unless another site is more suitable. "
        "Prefer concise spoken replies. Always return valid JSON with 'reply' (string) and "
        "'actions' (array)."
    )

    # Simplified turns for the local LLM to save context window.
    recent_turns = memory.get("turns", [])[-3:]
    turns_summary = "\n".join([f"User: {t['user']}\nNavi: {t['assistant']}" for t in recent_turns])

    prompt_content = (
        f"CONTEXT: {json.dumps(context)}\n"
        f"RECENT_TURNS: {turns_summary}\n"
        f"USER_MESSAGE: {message}"
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt_content},
        ],
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 0.2,
            "num_predict": max_tokens,
        },
    }

    try:
        resp = requests.post(endpoint, json=payload, timeout=timeout)
        resp.raise_for_status()
        result = resp.json()
        content = result.get("message", {}).get("content", "").strip()
        if not content:
            return None
        return _sanitize_plan(json.loads(content))
    except Exception as e:
        print(f"[CompanionAssistant] LLM Plan Error: {e}")
        return None


def _plan_with_gemini(message, context, memory):
    api_key = getattr(settings, "GEMINI_API_KEY", "").strip()
    if not api_key or genai is None:
        return None

    model = getattr(settings, "NAVI_GEMINI_MODEL", "gemini-2.5-flash").strip()
    if not model:
        return None

    system_prompt = (
        "You are Navi, a voice-first assistive companion inside a vision-aid website for "
        "blind and low-vision users. Sound warm, calm, and human. Replies should usually "
        "be one or two short spoken sentences, not paragraphs. You are both the website's "
        "assistive companion and a broader Gemini-style helper. Answer general questions "
        "naturally when no website action is needed. Use the website context when the user "
        "asks about the current page, current scene, current route, or what is happening on "
        "this site. Use switch_page to move between home, indoor, outdoor, or describe. Use "
        "delegate_page when the current or target page assistant should answer a scene, route, "
        "indoor, or description question. Use save_contact when the user wants to save a name "
        "and phone number. Use call_contact to call a saved person or phone number. Use "
        "open_site for common browser destinations like maps, youtube, google, gmail, "
        "calendar, drive, or whatsapp, and include a query when the user asks to search there. "
        "If the user asks to search the web, open Google unless another site is more suitable. "
        "Prefer concise spoken replies. Always return valid JSON matching the provided schema."
    )
    payload = json.dumps(
        {
            "message": message,
            "context": context,
            "memory": {
                "last_page_focus": memory.get("last_page_focus", ""),
                "last_contact_name": memory.get("last_contact_name", ""),
                "last_music_query": memory.get("last_music_query", ""),
                "recent_turns": memory.get("turns", [])[-4:],
            },
        },
        ensure_ascii=True,
    )

    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=model,
            contents=payload,
            config={
                "system_instruction": system_prompt,
                "temperature": 0.2,
                "max_output_tokens": int(
                    getattr(settings, "NAVI_GEMINI_MAX_TOKENS", 220)
                ),
                "response_mime_type": "application/json",
                "response_json_schema": PLAN_SCHEMA,
            },
        )
    except Exception as e:
        print(f"[CompanionAssistant] Gemini Request Error: {e}")
        return None

    text = _clean_text(getattr(response, "text", ""))
    if not text:
        return None

    try:
        return _sanitize_plan(json.loads(text))
    except json.JSONDecodeError:
        return None


def _sanitize_plan(plan):
    if not isinstance(plan, dict):
        return None

    reply = _clean_text(plan.get("reply") or "")
    actions = []
    for raw_action in plan.get("actions") or []:
        if not isinstance(raw_action, dict):
            continue
        tool = raw_action.get("tool")
        if tool not in SUPPORTED_TOOLS:
            continue
        action = {"tool": tool}
        for key in (
            "page",
            "question",
            "name",
            "number",
            "query",
            "site",
            "text",
            "target",
            "delay_ms",
            "delay_value",
            "delay_unit",
        ):
            value = raw_action.get(key)
            if value in ("", None):
                continue
            action[key] = value
        if "page" in action and action["page"] not in PAGE_LABELS:
            action["page"] = "current"
        actions.append(action)

    if not reply and not actions:
        return None
    return {"reply": reply or "I am ready.", "actions": actions}


def _should_use_local_plan_first(plan):
    if not isinstance(plan, dict):
        return False
    if plan.get("actions"):
        return True
    reply = _clean_text(plan.get("reply") or "")
    return reply == HELP_REPLY


def _plan_locally(message, context, memory):
    lowered = message.lower()
    current_page = context.get("page") or "home"

    switch_page = _extract_page_switch(message)
    if switch_page:
        page, follow_up = switch_page
        if follow_up:
            return {
                "reply": f"I will continue that on {PAGE_LABELS[page]}.",
                "actions": [{"tool": "delegate_page", "page": page, "question": follow_up}],
            }
        return {
            "reply": f"Opening {PAGE_LABELS[page]}.",
            "actions": [{"tool": "switch_page", "page": page}],
        }

    if re.search(r"\b(repeat guidance|repeat alert|say that again|current guidance)\b", lowered):
        return {"reply": "Repeating the latest guidance now.", "actions": [{"tool": "repeat_guidance"}]}

    contact = _extract_contact_save(message)
    if contact:
        return {
            "reply": f"I will save {contact['name']} as a contact.",
            "actions": [{"tool": "save_contact", "name": contact["name"], "number": contact["number"]}],
        }

    call_target = _extract_call_target(message, memory)
    if call_target:
        return {
            "reply": f"Calling {call_target}.",
            "actions": [{"tool": "call_contact", "target": call_target}],
        }

    generic_search = _extract_general_search(message)
    if generic_search:
        return {
            "reply": f"I will search Google for {generic_search}.",
            "actions": [{"tool": "open_site", "site": "google", "query": generic_search}],
        }

    site_action = _extract_site_action(message)
    if site_action:
        action = {"tool": "open_site", "site": site_action["site"]}
        if site_action.get("query"):
            action["query"] = site_action["query"]
        return {
            "reply": site_action["reply"],
            "actions": [action],
        }

    music_query = _extract_music_query(message, memory)
    if music_query:
        return {
            "reply": f"I will open music for {music_query}.",
            "actions": [{"tool": "open_music", "query": music_query}],
        }

    if re.search(r"\b(stop music|pause music|close music)\b", lowered):
        return {"reply": "Stopping the music window.", "actions": [{"tool": "stop_music"}]}

    reminder = _extract_reminder(message)
    if reminder:
        return {
            "reply": f"I will remind you to {reminder['text']} in {reminder['delay_value']} {reminder['delay_unit']}.",
            "actions": [{
                "tool": "set_reminder",
                "text": reminder["text"],
                "delay_ms": reminder["delay_ms"],
                "delay_value": reminder["delay_value"],
                "delay_unit": reminder["delay_unit"],
            }],
        }

    if re.search(r"\b(what reminders do i have|show reminders|list reminders|my reminders)\b", lowered):
        return {"reply": "Checking your reminders now.", "actions": [{"tool": "list_reminders"}]}

    if re.search(r"\b(what time is it|current time|time now|time)\b", lowered):
        return {"reply": "Checking the time now.", "actions": [{"tool": "get_time"}]}

    if re.search(r"\b(today'?s date|what is the date|date today|date)\b", lowered):
        return {"reply": "Checking the date now.", "actions": [{"tool": "get_date"}]}

    if re.search(r"\b(battery|battery level|how much battery)\b", lowered):
        return {"reply": "Checking the battery now.", "actions": [{"tool": "get_battery"}]}

    if re.search(r"\b(weather|temperature|forecast)\b", lowered):
        return {"reply": "Checking the weather now.", "actions": [{"tool": "get_weather"}]}

    if re.search(r"\b(what can you do|help|how can you help)\b", lowered):
        return {"reply": HELP_REPLY, "actions": []}

    if (
        context.get("current_guidance") or context.get("assistant_reply")
    ) and re.search(r"\b(check this|check that|look at this|help me here|what about this)\b", lowered):
        return {
            "reply": "Let me check that for you.",
            "actions": [{"tool": "delegate_page", "page": "current", "question": message}],
        }

    target_page = _infer_target_page(message, context, memory)
    if target_page:
        if target_page != current_page:
            return {
                "reply": f"I can help with that better on {PAGE_LABELS[target_page]}. I will continue there.",
                "actions": [{"tool": "delegate_page", "page": target_page, "question": message}],
            }
        return {
            "reply": "Let me check that for you.",
            "actions": [{"tool": "delegate_page", "page": "current", "question": message}],
        }

    if _is_clearly_out_of_scope(lowered):
        return {
            "reply": f"I will open Google search for {message}.",
            "actions": [{"tool": "open_site", "site": "google", "query": _clean_text(message)}],
        }

    if _looks_like_general_knowledge_question(lowered):
        return {
            "reply": f"I will open Google search for {message}.",
            "actions": [{"tool": "open_site", "site": "google", "query": _clean_text(message)}],
        }

    return {
        "reply": "I can answer broader questions when Gemini is available. Right now I can still help here or open a Google search for you.",
        "actions": [],
    }


def _infer_target_page(message, context, memory):
    lowered = message.lower()
    current_page = context.get("page") or "home"
    if _is_describe_request(lowered):
        return "describe"
    if _is_outdoor_request(lowered):
        return "outdoor"
    if _is_indoor_request(lowered):
        return "indoor"
    if _looks_like_page_context_question(lowered):
        return memory.get("last_page_focus") or current_page
    return ""


def _is_describe_request(lowered):
    return bool(re.search(r"\b(describe|what am i holding|what does it look like|color|shape|size)\b", lowered))


def _is_outdoor_request(lowered):
    return bool(re.search(r"\b(route|destination|take me to|where am i going|on my route|stopover|reroute)\b", lowered))


def _is_indoor_request(lowered):
    return bool(re.search(r"\b(door|sign|room|washroom|reception|find the|kitchen|hallway|indoor)\b", lowered))


def _looks_like_assistive_question(lowered):
    return bool(re.search(r"\b(what|where|which|how|is|are|read|find|describe|guide|tell me|can you)\b", lowered))


def _looks_like_page_context_question(lowered):
    if not _looks_like_assistive_question(lowered):
        return False
    return bool(
        re.search(
            r"\b("
            r"in front of me|around me|ahead of me|what am i holding|holding|this object|this scene|"
            r"current page|this page|on this page|on my route|my route|destination|next step|"
            r"guidance|obstacle|ahead|path|clear path|read this|read the sign|door|room|"
            r"washroom|reception|kitchen|hallway|find the|describe this|describe what you see|"
            r"what is here|what is in front|what do you see|which side is safe|safer side"
            r")\b",
            lowered,
        )
    )


def _looks_like_general_knowledge_question(lowered):
    return bool(
        re.search(
            r"\b(who|what|when|where|why|which|explain|tell me about|define|history of|difference between)\b",
            lowered,
        )
    )


def _is_clearly_out_of_scope(lowered):
    return bool(re.search(r"\b(world cup|stock market|bitcoin|movie review|write code|programming)\b", lowered))


def _extract_page_switch(message):
    lowered = message.lower()
    for page, keywords in PAGE_KEYWORDS.items():
        for keyword in keywords:
            pattern = re.compile(
                rf"\b(?:open|go to|switch to|take me to)\s+{re.escape(keyword)}\b(?:\s+(?:and|then)\s+(.+))?",
                re.IGNORECASE,
            )
            match = pattern.search(message)
            if match:
                return page, _clean_text(match.group(1) or "")
            if lowered.strip() == keyword:
                return page, ""
    return None


def _extract_contact_save(message):
    patterns = [
        r"\bsave contact\s+(.+?)\s+(\+?[\d\s-]{6,})\s*$",
        r"\badd contact\s+(.+?)\s+(\+?[\d\s-]{6,})\s*$",
        r"\bsave\s+(.+?)'?s?\s+(?:phone number|number|contact)(?:\s+(?:as|is|to))?\s+(\+?[\d\s-]{6,})\s*$",
        r"\bremember\s+(.+?)'?s?\s+(?:phone number|number|contact)(?:\s+(?:as|is))?\s+(\+?[\d\s-]{6,})\s*$",
        r"\bstore\s+(.+?)'?s?\s+(?:phone number|number|contact)(?:\s+(?:as|is))?\s+(\+?[\d\s-]{6,})\s*$",
    ]
    for pattern in patterns:
        match = re.search(pattern, message, re.IGNORECASE)
        if not match:
            continue
        name = re.sub(r"'s$", "", match.group(1).strip(), flags=re.IGNORECASE)
        return {"name": name, "number": match.group(2).strip()}
    return None


def _extract_call_target(message, memory):
    match = re.search(r"\bcall\s+(.+)$", message, re.IGNORECASE)
    if not match:
        return ""
    target = _clean_text(match.group(1))
    if re.fullmatch(r"(him|her|them|that contact|that one)", target.lower()):
        return memory.get("last_contact_name", "")
    return target


def _extract_music_query(message, memory):
    match = re.search(r"^(?:play|listen to)\s+(.+)$", message, re.IGNORECASE)
    if match:
        return _clean_text(match.group(1)) or "music"
    if re.search(r"\b(play music|play some music)\b", message, re.IGNORECASE):
        return memory.get("last_music_query", "") or "music"
    if re.search(r"\b(play it again|play that again)\b", message, re.IGNORECASE):
        return memory.get("last_music_query", "") or "music"
    return ""


def _extract_site_action(message):
    raw = _clean_text(message)
    lowered = raw.lower()
    alias_map = {
        "maps": "maps",
        "map": "maps",
        "google map": "maps",
        "google maps": "maps",
        "youtube": "youtube",
        "yt": "youtube",
        "google": "google",
        "search": "google",
        "gmail": "gmail",
        "mail": "gmail",
        "calendar": "calendar",
        "google calendar": "calendar",
        "drive": "drive",
        "google drive": "drive",
        "whatsapp": "whatsapp",
        "whatsapp web": "whatsapp",
    }

    search_patterns = [
        r"\b(?:open|search|look up|find)\s+(youtube|yt)\s+(?:for\s+)?(.+)$",
        r"\b(?:open|search|look up|find)\s+(map|maps|google map|google maps)\s+(?:for\s+|to\s+)?(.+)$",
        r"\b(?:search|look up|find)\s+(?:on\s+)?(google|search)\s+(?:for\s+)?(.+)$",
    ]
    for pattern in search_patterns:
        match = re.search(pattern, raw, re.IGNORECASE)
        if not match:
            continue
        site = alias_map.get(match.group(1).strip().lower())
        query = _clean_text(match.group(2))
        if site and query:
            return {
                "site": site,
                "query": query,
                "reply": f"I will open {site} for {query}.",
            }

    for alias, site in sorted(alias_map.items(), key=lambda item: len(item[0]), reverse=True):
        if re.search(rf"\bopen\s+{re.escape(alias)}\b", lowered):
            return {"site": site, "query": "", "reply": f"I will open {site}."}
        if re.search(rf"\btake me to\s+{re.escape(alias)}\b", lowered):
            return {"site": site, "query": "", "reply": f"I will open {site}."}

    return None


def _extract_general_search(message):
    raw = _clean_text(message)
    patterns = [
        r"\bsearch(?: google)? for\s+(.+)$",
        r"\bgoogle\s+(.+)$",
        r"\blook up\s+(.+)$",
        r"\bfind information about\s+(.+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, raw, re.IGNORECASE)
        if match:
            query = _clean_text(match.group(1)).rstrip(".!?")
            if query:
                return query
    return ""


def _extract_reminder(message):
    match = re.search(
        r"\b(?:remind me|set (?:a )?reminder)\b.*?\bin (\d+)\s*(second|seconds|minute|minutes|hour|hours)\b(?:\s+to)?\s+(.+)",
        message,
        re.IGNORECASE,
    )
    if not match:
        return None
    delay_value = int(match.group(1))
    delay_unit = match.group(2).lower()
    reminder_text = _clean_text(match.group(3)).rstrip(".!?")
    if not delay_value or not reminder_text:
        return None
    unit_ms = 3600000 if delay_unit.startswith("hour") else 60000 if delay_unit.startswith("minute") else 1000
    return {
        "text": reminder_text,
        "delay_ms": delay_value * unit_ms,
        "delay_value": delay_value,
        "delay_unit": delay_unit,
    }


def _normalize_memory(memory):
    base = {
        "turns": [],
        "last_page_focus": "",
        "last_contact_name": "",
        "last_music_query": "",
    }
    if not isinstance(memory, dict):
        return base
    normalized = {**base, **memory}
    normalized["turns"] = [
        turn for turn in normalized.get("turns", []) if isinstance(turn, dict)
    ][-MAX_MEMORY_TURNS:]
    return normalized


def _load_memory(session):
    return _normalize_memory(session.get(MEMORY_SESSION_KEY))


def _save_memory(session, memory):
    session[MEMORY_SESSION_KEY] = _normalize_memory(memory)
    session.modified = True


def _update_memory(memory, user_message, plan, context):
    next_memory = _normalize_memory(memory)
    actions = plan.get("actions", [])
    next_memory["turns"] = (
        next_memory["turns"]
        + [{
            "user": user_message,
            "assistant": plan.get("reply", ""),
            "page": context.get("page", ""),
            "tools": [action.get("tool", "") for action in actions],
        }]
    )[-MAX_MEMORY_TURNS:]

    for action in actions:
        tool = action.get("tool")
        if tool in {"switch_page", "delegate_page"}:
            page = action.get("page") or context.get("page", "")
            next_memory["last_page_focus"] = context.get("page", "") if page == "current" else page
        if tool in {"save_contact", "call_contact"}:
            next_memory["last_contact_name"] = (
                action.get("name")
                or action.get("target")
                or next_memory.get("last_contact_name", "")
            )
        if tool == "open_music":
            next_memory["last_music_query"] = action.get("query") or next_memory.get("last_music_query", "")

    if not next_memory.get("last_page_focus"):
        next_memory["last_page_focus"] = context.get("page", "")
    return next_memory


def _clean_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()
