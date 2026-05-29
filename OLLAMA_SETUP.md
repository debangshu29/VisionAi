## Navi + Ollama Setup

The project is already configured to use Ollama by default:

- `NAVI_LLM_PROVIDER=ollama`
- `NAVI_LLM_ENDPOINT=http://127.0.0.1:11434/api/chat`
- `NAVI_LLM_MODEL=llama3.2:3b`

That means Navi will automatically try to use a local Ollama server first, and fall back to the built-in planner if Ollama is not running.

### 1. Install Ollama on Windows

Use the official installer:

- Download: `https://github.com/ollama/ollama/releases/download/v0.18.3/OllamaSetup.exe`

Install it normally for your Windows user account.

### 2. Pull the model

Open PowerShell and run:

```powershell
ollama pull llama3.2:3b
```

### 3. Start the Ollama server

In PowerShell:

```powershell
ollama serve
```

If Ollama is already running in the background, this may not be necessary.

### 4. Start Django with Navi pointed at Ollama

From the project folder:

```powershell
$env:NAVI_LLM_PROVIDER = "ollama"
$env:NAVI_LLM_ENDPOINT = "http://127.0.0.1:11434/api/chat"
$env:NAVI_LLM_MODEL = "llama3.2:3b"
$env:NAVI_LLM_MAX_TOKENS = "220"
py manage.py runserver
```

### 5. Quick test

With the site open, try:

- `Hey Navi`
- `What is in front of me?`
- `Open indoor navigation and read the sign`
- `Take me to the nearest SBI bank`

### Notes

- Keep Navi on-demand only. Do not try to make the LLM watch every frame continuously.
- `llama3.2:3b` is the safer first model for this project because it is small enough to be usable locally without putting as much pressure on the detector as larger models.
- If the machine feels slow, later you can try `llama3.2:1b` for lighter load.
