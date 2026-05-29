const body = document.body;
const sceneUrl = body.dataset.sceneUrl;
const safetyUrl = body.dataset.safetyUrl || `${sceneUrl}?view=safety`;
const contextUrl = body.dataset.contextUrl || `${sceneUrl}?view=context`;
const askUrl = body.dataset.askUrl;

const SAME_ALERT_BURST_LIMIT = 3;
const SAME_ALERT_MIN_INTERVAL_MS = 3200;
const SAME_ALERT_COOLDOWN_MS = 6500;
const SAFETY_REFRESH_MS = 110;
const CONTEXT_REFRESH_MS = 900;

const elements = {
  commandCard: document.getElementById("commandCard"),
  commandValue: document.getElementById("commandValue"),
  spokenMessage: document.getElementById("spokenMessage"),
  sceneSummary: document.getElementById("sceneSummary"),
  recommendedSteps: document.getElementById("recommendedSteps"),
  safeDirection: document.getElementById("safeDirection"),
  clearSteps: document.getElementById("clearSteps"),
  objectCount: document.getElementById("objectCount"),
  obstacleList: document.getElementById("obstacleList"),
  urgencyBadge: document.getElementById("urgencyBadge"),
  connectionBadge: document.getElementById("connectionBadge"),
  lastUpdated: document.getElementById("lastUpdated"),
  voiceToggle: document.getElementById("voiceToggle"),
  speakNow: document.getElementById("speakNow"),
  journeyMessage: document.getElementById("journeyMessage"),
  questionForm: document.getElementById("questionForm"),
  questionInput: document.getElementById("questionInput"),
  voiceQuestion: document.getElementById("voiceQuestion"),
  assistantAnswer: document.getElementById("assistantAnswer"),
};

const appState = {
  voiceEnabled: true,
  lastSpokenMessage: "",
  preferredVoice: null,
  guidanceSpeech: {
    lastKey: "",
    repeatCount: 0,
    lastAt: 0,
    nextReminderAt: 0,
  },
  latestSafetyScene: null,
  latestContextScene: null,
  recognition: null,
  recognitionActive: false,
  assistantSpeaking: false,
  assistantSpeechToken: 0,
  pendingGuidanceAlert: null,
  safetyPolling: false,
  contextPolling: false,
  userActivatedAudio: false,
  voiceKickstarted: false,
  streamLoaded: false,
};

function prettyLabel(value) {
  return String(value || "-")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function classifyObstacle(className) {
  const label = String(className || "").trim().toLowerCase();
  if (!label) {
    return "object";
  }

  if (label === "person") {
    return "person";
  }

  if (["bicycle", "motorcycle", "car", "bus", "truck", "train"].includes(label)) {
    return "vehicle";
  }

  if (["dog", "cat", "bird", "horse", "cow", "sheep"].includes(label)) {
    return "animal";
  }

  if (["chair", "bench", "couch", "dining table", "potted plant"].includes(label)) {
    return "furniture";
  }

  return "object";
}

function normalizeAlertToken(value, fallback = "unknown") {
  const token = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return token || fallback;
}

function getScenePrimaryObstacle(scene) {
  return scene.primary_obstacle || (scene.detections && scene.detections[0]) || {};
}

function buildGuidanceAlertKey(scene) {
  if (!scene) {
    return "idle";
  }

  const command = String(scene.command || "CLEAR").toUpperCase();
  if (!["STOP", "SLOW", "MOVE_LEFT", "MOVE_RIGHT"].includes(command)) {
    return scene.path_clear ? "clear:path" : `clear:${normalizeAlertToken(scene.safe_direction, "forward")}`;
  }

  const primary = getScenePrimaryObstacle(scene);
  return [
    command,
    classifyObstacle(primary.class_name),
    normalizeAlertToken(primary.zone || primary.zone_label, "center"),
    normalizeAlertToken(scene.safe_direction, "forward"),
  ].join(":");
}

function setBadgeClass(element, level) {
  element.className = `badge ${level || "neutral"}`;
}

function setupCameraStreamStatus() {
  const stream = document.getElementById("mjpeg");
  if (!stream || !elements.connectionBadge) {
    return;
  }

  stream.addEventListener("load", () => {
    appState.streamLoaded = true;
    elements.connectionBadge.textContent = "Live";
    setBadgeClass(elements.connectionBadge, "low");
  });

  stream.addEventListener("error", () => {
    appState.streamLoaded = false;
    elements.connectionBadge.textContent = "Camera issue";
    setBadgeClass(elements.connectionBadge, "high");
  });
}

function chooseVoice() {
  if (appState.preferredVoice || !("speechSynthesis" in window)) {
    return appState.preferredVoice;
  }

  const voices = window.speechSynthesis.getVoices() || [];
  const preferences = [
    (voice) => /en-IN/i.test(voice.lang),
    (voice) => /Google|Microsoft|Natural/i.test(voice.name),
    (voice) => /^en/i.test(voice.lang),
  ];

  for (const test of preferences) {
    const voice = voices.find(test);
    if (voice) {
      appState.preferredVoice = voice;
      return voice;
    }
  }

  appState.preferredVoice = voices[0] || null;
  return appState.preferredVoice;
}

function speak(text, options = {}) {
  const message = String(text || "").trim();
  if (!appState.voiceEnabled || !("speechSynthesis" in window) || !message) {
    return false;
  }

  if (!options.force && message === appState.lastSpokenMessage) {
    return false;
  }

  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(message);
  utterance.voice = chooseVoice();
  utterance.rate = 0.96;
  utterance.pitch = 1.02;
  if (typeof options.onend === "function") {
    utterance.onend = options.onend;
  }
  window.speechSynthesis.speak(utterance);
  appState.lastSpokenMessage = message;
  return true;
}

function cancelSpeechPlayback() {
  if ("speechSynthesis" in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
    window.speechSynthesis.cancel();
  }
}

function companionIsHoldingAlerts() {
  const voiceChannel = window.AssistiveVoiceChannel;
  return Boolean(
    voiceChannel &&
    typeof voiceChannel.shouldHoldAlerts === "function" &&
    voiceChannel.shouldHoldAlerts()
  );
}

function shouldHoldGuidanceSpeech() {
  return Boolean(appState.recognitionActive || appState.assistantSpeaking || companionIsHoldingAlerts());
}

function flushPendingGuidanceAlert() {
  if (!appState.pendingGuidanceAlert || shouldHoldGuidanceSpeech()) {
    return;
  }

  const pending = appState.pendingGuidanceAlert;
  appState.pendingGuidanceAlert = null;
  speakGuidanceMessage(pending.text, pending.key, pending.urgent, pending.force);
}

function finishAssistantSpeech(token) {
  if (token !== appState.assistantSpeechToken) {
    return;
  }

  appState.assistantSpeaking = false;
  flushPendingGuidanceAlert();
}

function speakAssistantMessage(text, options = {}) {
  const message = String(text || "").trim();
  if (!message) {
    return false;
  }

  const token = appState.assistantSpeechToken + 1;
  appState.assistantSpeechToken = token;
  appState.assistantSpeaking = true;

  const spoken = speak(message, {
    force: options.force !== false,
    onend: () => finishAssistantSpeech(token),
  });

  if (!spoken && token === appState.assistantSpeechToken) {
    appState.assistantSpeaking = false;
    flushPendingGuidanceAlert();
  }

  return spoken;
}

function resetGuidanceSpeech() {
  appState.guidanceSpeech.lastKey = "";
  appState.guidanceSpeech.repeatCount = 0;
  appState.guidanceSpeech.lastAt = 0;
  appState.guidanceSpeech.nextReminderAt = 0;
}

function speakGuidanceMessage(text, key, urgent = false, force = false) {
  const message = String(text || "").trim();
  const speechKey = String(key || message).trim();
  if (!message || !speechKey) {
    return;
  }

  if (shouldHoldGuidanceSpeech()) {
    appState.pendingGuidanceAlert = urgent
      ? { text: message, key: speechKey, urgent, force }
      : null;
    return;
  }

  const guidanceSpeech = appState.guidanceSpeech;
  const now = Date.now();

  if (force || speechKey !== guidanceSpeech.lastKey) {
    if (speak(message, { force: true })) {
      guidanceSpeech.lastKey = speechKey;
      guidanceSpeech.repeatCount = 1;
      guidanceSpeech.lastAt = now;
      guidanceSpeech.nextReminderAt = 0;
    }
    return;
  }

  if (!urgent || (window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending))) {
    return;
  }

  if (guidanceSpeech.repeatCount < SAME_ALERT_BURST_LIMIT) {
    if (now - guidanceSpeech.lastAt < SAME_ALERT_MIN_INTERVAL_MS) {
      return;
    }

    if (speak(message, { force: true })) {
      guidanceSpeech.repeatCount += 1;
      guidanceSpeech.lastAt = now;
      if (guidanceSpeech.repeatCount >= SAME_ALERT_BURST_LIMIT) {
        guidanceSpeech.nextReminderAt = now + SAME_ALERT_COOLDOWN_MS;
      }
    }
    return;
  }

  if (now < guidanceSpeech.nextReminderAt) {
    return;
  }

  if (speak(message, { force: true })) {
    guidanceSpeech.lastAt = now;
    guidanceSpeech.nextReminderAt = now + SAME_ALERT_COOLDOWN_MS;
  }
}

function buildVoiceGuidance(scene) {
  if (!scene) {
    return {
      text: "Waiting for live guidance.",
      key: "idle",
      urgent: false,
    };
  }

  const urgent = ["STOP", "MOVE_LEFT", "MOVE_RIGHT", "SLOW"].includes(scene.command);
  return {
    text: scene.spoken_message || (urgent ? "Obstacle ahead." : "Path seems clear. Continue carefully."),
    key: buildGuidanceAlertKey(scene),
    urgent,
  };
}

function speakLatestGuidance(force = true) {
  const voiceGuidance = buildVoiceGuidance(appState.latestSafetyScene);
  speakGuidanceMessage(voiceGuidance.text, voiceGuidance.key, voiceGuidance.urgent, force);
}

function finalizeVoiceKickstart() {
  if (appState.voiceKickstarted) {
    return;
  }

  appState.voiceKickstarted = true;
  window.removeEventListener("pointerdown", kickstartVoiceGuidance, true);
  window.removeEventListener("keydown", kickstartVoiceGuidance, true);
  if (!appState.voiceEnabled || !appState.latestSafetyScene) {
    return;
  }
  speakLatestGuidance(true);
}

function kickstartVoiceGuidance() {
  appState.userActivatedAudio = true;
  if (!appState.latestSafetyScene) {
    return;
  }
  finalizeVoiceKickstart();
}

function renderSteps(steps) {
  elements.recommendedSteps.innerHTML = "";
  (steps || []).forEach((stepText) => {
    const item = document.createElement("li");
    item.textContent = stepText;
    elements.recommendedSteps.appendChild(item);
  });
}

function renderObstacles(obstacles) {
  if (!obstacles || !obstacles.length) {
    elements.obstacleList.innerHTML =
      '<article class="empty-state">No immediate obstacle is being tracked right now.</article>';
    return;
  }

  elements.obstacleList.innerHTML = "";
  obstacles.forEach((obstacle) => {
    const card = document.createElement("article");
    card.className = "obstacle-card";
    const riskPercent = Math.max(8, Math.min(100, obstacle.risk_score * 7.5));

    card.innerHTML = `
      <header>
        <h3>${prettyLabel(obstacle.class_name)}</h3>
        <span class="badge ${obstacle.risk_score >= 9 ? "high" : obstacle.risk_score >= 6 ? "medium" : "low"}">
          Risk ${obstacle.risk_score.toFixed(1)}
        </span>
      </header>
      <div class="obstacle-meta">
        <span>${prettyLabel(obstacle.zone_label)}</span>
        <span>${prettyLabel(obstacle.distance)}</span>
        <span>${obstacle.steps_away} step${obstacle.steps_away === 1 ? "" : "s"} away</span>
        <span>Confidence ${(obstacle.confidence * 100).toFixed(0)}%</span>
      </div>
      <div class="risk-bar"><span style="width:${riskPercent}%"></span></div>
      <p>${obstacle.summary}</p>
    `;

    elements.obstacleList.appendChild(card);
  });
}

function isOlderScene(scene, currentScene) {
  if (!scene || !currentScene) {
    return false;
  }

  const nextFrame = Number(scene.frame_number || 0);
  const currentFrame = Number(currentScene.frame_number || 0);
  if (nextFrame && currentFrame && nextFrame < currentFrame) {
    return true;
  }

  const nextTimestamp = Number(scene.timestamp || 0);
  const currentTimestamp = Number(currentScene.timestamp || 0);
  return Boolean(!nextFrame && nextTimestamp && currentTimestamp && nextTimestamp < currentTimestamp);
}

function updateSafetyScene(scene) {
  if (isOlderScene(scene, appState.latestSafetyScene)) {
    return;
  }

  appState.latestSafetyScene = scene;
  if (appState.userActivatedAudio && !appState.voiceKickstarted && appState.voiceEnabled) {
    finalizeVoiceKickstart();
  }

  elements.commandValue.textContent = prettyLabel(scene.command);
  elements.spokenMessage.textContent = scene.spoken_message;
  elements.safeDirection.textContent = prettyLabel(scene.safe_direction);
  elements.clearSteps.textContent = scene.estimated_clear_steps;
  elements.journeyMessage.textContent = scene.spoken_message;

  elements.commandCard.className = `command-card urgency-${scene.urgency || "low"}`;
  elements.urgencyBadge.textContent = prettyLabel(scene.urgency);
  setBadgeClass(elements.urgencyBadge, scene.urgency || "neutral");

  renderSteps(scene.recommended_steps || []);

  if (scene.error) {
    elements.connectionBadge.textContent = "Camera issue";
    setBadgeClass(elements.connectionBadge, "high");
  } else {
    const isLive = scene.running || appState.streamLoaded;
    elements.connectionBadge.textContent = isLive ? "Live" : "Idle";
    setBadgeClass(elements.connectionBadge, isLive ? "low" : "neutral");
  }

  const voiceGuidance = buildVoiceGuidance(scene);
  speakGuidanceMessage(voiceGuidance.text, voiceGuidance.key, voiceGuidance.urgent, false);
}

function updateContextScene(scene) {
  if (isOlderScene(scene, appState.latestContextScene)) {
    return;
  }

  appState.latestContextScene = scene;
  elements.sceneSummary.textContent = `${scene.scene_caption} ${scene.summary}`.trim();
  elements.objectCount.textContent = (scene.detections || []).length;
  renderObstacles(scene.detections || []);

  if (scene.timestamp) {
    const updatedAt = new Date(scene.timestamp * 1000);
    elements.lastUpdated.textContent = `Updated ${updatedAt.toLocaleTimeString()}`;
  }
}

async function fetchSafetyScene() {
  if (appState.safetyPolling) {
    return;
  }

  appState.safetyPolling = true;
  try {
    const response = await fetch(safetyUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Scene request failed with ${response.status}`);
    }
    const payload = await response.json();
    if (payload.error) {
      throw new Error(payload.error);
    }
    updateSafetyScene(payload.scene);
  } catch (error) {
    elements.connectionBadge.textContent = "Offline";
    setBadgeClass(elements.connectionBadge, "high");
    elements.sceneSummary.textContent = error.message;
  } finally {
    appState.safetyPolling = false;
  }
}

async function fetchContextScene() {
  if (appState.contextPolling) {
    return;
  }

  appState.contextPolling = true;
  try {
    const response = await fetch(contextUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Scene request failed with ${response.status}`);
    }
    const payload = await response.json();
    if (payload.error) {
      throw new Error(payload.error);
    }
    updateContextScene(payload.scene);
  } catch (error) {
    elements.sceneSummary.textContent = error.message;
  } finally {
    appState.contextPolling = false;
  }
}

async function askQuestion(question, shouldSpeak = true) {
  const trimmedQuestion = String(question || "").trim();
  if (!trimmedQuestion) {
    elements.assistantAnswer.textContent = "Type or speak a question about the current scene.";
    return elements.assistantAnswer.textContent;
  }

  try {
    const response = await fetch(`${askUrl}?q=${encodeURIComponent(trimmedQuestion)}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Assistant request failed with ${response.status}`);
    }
    const payload = await response.json();
    if (payload.error) {
      throw new Error(payload.error);
    }

    elements.assistantAnswer.textContent = payload.answer.answer;
    if (payload.scene) {
      updateSafetyScene(payload.scene);
      updateContextScene(payload.scene);
    }
    if (shouldSpeak) {
      speakAssistantMessage(payload.answer.answer, { force: true });
    }
    return payload.answer.answer;
  } catch (error) {
    elements.assistantAnswer.textContent = error.message;
    return error.message;
  }
}

function updateVoiceQuestionButton(listening = false) {
  elements.voiceQuestion.textContent = listening ? "Listening..." : "Use mic";
}

function startSpeechCapture() {
  if (!appState.recognition) {
    elements.assistantAnswer.textContent = "Speech recognition is not available in this browser.";
    return;
  }

  appState.assistantSpeechToken += 1;
  appState.assistantSpeaking = false;
  appState.recognitionActive = true;
  cancelSpeechPlayback();
  updateVoiceQuestionButton(true);
  try {
    appState.recognition.start();
  } catch (error) {
    appState.recognitionActive = false;
    updateVoiceQuestionButton(false);
    flushPendingGuidanceAlert();
  }
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    elements.voiceQuestion.disabled = true;
    elements.voiceQuestion.textContent = "Mic unavailable";
    return;
  }

  appState.recognition = new SpeechRecognition();
  appState.recognition.lang = "en-US";
  appState.recognition.interimResults = false;
  appState.recognition.maxAlternatives = 1;

  appState.recognition.onstart = () => {
    appState.recognitionActive = true;
    updateVoiceQuestionButton(true);
  };

  appState.recognition.onend = () => {
    appState.recognitionActive = false;
    updateVoiceQuestionButton(false);
    flushPendingGuidanceAlert();
  };

  appState.recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    elements.questionInput.value = transcript;
    askQuestion(transcript);
  };

  appState.recognition.onerror = () => {
    appState.recognitionActive = false;
    updateVoiceQuestionButton(false);
    flushPendingGuidanceAlert();
    elements.assistantAnswer.textContent = "Microphone recognition failed. You can still type the question.";
  };
}

if (elements.voiceToggle) {
  elements.voiceToggle.addEventListener("click", () => {
    appState.voiceEnabled = !appState.voiceEnabled;
    elements.voiceToggle.textContent = `Voice guidance: ${appState.voiceEnabled ? "On" : "Off"}`;
    if (!appState.voiceEnabled) {
      cancelSpeechPlayback();
      appState.assistantSpeaking = false;
      appState.pendingGuidanceAlert = null;
      appState.lastSpokenMessage = "";
      resetGuidanceSpeech();
      return;
    }

    speakLatestGuidance(true);
  });
}

if (elements.speakNow) {
  elements.speakNow.addEventListener("click", () => {
    speakLatestGuidance(true);
  });
}

elements.questionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  askQuestion(elements.questionInput.value);
});

elements.voiceQuestion.addEventListener("click", () => {
  startSpeechCapture();
});

document.querySelectorAll("[data-question]").forEach((button) => {
  button.addEventListener("click", () => {
    const question = button.dataset.question;
    elements.questionInput.value = question;
    askQuestion(question, false);
  });
});

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    appState.preferredVoice = null;
    chooseVoice();
  };
}

window.addEventListener("pointerdown", kickstartVoiceGuidance, true);
window.addEventListener("keydown", kickstartVoiceGuidance, true);
setupSpeechRecognition();
setupCameraStreamStatus();
fetchSafetyScene();
fetchContextScene();
window.setInterval(fetchSafetyScene, SAFETY_REFRESH_MS);
window.setInterval(fetchContextScene, CONTEXT_REFRESH_MS);

window.AssistiveVisionPage = {
  page: "home",
  askQuestion: (question) => askQuestion(question, false),
  getSafetyScene: () => appState.latestSafetyScene,
  getContextScene: () => appState.latestContextScene,
  getCurrentGuidance: () => elements.spokenMessage.textContent || elements.sceneSummary.textContent,
  getAssistantContext: () => ({
    guidance: elements.spokenMessage.textContent || "",
    assistantReply: elements.assistantAnswer.textContent || "",
  }),
};






