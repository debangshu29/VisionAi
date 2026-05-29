$ollamaCommand = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollamaCommand) {
    Write-Host "Ollama is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Install it first, then run: ollama pull llama3.2:3b" -ForegroundColor Yellow
    exit 1
}

$env:NAVI_LLM_PROVIDER = "ollama"
$env:NAVI_LLM_ENDPOINT = "http://127.0.0.1:11434/api/chat"
$env:NAVI_LLM_MODEL = "llama3.2:3b"
$env:NAVI_LLM_MAX_TOKENS = "160"
$env:NAVI_LLM_TIMEOUT_SECONDS = "35"
$env:NAVI_LLM_KEEP_ALIVE = "10m"

Write-Host "Checking llama3.2:3b..." -ForegroundColor Cyan
ollama list | Select-String "llama3.2:3b" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Pulling llama3.2:3b..." -ForegroundColor Cyan
    ollama pull llama3.2:3b
}

Write-Host "Starting Django with Ollama-backed Navi..." -ForegroundColor Green
py manage.py runserver
