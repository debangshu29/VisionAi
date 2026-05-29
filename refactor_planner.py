import re

with open('main/planner.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove pytesseract import
content = re.sub(r'try:\s*import pytesseract\s*except ImportError:.*?\s*pytesseract = None\s*', '', content, flags=re.DOTALL)

# Remove OCR constants
content = re.sub(r'OCR_SUPPORT_MESSAGE = \([^)]+\)\n+', '', content, flags=re.DOTALL)
content = re.sub(r'OCR_PHRASE_NORMALIZATIONS = \{.*?\n\}\n+', '', content, flags=re.DOTALL)
content = re.sub(r'OCR_FORCE_UPPER = \{.*?\}\n+', '', content, flags=re.DOTALL)
content = re.sub(r'OCR_TESSERACT_CONFIGS = \([^)]+\)\n+', '', content, flags=re.DOTALL)
content = re.sub(r'OCR_VOCAB = .*?\]\n\)\n+', '', content, flags=re.DOTALL) # Might be slightly different, let's just use simple replaces where possible

# Instead of complex regex, let's just append our new function and rewrite read_visible_text
# Actually we can just redefine read_visible_text

gemini_vision_code = """
def _call_gemini_vision(frame, prompt):
    try:
        from google import genai
        from google.genai import types
        from django.conf import settings
        import cv2
    except ImportError:
        return "Gemini SDK not available."

    api_key = getattr(settings, "GEMINI_API_KEY", "").strip()
    if not api_key:
        return "Gemini API key not configured."

    model = getattr(settings, "NAVI_GEMINI_MODEL", "gemini-2.5-flash").strip()
    
    try:
        client = genai.Client(api_key=api_key)
        _, buffer = cv2.imencode('.jpg', frame)
        img_bytes = buffer.tobytes()

        response = client.models.generate_content(
            model=model,
            contents=[
                types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
                prompt
            ]
        )
        return response.text.strip()
    except Exception as e:
        print(f"[Planner] Gemini Vision Error: {e}")
        return f"Gemini analysis failed: {e}"

def read_visible_text(frame, door_hint=None):
    if frame is None:
        return {
            "status": "no_frame",
            "text": "",
            "message": "I do not have a clear frame for sign reading yet.",
            "room_hint": "",
            "sign_label": "",
            "sign_kind": "",
            "normalized_text": "",
            "lines": [],
            "confidence": "low",
            "source_region": "",
        }
    
    prompt = "Read any text visible in this image. Is there a room number or sign? Return only the text you see. If no text is clearly readable, reply 'No text found'."
    gemini_text = _call_gemini_vision(frame, prompt)
    
    if "No text found" in gemini_text or "Gemini" in gemini_text:
        return {
            "status": "no_text",
            "text": "",
            "message": "No clear text found.",
            "room_hint": "",
            "sign_label": "",
            "sign_kind": "",
            "normalized_text": "",
            "lines": [],
            "confidence": "low",
            "source_region": "",
        }
        
    return {
        "status": "success",
        "text": gemini_text,
        "message": f"I see: {gemini_text}",
        "room_hint": gemini_text,
        "sign_label": gemini_text,
        "sign_kind": "sign",
        "normalized_text": gemini_text,
        "lines": [gemini_text],
        "confidence": "high",
        "source_region": "gemini",
    }
"""

# Let's replace the existing read_visible_text function entirely to the end of the file or until EOF.
# Actually read_visible_text might not be the last function.
# Let's use string manipulation

start_idx = content.find("def read_visible_text(")
if start_idx != -1:
    end_idx = content.find("def ", start_idx + 10)
    if end_idx == -1:
        end_idx = len(content)
        
    content = content[:start_idx] + gemini_vision_code + content[end_idx:]

with open('main/planner.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Planner updated successfully.")
