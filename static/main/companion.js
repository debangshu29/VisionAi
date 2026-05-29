const companionBody = document.body;

const companionElements = {
  shell: document.getElementById("companionShell"),
  panel: document.getElementById("companionPanel"),
  toggle: document.getElementById("companionToggle"),
  close: document.getElementById("companionClose"),
  mic: document.getElementById("companionMic"),
  wakeToggle: document.getElementById("companionWakeToggle"),
  wakeBadge: document.getElementById("companionWakeBadge"),
  listeningBadge: document.getElementById("companionListeningBadge"),
  heard: document.getElementById("companionHeard"),
  reply: document.getElementById("companionReply"),
  contactName: document.getElementById("companionContactName"),
  contactNumber: document.getElementById("companionContactNumber"),
  saveContact: document.getElementById("companionSaveContact"),
  contactList: document.getElementById("companionContactList"),
  reminderList: document.getElementById("companionReminderList"),
};

const CONTACTS_STORAGE_KEY = "assistiveVoiceCompanion.contacts";
const REMINDERS_STORAGE_KEY = "assistiveVoiceCompanion.reminders";
const WAKE_ENABLED_STORAGE_KEY = "assistiveVoiceCompanion.wakeEnabled";
const PENDING_PAGE_ACTION_STORAGE_KEY = "assistiveVoiceCompanion.pendingPageAction";
const WAKE_NAME_PATTERN = "(?:navi|navy)";
const WAKE_WORD_PATTERNS = [
  new RegExp("^\\s*hey\\s+" + WAKE_NAME_PATTERN + "\\b[\\s,.!?:-]*", "i"),
  new RegExp("^\\s*hello\\s+" + WAKE_NAME_PATTERN + "\\b[\\s,.!?:-]*", "i"),
  new RegExp("^\\s*ok(?:ay)?\\s+" + WAKE_NAME_PATTERN + "\\b[\\s,.!?:-]*", "i"),
  new RegExp("^\\s*hi\\s+" + WAKE_NAME_PATTERN + "\\b[\\s,.!?:-]*", "i"),
  new RegExp("^\\s*" + WAKE_NAME_PATTERN + "\\b[\\s,.!?:-]*", "i"),
];
const WAKE_ONLY_PATTERNS = [
  new RegExp("^\\s*hey\\s+" + WAKE_NAME_PATTERN + "\\s*[.!?]*\\s*$", "i"),
  new RegExp("^\\s*hello\\s+" + WAKE_NAME_PATTERN + "\\s*[.!?]*\\s*$", "i"),
  new RegExp("^\\s*ok(?:ay)?\\s+" + WAKE_NAME_PATTERN + "\\s*[.!?]*\\s*$", "i"),
  new RegExp("^\\s*hi\\s+" + WAKE_NAME_PATTERN + "\\s*[.!?]*\\s*$", "i"),
  new RegExp("^\\s*" + WAKE_NAME_PATTERN + "\\s*[.!?]*\\s*$", "i"),
];
const WEATHER_CACHE_MS = 10 * 60 * 1000;
const REMINDER_CHECK_INTERVAL_MS = 30000;
const ALERT_SUPPRESSION_WHILE_COMMAND_MS = 14000;
const ALERT_SUPPRESSION_AFTER_COMMAND_MS = 2200;
const ALERT_SUPPRESSION_AFTER_COMPANION_SPEECH_MS = 1500;
const WAKE_SPEECH_DUCK_MS = 2600;
const WAKE_SPEECH_REARM_MS = 1100;
const AUTOSTART_REALTIME_STORAGE_KEY = "assistiveVoiceCompanion.realtimeAutostart";
const AUTOSTART_REALTIME_MAX_AGE_MS = 5000;
const REALTIME_IDLE_TIMEOUT_MS = 25000;
const GEMINI_SDK_IMPORT_URL = "https://cdn.jsdelivr.net/npm/@google/genai@1.47.0/+esm";
const companionChatUrl = companionBody.dataset.companionChatUrl || "";
const companionRealtimeTokenUrl = companionBody.dataset.companionRealtimeTokenUrl || "";
const companionRealtimeEnabled = companionBody.dataset.companionRealtimeEnabled === "true";
const CONVERSATION_SESSION_MS = 90000;
const FOLLOW_UP_LISTEN_DELAY_MS = 300;
const FOLLOW_UP_LISTEN_TIMEOUT_MS = 15000;
const FOLLOW_UP_RESTART_DELAY_MS = 280;

function createAssistiveVoiceChannel() {
  const state = {
    companionListening: false,
    companionSpeaking: false,
    holdAlertsUntil: 0,
  };

  const emitState = () => {
    window.dispatchEvent(
      new CustomEvent("assistivevoicechange", {
        detail: {
          companionListening: state.companionListening,
          companionSpeaking: state.companionSpeaking,
          holdAlertsUntil: state.holdAlertsUntil,
        },
      }),
    );
  };

  return {
    holdAlerts(durationMs = 0) {
      const duration = Math.max(0, Number(durationMs) || 0);
      if (!duration) {
        return;
      }

      const nextUntil = Date.now() + duration;
      if (nextUntil > state.holdAlertsUntil) {
        state.holdAlertsUntil = nextUntil;
        emitState();
      }
    },
    setCompanionListening(active, holdDurationMs = 0) {
      const nextValue = Boolean(active);
      if (nextValue !== state.companionListening) {
        state.companionListening = nextValue;
        emitState();
      }
      if (!nextValue) {
        this.holdAlerts(holdDurationMs);
      }
    },
    setCompanionSpeaking(active, holdDurationMs = 0) {
      const nextValue = Boolean(active);
      if (nextValue !== state.companionSpeaking) {
        state.companionSpeaking = nextValue;
        emitState();
      }
      if (!nextValue) {
        this.holdAlerts(holdDurationMs);
      }
    },
    shouldHoldAlerts() {
      return Boolean(
        state.companionListening ||
        state.companionSpeaking ||
        Date.now() < state.holdAlertsUntil
      );
    },
    getState() {
      return {
        companionListening: state.companionListening,
        companionSpeaking: state.companionSpeaking,
        holdAlertsUntil: state.holdAlertsUntil,
      };
    },
  };
}

const assistiveVoiceChannel = window.AssistiveVoiceChannel || createAssistiveVoiceChannel();
window.AssistiveVoiceChannel = assistiveVoiceChannel;

const companionState = {
  recognition: null,
  recognitionMode: "idle",
  wakeEnabled: localStorage.getItem(WAKE_ENABLED_STORAGE_KEY) !== "false",
  listening: false,
  speaking: false,
  wakeCapturePending: false,
  suspendedUntil: 0,
  replyText: "",
  heardText: "",
  contacts: loadStoredJson(CONTACTS_STORAGE_KEY, {}),
  reminders: loadStoredJson(REMINDERS_STORAGE_KEY, []),
  reminderTimers: new Map(),
  musicWindow: null,
  weatherCache: null,
  lastSpokenText: "",
  lastSpokenNormalized: "",
  lastSpokenUntil: 0,
  conversationActiveUntil: 0,
  followUpTimer: null,
  commandRunId: 0,
  planAbortController: null,
  realtimePreferred: companionRealtimeEnabled,
  realtimeConnecting: false,
  realtimeActive: false,
  realtimeSession: null,
  realtimeStream: null,
  realtimeInputContext: null,
  realtimeInputSource: null,
  realtimeProcessor: null,
  realtimeSilentGain: null,
  realtimeOutputContext: null,
  realtimeOutputCursor: 0,
  realtimePlaybackSources: [],
  realtimeIdleTimer: null,
  realtimeModel: "",
  realtimeSessionStartedAt: 0,
  realtimeUserTranscript: "",
  realtimeAssistantTranscript: "",
  realtimeLastVoiceAt: 0,
  realtimeSpeechDetected: false,
  realtimeSentAudioEnd: false,
  micPermissionState: "unknown",
  wakeMonitor: {
    lastDuckAt: 0,
  },
};

let geminiSdkModulePromise = null;

function loadStoredJson(key, fallbackValue) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallbackValue;
    }
    return JSON.parse(raw);
  } catch (_error) {
    return fallbackValue;
  }
}

function saveStoredJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeSpeechText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function estimateSpeechDurationMs(message) {
  const normalized = normalizeSpeechText(message);
  const words = normalized ? normalized.split(" ").length : 0;
  return Math.max(1800, (words * 420) + 900);
}

function isLikelySelfEcho(transcript) {
  const normalizedTranscript = normalizeSpeechText(transcript);
  if (!normalizedTranscript) {
    return false;
  }

  const withinEchoWindow = companionState.speaking || Date.now() < companionState.lastSpokenUntil;
  if (!withinEchoWindow || !companionState.lastSpokenNormalized) {
    return false;
  }

  const transcriptTokens = normalizedTranscript.split(" ").filter(Boolean);
  if (transcriptTokens.length < 3) {
    return false;
  }

  if (companionState.lastSpokenNormalized.includes(normalizedTranscript)) {
    return true;
  }

  const spokenTokens = new Set(companionState.lastSpokenNormalized.split(" ").filter(Boolean));
  let overlapCount = 0;
  transcriptTokens.forEach((token) => {
    if (spokenTokens.has(token)) {
      overlapCount += 1;
    }
  });
  return overlapCount / transcriptTokens.length >= 0.7;
}

function cancelGlobalSpeechPlayback() {
  if ("speechSynthesis" in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
    window.speechSynthesis.cancel();
  }
}

function pauseAlertsForWakeSpeech() {
  assistiveVoiceChannel.holdAlerts(WAKE_SPEECH_DUCK_MS);

  const now = Date.now();
  if (now - companionState.wakeMonitor.lastDuckAt < WAKE_SPEECH_REARM_MS) {
    return;
  }

  companionState.wakeMonitor.lastDuckAt = now;
  if (!companionState.speaking) {
    cancelGlobalSpeechPlayback();
  }
  setListeningBadge(companionState.speaking ? "Checking interruption" : "Checking wake word", "medium");
}

function stopWakeSpeechMonitor() {
  companionState.wakeMonitor.lastDuckAt = 0;
}

function startWakeSpeechMonitor() {
  companionState.wakeMonitor.lastDuckAt = 0;
}

function setMicButtonLabel() {
  if (!companionElements.mic) {
    return;
  }
  if (shouldUseRealtimeVoice()) {
    if (companionState.realtimeConnecting) {
      companionElements.mic.textContent = "Connecting...";
      return;
    }
    companionElements.mic.textContent = companionState.realtimeActive ? "End live voice" : "Start live voice";
    return;
  }
  if (companionElements.wakeToggle) {
    companionElements.wakeToggle.textContent = `Wake word: ${companionState.wakeEnabled ? "On" : "Off"}`;
  }
  companionElements.mic.textContent = companionState.speaking ? "Interrupt & talk" : "Talk now";
}

function getIdleListeningState() {
  if (shouldUseRealtimeVoice()) {
    if (companionState.realtimeConnecting) {
      return { text: "Connecting live voice", level: "medium" };
    }
    if (companionState.realtimeActive) {
      return { text: "Live conversation ready", level: "low" };
    }
  }
  if (companionState.speaking) {
    return { text: "Responding", level: "medium" };
  }
  if (hasActiveConversationSession()) {
    return { text: "Ready for follow-up", level: "low" };
  }
  return { text: "Idle", level: "neutral" };
}

function applyRecognitionPhrases(recognition) {
  if (!recognition || !("phrases" in recognition) || typeof window.SpeechRecognitionPhrase !== "function") {
    return;
  }

  const phraseBoosts = [
    ["navi", 10.0],
    ["hey navi", 10.0],
    ["open indoor navigation", 6.0],
    ["open outdoor navigation", 6.0],
    ["open main dashboard", 6.0],
    ["open describe page", 6.0],
    ["what is in front of me", 6.0],
    ["describe everything in front of me", 5.5],
    ["read the sign in front of me", 5.5],
    ["where am i going", 5.5],
    ["repeat guidance", 5.0],
    ["play music", 5.0],
    ["call", 4.5],
    ["set reminder", 4.5],
    ["battery", 4.0],
    ["weather", 4.0],
  ];

  try {
    recognition.phrases = phraseBoosts.map(
      ([phrase, boost]) => new window.SpeechRecognitionPhrase(phrase, boost),
    );
  } catch (_error) {
    // Ignore phrase-biasing failures and continue with normal recognition.
  }
}

function browserSupportsRealtimeVoice() {
  return Boolean(
    (window.AudioContext || window.webkitAudioContext) &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}

function shouldUseRealtimeVoice() {
  return companionState.realtimePreferred && companionRealtimeEnabled && browserSupportsRealtimeVoice();
}

function companionSpeak(text, options = {}) {
  const message = String(text || "").trim();
  if (!message || !("speechSynthesis" in window)) {
    return false;
  }

  cancelGlobalSpeechPlayback();
  if (companionState.followUpTimer) {
    window.clearTimeout(companionState.followUpTimer);
    companionState.followUpTimer = null;
  }

  companionState.speaking = true;
  companionState.lastSpokenText = message;
  companionState.lastSpokenNormalized = normalizeSpeechText(message);
  companionState.lastSpokenUntil = Date.now() + estimateSpeechDurationMs(message);
  assistiveVoiceChannel.setCompanionSpeaking(true);
  setListeningBadge("Responding", "medium");
  setMicButtonLabel();
  updateWakeBadgeState();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.rate = 0.97;
  utterance.pitch = 1.01;
  utterance.onend = () => {
    companionState.speaking = false;
    companionState.lastSpokenUntil = Date.now() + 1800;
    assistiveVoiceChannel.setCompanionSpeaking(false, ALERT_SUPPRESSION_AFTER_COMPANION_SPEECH_MS);
    setMicButtonLabel();
    if (typeof options.onend === "function") {
      options.onend();
      updateWakeBadgeState();
      return;
    }
    updateWakeBadgeState();
    if (hasActiveConversationSession()) {
      window.setTimeout(() => {
        if (!companionState.speaking) {
          startFollowUpListening();
        }
      }, FOLLOW_UP_LISTEN_DELAY_MS);
      return;
    }
    resumeWakeListeningSoon();
  };
  utterance.onerror = () => {
    companionState.speaking = false;
    companionState.lastSpokenUntil = Date.now() + 1200;
    assistiveVoiceChannel.setCompanionSpeaking(false, ALERT_SUPPRESSION_AFTER_COMPANION_SPEECH_MS);
    setMicButtonLabel();
    updateWakeBadgeState();
    if (hasActiveConversationSession()) {
      window.setTimeout(() => {
        if (!companionState.speaking) {
          startFollowUpListening();
        }
      }, FOLLOW_UP_LISTEN_DELAY_MS);
      return;
    }
    resumeWakeListeningSoon();
  };
  window.speechSynthesis.speak(utterance);
  return true;
}

function setCompanionReply(text, shouldSpeak = true) {
  const message = String(text || "").trim();
  if (!message) {
    return;
  }

  companionState.replyText = message;
  companionElements.reply.textContent = message;
  if (shouldSpeak) {
    companionSpeak(message);
  }
}

function setCompanionReplyAndListen(text) {
  const message = String(text || "").trim();
  if (!message) {
    return;
  }

  companionState.replyText = message;
  companionElements.reply.textContent = message;
  activateConversationSession();
  companionSpeak(message, {
    onend: () => startFollowUpListening(),
  });
}

function setCompanionHeard(text) {
  const message = String(text || "").trim();
  companionState.heardText = message;
  companionElements.heard.textContent = message || 'Listening for "Hey Navi", "Navi", or a button press.';
}

function setListeningBadge(text, level = "neutral") {
  companionElements.listeningBadge.textContent = text;
  companionElements.listeningBadge.className = `badge ${level}`;
}

function hasActiveConversationSession() {
  return Date.now() < companionState.conversationActiveUntil;
}

function updateWakeBadgeState() {
  if (shouldUseRealtimeVoice()) {
    if (companionState.realtimeConnecting) {
      setWakeBadge("Connecting live voice", "medium");
      return;
    }
    if (companionState.realtimeActive) {
      if (companionState.speaking) {
        setWakeBadge("Navi is speaking", "medium");
        return;
      }
      if (companionState.recognitionMode === "followup" || companionState.listening) {
        setWakeBadge("Listening for follow-up", "low");
        return;
      }
      setWakeBadge("Live session on", "low");
      return;
    }
    if (!companionState.wakeEnabled) {
      setWakeBadge("Hands-free wake off", "neutral");
      return;
    }
    if (companionState.micPermissionState === "denied") {
      setWakeBadge("Microphone blocked", "high");
      return;
    }
    if (companionState.recognitionMode === "wake" || companionState.listening) {
      setWakeBadge("Hands-free wake ready", "low");
      return;
    }
    if (companionState.micPermissionState === "prompt") {
      setWakeBadge("Tap once to arm wake", "medium");
      return;
    }
    setWakeBadge("Hands-free wake ready", "low");
    return;
  }
  if (!companionState.wakeEnabled) {
    setWakeBadge("Wake word off", "neutral");
    return;
  }
  if (companionState.speaking) {
    setWakeBadge("Navi active", "medium");
    return;
  }
  if (companionState.recognitionMode === "followup" || hasActiveConversationSession()) {
    setWakeBadge("Conversation active", "low");
    return;
  }
  if (companionState.recognitionMode === "wake" || companionState.listening) {
    setWakeBadge("Wake word ready", "low");
    return;
  }
  setWakeBadge("Wake word ready", "low");
}

function setWakeBadge(text, level = "neutral") {
  companionElements.wakeBadge.textContent = text;
  companionElements.wakeBadge.className = `badge ${level}`;
}

function armWakeListeningAfterInteraction() {
  const wakeBootstrap = async () => {
    if (!companionState.wakeEnabled || companionState.realtimeActive || companionState.realtimeConnecting) {
      return;
    }
    await primeMicrophonePermission();
    resumeWakeListeningSoon(0);
  };
  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
    window.addEventListener(eventName, wakeBootstrap, { once: true, passive: true });
  });
}

async function getMicrophonePermissionState() {
  if (!navigator.permissions || typeof navigator.permissions.query !== "function") {
    return "unknown";
  }
  try {
    const status = await navigator.permissions.query({ name: "microphone" });
    return String(status.state || "unknown");
  } catch (_error) {
    return "unknown";
  }
}

async function primeMicrophonePermission() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    companionState.micPermissionState = "unsupported";
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    companionState.micPermissionState = "granted";
    updateWakeBadgeState();
    return true;
  } catch (_error) {
    companionState.micPermissionState = "denied";
    updateWakeBadgeState();
    alert("Microphone access was denied. Please enable it in your browser settings to use voice commands.");
    return false;
  }
}

async function armWakeListeningIfPermitted() {
  const permissionState = await getMicrophonePermissionState();
  companionState.micPermissionState = permissionState;
  updateWakeBadgeState();
  if (
    permissionState === "granted" &&
    companionState.wakeEnabled &&
    !companionState.realtimeActive &&
    !companionState.realtimeConnecting
  ) {
    resumeWakeListeningSoon(0);
    return true;
  }
  return false;
}

function activateConversationSession(durationMs = CONVERSATION_SESSION_MS) {
  const until = Date.now() + Math.max(0, Number(durationMs) || 0);
  if (until > companionState.conversationActiveUntil) {
    companionState.conversationActiveUntil = until;
  }
  updateWakeBadgeState();
}

function clearConversationSession() {
  companionState.conversationActiveUntil = 0;
  if (companionState.followUpTimer) {
    window.clearTimeout(companionState.followUpTimer);
    companionState.followUpTimer = null;
  }
  updateWakeBadgeState();
}

function scheduleFollowUpStop() {
  if (companionState.followUpTimer) {
    window.clearTimeout(companionState.followUpTimer);
  }
  companionState.followUpTimer = window.setTimeout(() => {
    if (companionState.recognitionMode === "followup") {
      stopRecognition();
    }
    clearConversationSession();
    resumeWakeListeningSoon(0);
  }, FOLLOW_UP_LISTEN_TIMEOUT_MS);
}

function beginCompanionCommandRun() {
  companionState.commandRunId += 1;
  if (companionState.planAbortController) {
    try {
      companionState.planAbortController.abort();
    } catch (_error) {
      // Ignore abort errors from already-finished requests.
    }
    companionState.planAbortController = null;
  }
  return companionState.commandRunId;
}

function isCurrentCommandRun(runId) {
  return runId === companionState.commandRunId;
}

function openCompanionPanel(show = true) {
  companionElements.panel.classList.toggle("hidden", !show);
}

function renderContacts() {
  const entries = Object.entries(companionState.contacts).sort((left, right) => left[0].localeCompare(right[0]));
  if (!entries.length) {
    companionElements.contactList.innerHTML = '<p class="support-text">No saved contacts yet.</p>';
    return;
  }

  companionElements.contactList.innerHTML = "";
  entries.forEach(([name, number]) => {
    const card = document.createElement("article");
    card.className = "companion-list-item";
    card.innerHTML = `
      <div class="companion-list-copy">
        <strong>${name}</strong>
        <span>${number}</span>
      </div>
      <div class="companion-list-actions">
        <button class="button tertiary" type="button" data-companion-call="${name}">Call</button>
        <button class="button secondary" type="button" data-companion-remove-contact="${name}">Remove</button>
      </div>
    `;
    companionElements.contactList.appendChild(card);
  });
}

function renderReminders() {
  const now = Date.now();
  const reminders = [...companionState.reminders].sort((left, right) => left.dueAt - right.dueAt);
  if (!reminders.length) {
    companionElements.reminderList.innerHTML = '<p class="support-text">No active reminders yet.</p>';
    return;
  }

  companionElements.reminderList.innerHTML = "";
  reminders.forEach((reminder) => {
    const card = document.createElement("article");
    card.className = "companion-list-item";
    const dueLabel = reminder.dueAt <= now
      ? "Due now"
      : new Date(reminder.dueAt).toLocaleString();
    card.innerHTML = `
      <div class="companion-list-copy">
        <strong>${reminder.text}</strong>
        <small>${dueLabel}</small>
      </div>
      <div class="companion-list-actions">
        <button class="button secondary" type="button" data-companion-remove-reminder="${reminder.id}">Remove</button>
      </div>
    `;
    companionElements.reminderList.appendChild(card);
  });
}

function saveContacts() {
  saveStoredJson(CONTACTS_STORAGE_KEY, companionState.contacts);
  renderContacts();
}

function saveReminders() {
  saveStoredJson(REMINDERS_STORAGE_KEY, companionState.reminders);
  renderReminders();
}

function removeReminder(reminderId) {
  companionState.reminders = companionState.reminders.filter((item) => item.id !== reminderId);
  const timer = companionState.reminderTimers.get(reminderId);
  if (timer) {
    window.clearTimeout(timer);
    companionState.reminderTimers.delete(reminderId);
  }
  saveReminders();
}

function triggerReminder(reminder) {
  removeReminder(reminder.id);
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Navi Reminder", { body: reminder.text });
  }
  setCompanionReply(`Reminder: ${reminder.text}`, true);
}

function scheduleReminder(reminder) {
  const delay = Math.max(reminder.dueAt - Date.now(), 0);
  const existing = companionState.reminderTimers.get(reminder.id);
  if (existing) {
    window.clearTimeout(existing);
  }
  companionState.reminderTimers.set(
    reminder.id,
    window.setTimeout(() => triggerReminder(reminder), delay),
  );
}

function rescheduleReminders() {
  companionState.reminders.forEach((reminder) => {
    if (reminder.dueAt <= Date.now()) {
      triggerReminder(reminder);
      return;
    }
    scheduleReminder(reminder);
  });
  renderReminders();
}

function requestNotificationPermission() {
  if (!("Notification" in window) || Notification.permission !== "default") {
    return;
  }
  Notification.requestPermission().catch(() => {});
}

function setWakeEnabled(enabled) {
  companionState.wakeEnabled = Boolean(enabled);
  localStorage.setItem(WAKE_ENABLED_STORAGE_KEY, companionState.wakeEnabled ? "true" : "false");
  companionElements.wakeToggle.textContent = `${shouldUseRealtimeVoice() ? "Hands-free wake" : "Wake word"}: ${companionState.wakeEnabled ? "On" : "Off"}`;
  if (companionState.wakeEnabled) {
    startWakeSpeechMonitor();
    resumeWakeListeningSoon();
  } else {
    stopRecognition();
    stopWakeSpeechMonitor();
    clearConversationSession();
  }
  setMicButtonLabel();
  updateWakeBadgeState();
}

function stopRecognition() {
  const previousMode = companionState.recognitionMode;
  if (!companionState.recognition) {
    companionState.listening = false;
    companionState.recognitionMode = "idle";
    companionState.wakeCapturePending = false;
    const idleState = getIdleListeningState();
    setListeningBadge(idleState.text, idleState.level);
    if (previousMode === "command" || previousMode === "followup") {
      assistiveVoiceChannel.setCompanionListening(false, ALERT_SUPPRESSION_AFTER_COMMAND_MS);
    }
    updateWakeBadgeState();
    return;
  }

  try {
    companionState.recognition.stop();
  } catch (_error) {
    // Ignore stop errors from already-ended recognizers.
  }
  companionState.listening = false;
  companionState.recognitionMode = "idle";
  companionState.wakeCapturePending = false;
  const idleState = getIdleListeningState();
  setListeningBadge(idleState.text, idleState.level);
  if (previousMode === "command" || previousMode === "followup") {
    assistiveVoiceChannel.setCompanionListening(false, ALERT_SUPPRESSION_AFTER_COMMAND_MS);
  }
  updateWakeBadgeState();
}

function suspendWakeListening(durationMs = 12000) {
  companionState.suspendedUntil = Date.now() + durationMs;
  if (companionState.recognitionMode === "wake") {
    stopRecognition();
  }
}

function resumeWakeListeningSoon(delayMs = 500) {
  if (
    !companionState.wakeEnabled ||
    companionState.recognitionMode === "command" ||
    companionState.recognitionMode === "followup" ||
    hasActiveConversationSession() ||
    companionState.realtimeActive ||
    companionState.realtimeConnecting
  ) {
    return;
  }
  window.setTimeout(() => {
    if (
      Date.now() < companionState.suspendedUntil ||
      companionState.speaking ||
      companionState.listening ||
      hasActiveConversationSession()
    ) {
      return;
    }
    startWakeListening();
  }, delayMs);
}

function extractWakeCommand(transcript) {
  const raw = String(transcript || "").trim();
  for (const pattern of WAKE_WORD_PATTERNS) {
    if (pattern.test(raw)) {
      const remainder = raw.replace(pattern, "").replace(/^[,.\s]+/, "").trim();
      return { matched: true, remainder };
    }
  }
  return { matched: false, remainder: "" };
}

function isWakeOnlyUtterance(transcript) {
  const raw = String(transcript || "").trim();
  return WAKE_ONLY_PATTERNS.some((pattern) => pattern.test(raw));
}

function setupRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    companionState.recognition = null;
    companionState.wakeEnabled = false;
    localStorage.setItem(WAKE_ENABLED_STORAGE_KEY, "false");
    if (!shouldUseRealtimeVoice()) {
      companionElements.mic.disabled = true;
      companionElements.mic.textContent = "Mic unavailable";
    }
    companionElements.wakeToggle.textContent = shouldUseRealtimeVoice() ? "Hands-free wake unavailable" : "Wake word unavailable";
    setWakeBadge("Wake word unavailable", "high");
    return;
  }

  companionState.recognition = new SpeechRecognition();
  companionState.recognition.lang = "en-US";
  companionState.recognition.interimResults = false;
  companionState.recognition.maxAlternatives = 1;
  companionState.recognition.continuous = true;
  applyRecognitionPhrases(companionState.recognition);

  companionState.recognition.onstart = () => {
    companionState.listening = true;
    if (companionState.recognitionMode === "wake") {
      setListeningBadge("Wake listening", "low");
      startWakeSpeechMonitor();
    } else if (companionState.recognitionMode === "followup") {
      setListeningBadge("Follow-up listening", "medium");
      assistiveVoiceChannel.setCompanionListening(true);
      assistiveVoiceChannel.holdAlerts(ALERT_SUPPRESSION_WHILE_COMMAND_MS);
    } else {
      setListeningBadge("Listening", "medium");
      assistiveVoiceChannel.setCompanionListening(true);
      assistiveVoiceChannel.holdAlerts(ALERT_SUPPRESSION_WHILE_COMMAND_MS);
    }
    updateWakeBadgeState();
  };

  companionState.recognition.onend = () => {
    companionState.listening = false;
    const previousMode = companionState.recognitionMode;
    companionState.recognitionMode = "idle";
    companionState.wakeCapturePending = false;
    if (previousMode === "command" || previousMode === "followup") {
      assistiveVoiceChannel.setCompanionListening(false, ALERT_SUPPRESSION_AFTER_COMMAND_MS);
    }
    const idleState = getIdleListeningState();
    setListeningBadge(idleState.text, idleState.level);
    updateWakeBadgeState();
    if (previousMode === "wake") {
      resumeWakeListeningSoon(500);
    } else if (
      (previousMode === "command" || previousMode === "followup") &&
      hasActiveConversationSession() &&
      !companionState.speaking
    ) {
      window.setTimeout(() => {
        if (hasActiveConversationSession() && !companionState.speaking && !companionState.listening) {
          startFollowUpListening();
        }
      }, FOLLOW_UP_RESTART_DELAY_MS);
    }
  };

  companionState.recognition.onerror = () => {
    companionState.listening = false;
    setListeningBadge("Mic issue", "high");
    const previousMode = companionState.recognitionMode;
    companionState.recognitionMode = "idle";
    companionState.wakeCapturePending = false;
    if (previousMode === "command" || previousMode === "followup") {
      assistiveVoiceChannel.setCompanionListening(false, ALERT_SUPPRESSION_AFTER_COMMAND_MS);
      clearConversationSession();
    }
    updateWakeBadgeState();
    resumeWakeListeningSoon(1200);
  };

  companionState.recognition.onspeechstart = () => {
    if (companionState.recognitionMode === "wake") {
      pauseAlertsForWakeSpeech();
    }
  };

  companionState.recognition.onsoundstart = () => {
    if (companionState.recognitionMode === "wake") {
      assistiveVoiceChannel.holdAlerts(WAKE_SPEECH_DUCK_MS);
    }
  };

  companionState.recognition.onresult = async (event) => {
    const result = event.results[event.results.length - 1];
    if (!result || !result[0]) {
      return;
    }

    const transcript = result[0].transcript.trim();
    const isFinal = Boolean(result.isFinal);
    const mode = companionState.recognitionMode;
    if (isLikelySelfEcho(transcript)) {
      if (mode === "wake" && isFinal) {
        setListeningBadge("Wake listening", "low");
      } else if (mode === "followup") {
        setListeningBadge("Follow-up listening", "medium");
      } else if (mode === "command") {
        setListeningBadge("Listening", "medium");
      }
      return;
    }

    setCompanionHeard(transcript);

    if (mode === "wake") {
      if (transcript) {
        pauseAlertsForWakeSpeech();
      }

      const wake = extractWakeCommand(transcript);
      if (!wake.matched) {
        if (isFinal) {
          setListeningBadge("Wake listening", "low");
        }
        return;
      }

      if (!isFinal && !wake.remainder) {
        setListeningBadge("Checking wake word", "medium");
        return;
      }

      if (companionState.wakeCapturePending) {
        return;
      }

      companionState.wakeCapturePending = true;
      activateConversationSession();
      assistiveVoiceChannel.holdAlerts(ALERT_SUPPRESSION_WHILE_COMMAND_MS);
      cancelGlobalSpeechPlayback();
      stopRecognition();
      openCompanionPanel(true);
      if (shouldUseRealtimeVoice()) {
        await startRealtimeSession({
          initialPrompt: wake.remainder,
          fallbackToBrowser: true,
        });
        if (!wake.remainder) {
          companionState.replyText = "Live voice is ready. Go ahead.";
          companionElements.reply.textContent = companionState.replyText;
        }
        return;
      }
      if (wake.remainder) {
        await handleCompanionCommand(wake.remainder, "wake");
        return;
      }

      setCompanionReplyAndListen("Yes, I am listening. What do you need?");
      return;
    }

    if (!isFinal) {
      return;
      }

      activateConversationSession();
      stopRecognition();
      if (shouldUseRealtimeVoice() && companionState.realtimeActive) {
        sendRealtimeTextMessage(transcript);
        return;
      }
      await handleCompanionCommand(transcript, mode === "followup" ? "followup" : "voice");
    };
  }

function startWakeListening() {
  if (!companionState.recognition || !companionState.wakeEnabled) {
    return;
  }
  if (
    Date.now() < companionState.suspendedUntil ||
    companionState.recognitionMode === "command" ||
    companionState.recognitionMode === "followup" ||
    companionState.listening ||
    companionState.speaking ||
    hasActiveConversationSession() ||
    companionState.realtimeActive ||
    companionState.realtimeConnecting
  ) {
    return;
  }

  companionState.recognition.continuous = true;
  companionState.recognition.interimResults = true;
  companionState.recognitionMode = "wake";
  updateWakeBadgeState();
  try {
    companionState.recognition.start();
  } catch (_error) {
    resumeWakeListeningSoon(1200);
  }
}

function startBrowserCommandListening() {
  if (!companionState.recognition) {
    setCompanionReply("Speech recognition is not available in this browser.", false);
    return;
  }

  openCompanionPanel(true);
  activateConversationSession();
  beginCompanionCommandRun();
  stopRecognition();
  companionState.speaking = false;
  assistiveVoiceChannel.setCompanionSpeaking(false, ALERT_SUPPRESSION_AFTER_COMMAND_MS);
  cancelGlobalSpeechPlayback();
  setMicButtonLabel();
  assistiveVoiceChannel.holdAlerts(ALERT_SUPPRESSION_WHILE_COMMAND_MS);
  companionState.recognition.continuous = false;
  companionState.recognition.interimResults = false;
  companionState.recognitionMode = "command";
  try {
    companionState.recognition.start();
  } catch (_error) {
    assistiveVoiceChannel.setCompanionListening(false, ALERT_SUPPRESSION_AFTER_COMMAND_MS);
    setCompanionReply("I could not start the microphone right now. Please try again.", false);
    resumeWakeListeningSoon();
  }
}

function startCommandListening() {
  if (shouldUseRealtimeVoice()) {
    startRealtimeSession();
    return;
  }
  startBrowserCommandListening();
}

function startFollowUpListening() {
  if (!companionState.recognition) {
    resumeWakeListeningSoon(0);
    return;
  }
  if (!hasActiveConversationSession()) {
    resumeWakeListeningSoon(0);
    return;
  }
  if (
    companionState.speaking ||
    companionState.listening ||
    companionState.recognitionMode === "command"
  ) {
    return;
  }

  openCompanionPanel(true);
  stopRecognition();
  assistiveVoiceChannel.holdAlerts(ALERT_SUPPRESSION_WHILE_COMMAND_MS);
  companionState.recognition.continuous = false;
  companionState.recognition.interimResults = true;
  companionState.recognitionMode = "followup";
  updateWakeBadgeState();
  try {
    companionState.recognition.start();
    scheduleFollowUpStop();
  } catch (_error) {
    clearConversationSession();
    resumeWakeListeningSoon(800);
  }
}

function storeRealtimeAutostart(enabled) {
  try {
    if (!enabled) {
      sessionStorage.removeItem(AUTOSTART_REALTIME_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(
      AUTOSTART_REALTIME_STORAGE_KEY,
      JSON.stringify({
        enabled: true,
        createdAt: Date.now(),
      }),
    );
  } catch (_error) {
    // Ignore storage failures.
  }
}

function shouldAutostartRealtime() {
  try {
    const raw = sessionStorage.getItem(AUTOSTART_REALTIME_STORAGE_KEY);
    if (!raw) {
      return false;
    }
    if (raw === "true") {
      sessionStorage.removeItem(AUTOSTART_REALTIME_STORAGE_KEY);
      return false;
    }
    const payload = JSON.parse(raw);
    if (!payload || !payload.enabled) {
      sessionStorage.removeItem(AUTOSTART_REALTIME_STORAGE_KEY);
      return false;
    }
    if (Date.now() - Number(payload.createdAt || 0) > AUTOSTART_REALTIME_MAX_AGE_MS) {
      sessionStorage.removeItem(AUTOSTART_REALTIME_STORAGE_KEY);
      return false;
    }
    return true;
  } catch (_error) {
    return false;
  }
}

function buildRealtimeInstructions() {
  return [
    "You are Navi, a voice-first assistive companion for a vision-aid website.",
    "Sound like a calm assistive companion, not a robot. Keep replies short, direct, and helpful.",
    "You are helping a visually impaired user across the main dashboard, indoor navigation, outdoor navigation, and describe pages.",
    "Stay inside scope: page navigation, route help, scene understanding, indoor guidance, object description, reading signs, contacts, music, reminders, time, date, battery, and weather.",
    "If the user asks about what is in front of them, the route, the current page, room guidance, destination, nearby places, or page status, call tools before answering.",
    "Use ask_page_assistant for page-specific help and get_live_context when you need fresh page state.",
    "Use switch_page for main, indoor, outdoor, or describe page changes.",
    "If you already understand the user's intent, act quickly and avoid unnecessary confirmation.",
    "If the user asks outside this assistive scope, politely say you stay focused on assistive guidance.",
  ].join(" ");
}

function buildRealtimeTools() {
  return [
    {
      name: "get_live_context",
      description: "Get the current page, safety guidance, route status, scene summary, and recent page assistant state.",
      parametersJsonSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "ask_page_assistant",
      description: "Ask the current page assistant a focused question about scene guidance, indoor help, description, or outdoor route help.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          question: { type: "string" },
          page: { type: "string", enum: ["current", "home", "indoor", "outdoor", "describe"] },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
    {
      name: "switch_page",
      description: "Open a different page in the website.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          page: { type: "string", enum: ["home", "indoor", "outdoor", "describe"] },
        },
        required: ["page"],
        additionalProperties: false,
      },
    },
    {
      name: "repeat_guidance",
      description: "Repeat the latest guidance shown on the current page.",
      parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "save_contact",
      description: "Save a named phone contact.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          number: { type: "string" },
        },
        required: ["name", "number"],
        additionalProperties: false,
      },
    },
    {
      name: "call_contact",
      description: "Call a saved contact or a spoken phone number.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          target: { type: "string" },
        },
        required: ["target"],
        additionalProperties: false,
      },
    },
    {
      name: "open_music",
      description: "Open music in a browser tab for a given query.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "stop_music",
      description: "Close the currently opened music tab if one exists.",
      parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "set_reminder",
      description: "Set a reminder after a given amount of time.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          delay_value: { type: "integer", minimum: 1 },
          delay_unit: { type: "string", enum: ["seconds", "minutes", "hours"] },
        },
        required: ["text", "delay_value", "delay_unit"],
        additionalProperties: false,
      },
    },
    {
      name: "list_reminders",
      description: "List active reminders.",
      parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "get_time",
      description: "Get the current local time.",
      parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "get_date",
      description: "Get today's date.",
      parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "get_battery",
      description: "Get the current battery status if the browser exposes it.",
      parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "get_weather",
      description: "Get the local weather using the browser location.",
      parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ];
}

function loadGeminiSdk() {
  if (!geminiSdkModulePromise) {
    geminiSdkModulePromise = import(GEMINI_SDK_IMPORT_URL);
  }
  return geminiSdkModulePromise;
}

function stopRealtimeIdleTimer() {
  if (companionState.realtimeIdleTimer) {
    window.clearTimeout(companionState.realtimeIdleTimer);
    companionState.realtimeIdleTimer = null;
  }
}

function scheduleRealtimeIdleTimeout() {
  stopRealtimeIdleTimer();
  if (!companionState.realtimeActive) {
    return;
  }
  companionState.realtimeIdleTimer = window.setTimeout(() => {
    if (companionState.realtimeActive && !companionState.speaking) {
      stopRealtimeSession();
      setCompanionReply("Live voice paused. Say Hey Navi or press Start live voice when you need me again.", false);
    }
  }, REALTIME_IDLE_TIMEOUT_MS);
}

async function fetchRealtimeEphemeralKey() {
  const response = await fetch(companionRealtimeTokenUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not create a realtime session.");
  }
  const payload = await response.json();
  const key = payload.value || "";
  if (!key) {
    throw new Error("Realtime session key was missing.");
  }
  return {
    key,
    model: payload.model || "gemini-2.5-flash-native-audio-preview-12-2025",
  };
}

function decodeBase64Audio(base64Value) {
  const raw = window.atob(String(base64Value || ""));
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

function floatToPcm16(floatSamples) {
  const pcm = new Int16Array(floatSamples.length);
  for (let index = 0; index < floatSamples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, floatSamples[index]));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm;
}

function pcm16ToFloat32(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.byteLength / 2);
  for (let offset = 0; offset < bytes.byteLength; offset += 2) {
    samples[offset / 2] = view.getInt16(offset, true) / 0x8000;
  }
  return samples;
}

function ensureRealtimeOutputContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Realtime audio playback is not supported in this browser.");
  }
  if (!companionState.realtimeOutputContext) {
    companionState.realtimeOutputContext = new AudioContextClass({ sampleRate: 24000 });
    companionState.realtimeOutputCursor = companionState.realtimeOutputContext.currentTime;
  }
  if (companionState.realtimeOutputContext.state === "suspended") {
    void companionState.realtimeOutputContext.resume();
  }
  return companionState.realtimeOutputContext;
}

function clearRealtimePlaybackQueue() {
  companionState.realtimePlaybackSources.forEach((source) => {
    try {
      source.stop();
    } catch (_error) {
      // Ignore sources that already ended.
    }
  });
  companionState.realtimePlaybackSources = [];
  if (companionState.realtimeOutputContext) {
    companionState.realtimeOutputCursor = companionState.realtimeOutputContext.currentTime;
  } else {
    companionState.realtimeOutputCursor = 0;
  }
}

function queueRealtimeOutputAudio(base64Audio) {
  if (!base64Audio) {
    return;
  }
  const outputContext = ensureRealtimeOutputContext();
  const pcmBytes = decodeBase64Audio(base64Audio);
  const floatSamples = pcm16ToFloat32(pcmBytes);
  if (!floatSamples.length) {
    return;
  }
  const audioBuffer = outputContext.createBuffer(1, floatSamples.length, 24000);
  audioBuffer.copyToChannel(floatSamples, 0);
  const source = outputContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(outputContext.destination);
  const startAt = Math.max(outputContext.currentTime + 0.02, companionState.realtimeOutputCursor);
  source.start(startAt);
  companionState.realtimeOutputCursor = startAt + audioBuffer.duration;
  companionState.realtimePlaybackSources.push(source);
  source.onended = () => {
    companionState.realtimePlaybackSources = companionState.realtimePlaybackSources.filter((item) => item !== source);
  };
}

function stopRealtimeMicrophone(sendAudioEnd = true) {
  if (companionState.realtimeSession && sendAudioEnd) {
    try {
      companionState.realtimeSession.sendRealtimeInput({ audioStreamEnd: true });
    } catch (_error) {
      // Ignore stream-end errors while tearing down.
    }
  }
  if (companionState.realtimeProcessor) {
    try {
      companionState.realtimeProcessor.disconnect();
    } catch (_error) {
      // Ignore disconnect errors.
    }
  }
  if (companionState.realtimeInputSource) {
    try {
      companionState.realtimeInputSource.disconnect();
    } catch (_error) {
      // Ignore disconnect errors.
    }
  }
  if (companionState.realtimeSilentGain) {
    try {
      companionState.realtimeSilentGain.disconnect();
    } catch (_error) {
      // Ignore disconnect errors.
    }
  }
  if (companionState.realtimeStream) {
    companionState.realtimeStream.getTracks().forEach((track) => track.stop());
  }
  if (companionState.realtimeInputContext) {
    try {
      void companionState.realtimeInputContext.close();
    } catch (_error) {
      // Ignore close errors.
    }
  }
  companionState.realtimeProcessor = null;
  companionState.realtimeInputSource = null;
  companionState.realtimeSilentGain = null;
  companionState.realtimeStream = null;
  companionState.realtimeInputContext = null;
  companionState.realtimeLastVoiceAt = 0;
  companionState.realtimeSpeechDetected = false;
  companionState.realtimeSentAudioEnd = false;
}

async function startRealtimeMicrophone() {
  if (!companionState.realtimeSession || companionState.realtimeStream) {
    return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Realtime audio input is not supported in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const inputContext = new AudioContextClass({ sampleRate: 16000 });
  if (inputContext.state === "suspended") {
    await inputContext.resume();
  }
  const source = inputContext.createMediaStreamSource(stream);
  const processor = inputContext.createScriptProcessor(2048, 1, 1);
  const silentGain = inputContext.createGain();
  silentGain.gain.value = 0;
  const VOICE_THRESHOLD = 0.012;
  const TRAILING_AUDIO_MS = 240;
  const TURN_END_SILENCE_MS = 950;

  processor.onaudioprocess = (event) => {
    if (!companionState.realtimeSession) {
      return;
    }
    const samples = event.inputBuffer.getChannelData(0);
    let peak = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const amplitude = Math.abs(samples[index]);
      if (amplitude > peak) {
        peak = amplitude;
      }
    }
    const now = Date.now();
    const heardVoice = peak >= VOICE_THRESHOLD;

    if (heardVoice) {
      companionState.realtimeLastVoiceAt = now;
      companionState.realtimeSpeechDetected = true;
      companionState.realtimeSentAudioEnd = false;
      companionState.listening = true;
      assistiveVoiceChannel.setCompanionListening(true);
      setListeningBadge("Listening", "medium");
      updateWakeBadgeState();
    }

    const shouldStreamChunk =
      heardVoice ||
      (
        companionState.realtimeSpeechDetected &&
        now - companionState.realtimeLastVoiceAt <= TRAILING_AUDIO_MS
      );

    if (shouldStreamChunk) {
      const pcm = floatToPcm16(samples);
      if (!pcm.length) {
        return;
      }
      try {
        companionState.realtimeSession.sendRealtimeInput({
          audio: new Blob([pcm.buffer], { type: "audio/pcm;rate=16000" }),
        });
      } catch (_error) {
        // Ignore transient send errors; the live session will surface hard failures.
      }
      return;
    }

    if (
      companionState.realtimeSpeechDetected &&
      !companionState.realtimeSentAudioEnd &&
      now - companionState.realtimeLastVoiceAt > TURN_END_SILENCE_MS
    ) {
      companionState.realtimeSentAudioEnd = true;
      companionState.listening = false;
      assistiveVoiceChannel.setCompanionListening(false, ALERT_SUPPRESSION_AFTER_COMMAND_MS);
      setListeningBadge("Working on it", "medium");
      try {
        companionState.realtimeSession.sendRealtimeInput({ audioStreamEnd: true });
      } catch (_error) {
        // Ignore transient end-of-turn send errors.
      }
    }
  };

  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(inputContext.destination);

  companionState.realtimeStream = stream;
  companionState.realtimeInputContext = inputContext;
  companionState.realtimeInputSource = source;
  companionState.realtimeProcessor = processor;
  companionState.realtimeSilentGain = silentGain;
}

function stopRealtimeSession(options = {}) {
  const session = companionState.realtimeSession;
  companionState.realtimeConnecting = false;
  companionState.realtimeActive = false;
  companionState.speaking = false;
  companionState.listening = false;
  companionState.realtimeSession = null;
  companionState.realtimeUserTranscript = "";
  companionState.realtimeAssistantTranscript = "";
  companionState.realtimeModel = "";
  stopRealtimeIdleTimer();
  clearConversationSession();
  assistiveVoiceChannel.setCompanionListening(false, ALERT_SUPPRESSION_AFTER_COMMAND_MS);
  assistiveVoiceChannel.setCompanionSpeaking(false, ALERT_SUPPRESSION_AFTER_COMPANION_SPEECH_MS);
  stopRealtimeMicrophone(options.sendAudioEnd !== false);
  clearRealtimePlaybackQueue();
  if (companionState.realtimeOutputContext) {
    try {
      void companionState.realtimeOutputContext.close();
    } catch (_error) {
      // Ignore close errors.
    }
  }
  companionState.realtimeOutputContext = null;
  companionState.realtimeOutputCursor = 0;
  if (options.closeSession !== false && session) {
    try {
      session.close();
    } catch (_error) {
      // Ignore close errors.
    }
  }
  if (options.clearAutostart !== false) {
    storeRealtimeAutostart(false);
  }
  const idleState = getIdleListeningState();
  setListeningBadge(idleState.text, idleState.level);
  setMicButtonLabel();
  updateWakeBadgeState();
  if (options.resumeWake !== false) {
    resumeWakeListeningSoon(250);
  }
}

async function handleRealtimeToolCall(toolCallMessage, scheduling = "INTERRUPT") {
  if (!companionState.realtimeSession) {
    return;
  }

  const functionCalls = Array.isArray(toolCallMessage?.functionCalls) ? toolCallMessage.functionCalls : [];
  if (!functionCalls.length) {
    return;
  }

  const functionResponses = [];
  for (const functionCall of functionCalls) {
    const toolName = String(functionCall?.name || "").trim();
    let result;

    try {
      const args = functionCall?.args || {};

      if (toolName === "get_live_context") {
        result = buildCompanionContext();
      } else if (toolName === "ask_page_assistant") {
        const reply = await delegateToPageQuestion(String(args.question || ""), String(args.page || "current"));
        result = reply === "__navigating__" ? { status: "navigating" } : { reply };
      } else if (toolName === "switch_page") {
        const page = String(args.page || "home");
        storeRealtimeAutostart(true);
        navigateToPage(pageUrlFor(page), pageLabelFor(page), {
          reply: `Opening ${pageLabelFor(page)}.`,
        });
        result = { page, status: "navigating" };
      } else {
        const action = {
          tool: toolName,
          ...args,
          delay_ms: args.delay_unit && args.delay_value
            ? Number(args.delay_value) * (args.delay_unit === "hours" ? 3600000 : args.delay_unit === "minutes" ? 60000 : 1000)
            : args.delay_ms,
        };
        const actionReply = await executeCompanionAction(action, "", "voice");
        result = actionReply === "__navigating__"
          ? { status: "navigating" }
          : (typeof actionReply === "string" ? { reply: actionReply } : (actionReply || {}));
      }
    } catch (error) {
      result = {
        error: error && error.message ? error.message : "Tool execution failed.",
      };
    }

    functionResponses.push({
      id: functionCall.id,
      name: toolName,
      response: {
        ...result,
        scheduling,
      },
    });
  }

  companionState.realtimeSession.sendToolResponse({ functionResponses });
  scheduleRealtimeIdleTimeout();
}

function extractRealtimeAssistantText(serverMessage) {
  const outputTranscript = serverMessage?.serverContent?.outputTranscription?.text || "";
  if (outputTranscript) {
    return String(outputTranscript).trim();
  }
  const text = String(serverMessage?.text || "").trim();
  if (text) {
    return text;
  }
  return String(serverMessage?.serverContent?.modelTurn?.parts?.map((part) => part?.text || "").join(" ") || "").trim();
}

function extractRealtimeAudioBase64(serverMessage) {
  if (serverMessage?.data) {
    return String(serverMessage.data);
  }
  const parts = Array.isArray(serverMessage?.serverContent?.modelTurn?.parts)
    ? serverMessage.serverContent.modelTurn.parts
    : [];
  const inlinePart = parts.find((part) => part && part.inlineData && part.inlineData.data);
  if (inlinePart && inlinePart.inlineData && inlinePart.inlineData.data) {
    return String(inlinePart.inlineData.data);
  }
  return "";
}

async function handleRealtimeServerEvent(serverMessage) {
  if (!serverMessage || typeof serverMessage !== "object") {
    return;
  }
  scheduleRealtimeIdleTimeout();

  if (serverMessage.setupComplete) {
    companionState.realtimeActive = true;
    companionState.realtimeConnecting = false;
    companionState.listening = false;
    assistiveVoiceChannel.setCompanionListening(false, ALERT_SUPPRESSION_AFTER_COMMAND_MS);
    const idleState = getIdleListeningState();
    setListeningBadge(idleState.text, idleState.level);
    setMicButtonLabel();
    updateWakeBadgeState();
    return;
  }

  if (serverMessage.toolCall) {
    await handleRealtimeToolCall(serverMessage.toolCall);
    return;
  }

  if (serverMessage.serverContent?.interrupted) {
    clearRealtimePlaybackQueue();
    companionState.speaking = false;
    assistiveVoiceChannel.setCompanionSpeaking(false, ALERT_SUPPRESSION_AFTER_COMPANION_SPEECH_MS);
  }

  const inputTranscript = String(serverMessage?.serverContent?.inputTranscription?.text || "").trim();
  if (inputTranscript) {
    companionState.realtimeUserTranscript = inputTranscript;
    setCompanionHeard(inputTranscript);
  }

  const assistantText = extractRealtimeAssistantText(serverMessage);
  if (assistantText) {
    companionState.realtimeAssistantTranscript = assistantText;
    companionState.replyText = assistantText;
    companionElements.reply.textContent = assistantText;
    companionState.lastSpokenText = assistantText;
    companionState.lastSpokenNormalized = normalizeSpeechText(assistantText);
    companionState.lastSpokenUntil = Date.now() + estimateSpeechDurationMs(assistantText);
  }

  const audioBase64 = extractRealtimeAudioBase64(serverMessage);
  if (audioBase64) {
    companionState.speaking = true;
    assistiveVoiceChannel.setCompanionSpeaking(true);
    setListeningBadge("Responding", "medium");
    queueRealtimeOutputAudio(audioBase64);
  }

  if (serverMessage.serverContent?.waitingForInput) {
    companionState.listening = false;
    assistiveVoiceChannel.setCompanionListening(false, ALERT_SUPPRESSION_AFTER_COMMAND_MS);
    const idleState = getIdleListeningState();
    setListeningBadge(idleState.text, idleState.level);
  }

  if (serverMessage.serverContent?.generationComplete || serverMessage.serverContent?.turnComplete) {
    companionState.speaking = false;
    assistiveVoiceChannel.setCompanionSpeaking(false, ALERT_SUPPRESSION_AFTER_COMPANION_SPEECH_MS);
    const idleState = getIdleListeningState();
    setListeningBadge(idleState.text, idleState.level);
    updateWakeBadgeState();
    if (companionState.realtimeActive) {
      window.setTimeout(() => {
        if (companionState.realtimeActive && !companionState.speaking && !companionState.listening) {
          startFollowUpListening();
        }
      }, FOLLOW_UP_LISTEN_DELAY_MS);
    }
  }

  if (serverMessage.goAway) {
    stopRealtimeSession({ clearAutostart: false, closeSession: false });
    setCompanionReply("Live voice needs a fresh session. Say Hey Navi or press Start live voice again.", false);
    return;
  }

  if (serverMessage.error) {
    companionState.realtimeConnecting = false;
    companionState.speaking = false;
    companionState.listening = false;
    assistiveVoiceChannel.setCompanionListening(false, ALERT_SUPPRESSION_AFTER_COMMAND_MS);
    assistiveVoiceChannel.setCompanionSpeaking(false, ALERT_SUPPRESSION_AFTER_COMPANION_SPEECH_MS);
    const message = String(serverMessage.error?.message || "Realtime voice encountered an issue.").trim();
    setCompanionReply(message, false);
    updateWakeBadgeState();
  }
}

async function startRealtimeSession(options = {}) {
  if (!shouldUseRealtimeVoice()) {
    startCommandListening();
    return;
  }
  if (companionState.realtimeConnecting) {
    return;
  }
  if (companionState.realtimeActive && companionState.realtimeSession) {
    if (options.initialPrompt) {
      sendRealtimeTextMessage(options.initialPrompt);
    } else {
      startFollowUpListening();
    }
    return;
  }

  openCompanionPanel(true);
  stopRecognition();
  clearConversationSession();
  cancelGlobalSpeechPlayback();
  assistiveVoiceChannel.setCompanionSpeaking(false, ALERT_SUPPRESSION_AFTER_COMMAND_MS);
  companionState.realtimeConnecting = true;
  companionState.realtimeAssistantTranscript = "";
  companionState.realtimeUserTranscript = "";
  setMicButtonLabel();
  setListeningBadge("Connecting live voice", "medium");
  updateWakeBadgeState();

  try {
    const [{ GoogleGenAI, Modality }, tokenPayload] = await Promise.all([
      loadGeminiSdk(),
      fetchRealtimeEphemeralKey(),
    ]);
    const ai = new GoogleGenAI({
      apiKey: tokenPayload.key,
      httpOptions: {
        apiVersion: "v1alpha",
      },
    });
    const session = await ai.live.connect({
      model: tokenPayload.model,
      callbacks: {
        onopen: () => {
          companionState.realtimeActive = true;
          companionState.realtimeConnecting = false;
          companionState.realtimeModel = tokenPayload.model;
          companionState.realtimeSessionStartedAt = Date.now();
          const heardPrompt = options.initialPrompt
            ? `Heard: ${options.initialPrompt}`
            : "Live conversation is ready. Talk naturally without waking Navi again.";
          setCompanionHeard(heardPrompt);
          const idleState = getIdleListeningState();
          setListeningBadge(idleState.text, idleState.level);
          setMicButtonLabel();
          updateWakeBadgeState();
          scheduleRealtimeIdleTimeout();
          if (!options.initialPrompt) {
            window.setTimeout(() => {
              if (companionState.realtimeActive && !companionState.speaking) {
                startFollowUpListening();
              }
            }, 120);
          }
        },
        onmessage: (message) => {
          void handleRealtimeServerEvent(message);
        },
        onerror: (event) => {
          const message = String(event?.message || "Gemini live voice encountered an issue.").trim();
          stopRealtimeSession({ clearAutostart: false, closeSession: false });
          setCompanionReply(message, false);
        },
        onclose: () => {
          stopRealtimeSession({ clearAutostart: false, closeSession: false });
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: buildRealtimeInstructions(),
        tools: [{ functionDeclarations: buildRealtimeTools() }],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        thinkingConfig: {
          thinkingBudget: 0,
        },
        enableAffectiveDialog: true,
        maxOutputTokens: 160,
      },
    });

    companionState.realtimeSession = session;
    if (options.initialPrompt) {
      sendRealtimeTextMessage(options.initialPrompt);
    }
  } catch (error) {
    stopRealtimeSession({ resumeWake: false });
    setCompanionReply(
      error && error.message
        ? error.message
        : "I could not start Gemini live voice right now. Please try again.",
      false,
    );
    if (options.fallbackToBrowser !== false) {
      startBrowserCommandListening();
      return;
    }
    resumeWakeListeningSoon(600);
  }
}

function sendRealtimeTextMessage(text) {
  const message = String(text || "").trim();
  if (!message || !companionState.realtimeActive || !companionState.realtimeSession) {
    return false;
  }
  setCompanionHeard(message);
  activateConversationSession();
  scheduleRealtimeIdleTimeout();
  companionState.replyText = "";
  companionElements.reply.textContent = "Working on it...";
  setListeningBadge("Working on it", "medium");
  companionState.realtimeSession.sendClientContent({
    turns: message,
    turnComplete: true,
  });
  return true;
}

function currentPageHelper() {
  return window.AssistiveVisionPage || null;
}

function pageUrlFor(page) {
  const mapping = {
    home: companionBody.dataset.homeUrl,
    indoor: companionBody.dataset.indoorPageUrl,
    describe: companionBody.dataset.describeUrl,
    outdoor: companionBody.dataset.outdoorUrl,
  };
  return mapping[page] || companionBody.dataset.homeUrl;
}

function pageLabelFor(page) {
  const mapping = {
    home: "the main dashboard",
    indoor: "indoor navigation",
    describe: "the describe page",
    outdoor: "outdoor navigation",
  };
  return mapping[page] || "the page";
}

function navigateToPage(url, label, options = {}) {
  const message = typeof options.reply === "string" ? options.reply.trim() : `Opening ${label}.`;
  if (message) {
    setCompanionReply(message, options.speak !== false);
  }
  window.setTimeout(() => {
    window.location.href = url;
  }, typeof options.delayMs === "number" ? options.delayMs : 180);
}

function queuePendingPageAction(action) {
  try {
    sessionStorage.setItem(PENDING_PAGE_ACTION_STORAGE_KEY, JSON.stringify(action));
  } catch (_error) {
    // Ignore storage failures and continue without pending carry-over.
  }
}

function consumePendingPageAction() {
  try {
    const raw = sessionStorage.getItem(PENDING_PAGE_ACTION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    sessionStorage.removeItem(PENDING_PAGE_ACTION_STORAGE_KEY);
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function buildCompactScene(scene, type) {
  if (!scene) {
    return {};
  }
  if (type === "safety") {
    return {
      command: scene.command || "",
      spoken_message: scene.spoken_message || "",
      safe_direction: scene.safe_direction || "",
      path_clear: Boolean(scene.path_clear),
      urgency: scene.urgency || "",
      estimated_clear_steps: scene.estimated_clear_steps || "",
      primary_obstacle: scene.primary_obstacle || {},
    };
  }
  return {
    scene_caption: scene.scene_caption || "",
    summary: scene.summary || "",
    object_counts: scene.object_counts || {},
  };
}

function buildCompanionContext() {
  const helper = currentPageHelper();
  const safetyScene = helper && typeof helper.getSafetyScene === "function"
    ? helper.getSafetyScene()
    : null;
  const contextScene = helper && typeof helper.getContextScene === "function"
    ? helper.getContextScene()
    : null;
  const assistantContext = helper && typeof helper.getAssistantContext === "function"
    ? helper.getAssistantContext()
    : {};

  return {
    page: (helper && helper.page) || companionBody.dataset.page || "home",
    current_guidance: helper && typeof helper.getCurrentGuidance === "function"
      ? helper.getCurrentGuidance()
      : "",
    safety: buildCompactScene(safetyScene, "safety"),
    scene: buildCompactScene(contextScene, "context"),
    assistant: {
      reply: assistantContext.assistantReply || "",
      guidance: assistantContext.guidance || "",
      mode: assistantContext.mode || "",
    },
    route: {
      destination_label: assistantContext.destinationLabel || "",
      next_instruction: assistantContext.nextInstruction || "",
      status: assistantContext.routeStatus || "",
    },
  };
}

async function requestCompanionPlan(message, source = "voice", runId = 0) {
  if (!companionChatUrl) {
    return null;
  }

  const controller = new AbortController();
  companionState.planAbortController = controller;

  try {
    const response = await fetch(companionChatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        message,
        source,
        context: buildCompanionContext(),
      }),
    });
    if (!response.ok) {
      throw new Error("Companion chat request failed.");
    }
    const payload = await response.json();
    if (runId && !isCurrentCommandRun(runId)) {
      return null;
    }
    return payload;
  } finally {
    if (companionState.planAbortController === controller) {
      companionState.planAbortController = null;
    }
  }
}

function resolveContact(commandValue) {
  const normalized = normalizeName(commandValue);
  if (!normalized) {
    return null;
  }
  if (/^\+?[\d\s-]{6,}$/.test(commandValue.trim())) {
    return {
      label: commandValue.trim(),
      number: commandValue.replace(/[^\d+]/g, ""),
    };
  }

  const match = Object.entries(companionState.contacts).find(([name]) => normalizeName(name) === normalized);
  if (!match) {
    return null;
  }
  return { label: match[0], number: match[1] };
}

function openMusic(query) {
  const search = encodeURIComponent(query || "relaxing music");
  const url = `https://music.youtube.com/search?q=${search}`;
  const popup = window.open(url, "_blank");
  if (popup) {
    companionState.musicWindow = popup;
    return true;
  }
  return false;
}

function closeMusicWindow() {
  if (companionState.musicWindow && !companionState.musicWindow.closed) {
    companionState.musicWindow.close();
    companionState.musicWindow = null;
    return true;
  }
  return false;
}

async function getBatteryReply() {
  if (!navigator.getBattery) {
    return "Battery information is not available in this browser.";
  }
  const battery = await navigator.getBattery();
  const percent = Math.round(battery.level * 100);
  const charging = battery.charging ? "and it is charging" : "and it is not charging";
  return `Battery is at ${percent} percent, ${charging}.`;
}

function weatherCodeLabel(code) {
  const mapping = {
    0: "clear",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "foggy",
    48: "foggy",
    51: "light drizzle",
    53: "drizzle",
    55: "heavy drizzle",
    61: "light rain",
    63: "rain",
    65: "heavy rain",
    71: "light snow",
    73: "snow",
    75: "heavy snow",
    80: "rain showers",
    81: "strong rain showers",
    82: "very strong rain showers",
    95: "thunderstorm",
  };
  return mapping[code] || "changeable weather";
}

async function getWeatherReply() {
  if (companionState.weatherCache && Date.now() - companionState.weatherCache.at < WEATHER_CACHE_MS) {
    return companionState.weatherCache.reply;
  }

  if (!navigator.geolocation) {
    return "Weather needs location support in this browser.";
  }

  const position = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 30000,
    });
  }).catch(() => null);

  if (!position) {
    return "I could not get the location for weather right now.";
  }

  const { latitude, longitude } = position.coords;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    return "Weather is not available right now.";
  }
  const payload = await response.json();
  const current = payload.current || {};
  const reply = `It is about ${Math.round(current.temperature_2m ?? 0)} degrees Celsius with ${weatherCodeLabel(current.weather_code)} and wind around ${Math.round(current.wind_speed_10m ?? 0)} kilometers per hour.`;
  companionState.weatherCache = { at: Date.now(), reply };
  return reply;
}

function parseReminderCommand(transcript) {
  const match = transcript.match(/\b(?:remind me|set (?:a )?reminder)\b.*?\bin (\d+)\s*(second|seconds|minute|minutes|hour|hours)\b(?:\s+to)?\s+(.+)/i);
  if (!match) {
    return null;
  }

  const count = Number(match[1]);
  const unit = match[2].toLowerCase();
  const text = match[3].trim().replace(/[.?!]+$/, "");
  if (!count || !text) {
    return null;
  }

  const multiplier = unit.startsWith("hour") ? 3600000 : unit.startsWith("minute") ? 60000 : 1000;
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    text,
    dueAt: Date.now() + (count * multiplier),
  };
}

function createReminder(text, delayMs) {
  const reminder = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    text: String(text || "").trim(),
    dueAt: Date.now() + Math.max(0, Number(delayMs) || 0),
  };
  if (!reminder.text) {
    return null;
  }
  companionState.reminders.push(reminder);
  saveReminders();
  scheduleReminder(reminder);
  return reminder;
}

function saveContactFromInputs() {
  const name = companionElements.contactName.value.trim();
  const number = companionElements.contactNumber.value.trim();
  if (!name || !number) {
    setCompanionReply("Please enter both a contact name and a phone number first.", false);
    return;
  }

  companionState.contacts[name] = number;
  companionElements.contactName.value = "";
  companionElements.contactNumber.value = "";
  saveContacts();
  setCompanionReply(`${name} is saved as a contact.`, true);
}

function saveContactFromVoice(transcript) {
  const match = transcript.match(/\bsave contact\s+(.+?)\s+(\+?[\d\s-]{6,})$/i);
  if (!match) {
    return false;
  }
  const name = match[1].trim();
  const number = match[2].trim();
  companionState.contacts[name] = number;
  saveContacts();
  setCompanionReply(`${name} is saved as a contact.`, true);
  return true;
}

async function delegateToPageQuestion(command, targetPage = "current") {
  const helper = currentPageHelper();
  const currentPage = (helper && helper.page) || companionBody.dataset.page || "home";
  const page = targetPage === "current" ? currentPage : targetPage;

  if (page !== currentPage) {
    if (shouldUseRealtimeVoice() && companionState.realtimeActive) {
      storeRealtimeAutostart(true);
    }
    queuePendingPageAction({
      tool: "delegate_page",
      page,
      question: command,
    });
    navigateToPage(pageUrlFor(page), pageLabelFor(page), {
      reply: `I will continue that on ${pageLabelFor(page)}.`,
    });
    return "__navigating__";
  }

  if (!helper || typeof helper.askQuestion !== "function") {
    return "I can switch pages and help with utility tasks here, but this page does not expose a page assistant yet.";
  }

  const reply = await helper.askQuestion(command);
  return reply || "I could not get a reply from the current page assistant.";
}

async function executeCompanionAction(action, transcript, source) {
  const tool = action && action.tool;
  if (!tool) {
    return "";
  }

  if (tool === "reply_only") {
    return String(action.text || "").trim();
  }

  if (tool === "switch_page") {
    const page = action.page || "home";
    const currentPage = (currentPageHelper() && currentPageHelper().page) || companionBody.dataset.page || "home";
    if (page === currentPage) {
      return "";
    }
    if (shouldUseRealtimeVoice() && companionState.realtimeActive) {
      storeRealtimeAutostart(true);
    }
    navigateToPage(pageUrlFor(page), pageLabelFor(page), {
      reply: String(action.text || "").trim() || `Opening ${pageLabelFor(page)}.`,
    });
    return "__navigating__";
  }

  if (tool === "delegate_page") {
    return delegateToPageQuestion(action.question || transcript, action.page || "current");
  }

  if (tool === "repeat_guidance") {
    const helper = currentPageHelper();
    return helper && typeof helper.getCurrentGuidance === "function"
      ? helper.getCurrentGuidance()
      : "I do not have fresh guidance from this page yet.";
  }

  if (tool === "save_contact") {
    const name = String(action.name || "").trim();
    const number = String(action.number || "").trim();
    if (!name || !number) {
      return "I still need both the contact name and phone number.";
    }
    companionState.contacts[name] = number;
    saveContacts();
    return `${name} is saved as a contact.`;
  }

  if (tool === "call_contact") {
    const target = String(action.target || "").trim();
    const contact = resolveContact(target);
    if (!contact) {
      return "I could not find that contact. Save the contact in the companion panel first, or say a phone number directly.";
    }
    window.setTimeout(() => {
      window.location.href = `tel:${contact.number}`;
    }, 160);
    return `Calling ${contact.label}.`;
  }

  if (tool === "open_music") {
    const query = String(action.query || "music").trim() || "music";
    const opened = openMusic(query);
    return opened
      ? `I opened music for ${query}.`
      : "The browser blocked the music window. Please allow pop-ups for this site.";
  }

  if (tool === "stop_music") {
    const closed = closeMusicWindow();
    return closed
      ? "I closed the music window."
      : "I do not have an open music window to close right now.";
  }

  if (tool === "set_reminder") {
    const reminder = createReminder(action.text, action.delay_ms);
    if (!reminder) {
      return "I could not set that reminder yet.";
    }
    return `Reminder set for ${new Date(reminder.dueAt).toLocaleTimeString()}: ${reminder.text}.`;
  }

  if (tool === "list_reminders") {
    if (!companionState.reminders.length) {
      return "You do not have any active reminders right now.";
    }
    return `Your reminders are: ${companionState.reminders
      .slice()
      .sort((left, right) => left.dueAt - right.dueAt)
      .map((item) => `${item.text} at ${new Date(item.dueAt).toLocaleTimeString()}`)
      .join(". ")}.`;
  }

  if (tool === "get_time") {
    return `It is ${new Date().toLocaleTimeString()}.`;
  }

  if (tool === "get_date") {
    return `Today is ${new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`;
  }

  if (tool === "get_battery") {
    return getBatteryReply();
  }

  if (tool === "get_weather") {
    return getWeatherReply();
  }

  return "";
}

async function executeCompanionPlan(plan, transcript, source = "voice", runId = 0) {
  const actions = Array.isArray(plan && plan.actions) ? plan.actions : [];
  let reply = String((plan && plan.reply) || "").trim();

  for (const action of actions) {
    if (runId && !isCurrentCommandRun(runId)) {
      return;
    }
    const actionReply = await executeCompanionAction(action, transcript, source);
    if (actionReply === "__navigating__") {
      return;
    }
    if (typeof actionReply === "string" && actionReply.trim()) {
      reply = actionReply.trim();
    }
  }

  if (runId && !isCurrentCommandRun(runId)) {
    return;
  }
  if (!reply) {
    reply = "I am ready.";
  }
  setCompanionReply(reply, source !== "silent");
}

async function resumePendingPageAction() {
  const pending = consumePendingPageAction();
  if (!pending || pending.page !== ((currentPageHelper() && currentPageHelper().page) || companionBody.dataset.page || "home")) {
    if (pending) {
      queuePendingPageAction(pending);
    }
    return;
  }

  if (pending.tool === "delegate_page" && pending.question) {
    const reply = await delegateToPageQuestion(pending.question, "current");
    if (reply && reply !== "__navigating__") {
      setCompanionHeard(pending.question);
      setCompanionReply(reply, true);
    }
  }
}

async function handleCompanionCommandLocally(rawCommand, source = "voice") {
  const transcript = String(rawCommand || "").trim();
  if (!transcript) {
    setCompanionReply("I did not catch that. Please try again.", true);
    return;
  }

  setCompanionHeard(transcript);
  openCompanionPanel(true);
  requestNotificationPermission();

  const lowered = transcript.toLowerCase();
  if (isWakeOnlyUtterance(transcript)) {
    if (source === "voice" || source === "wake") {
      setCompanionReplyAndListen("Yes, I am listening. What do you need?");
      return;
    }
    setCompanionReply("Yes, I am listening. Tell me what you need.", true);
    return;
  }

  if (saveContactFromVoice(transcript)) {
    return;
  }

  if (/\b(open|go to|switch to|take me to)\s+(main dashboard|main page|dashboard|home)\b/i.test(lowered)) {
    navigateToPage(companionBody.dataset.homeUrl, "the main dashboard");
    return;
  }
  if (/\b(open|go to|switch to|take me to)\s+(indoor navigation|indoor page|indoor mode)\b/i.test(lowered)) {
    navigateToPage(companionBody.dataset.indoorPageUrl, "indoor navigation");
    return;
  }
  if (/\b(open|go to|switch to|take me to)\s+(outdoor navigation|outdoor page|outdoor mode)\b/i.test(lowered)) {
    navigateToPage(companionBody.dataset.outdoorUrl, "outdoor navigation");
    return;
  }
  if (/\b(open|go to|switch to|take me to)\s+(describe|description page|describe page)\b/i.test(lowered)) {
    navigateToPage(companionBody.dataset.describeUrl, "the describe page");
    return;
  }

  if (/\b(repeat guidance|repeat alert|say that again|current guidance|what is the guidance now)\b/i.test(lowered)) {
    const helper = currentPageHelper();
    const guidance = helper && typeof helper.getCurrentGuidance === "function"
      ? helper.getCurrentGuidance()
      : "I do not have fresh guidance from this page yet.";
    setCompanionReply(guidance, true);
    return;
  }

  if (/\b(call)\b/i.test(lowered)) {
    const target = transcript.replace(/\bcall\b/i, "").trim();
    const contact = resolveContact(target);
    if (!contact) {
      setCompanionReply("I could not find that contact. Save the contact in the companion panel first, or say a phone number directly.", true);
      return;
    }
    setCompanionReply(`Calling ${contact.label}.`, true);
    window.setTimeout(() => {
      window.location.href = `tel:${contact.number}`;
    }, 160);
    return;
  }

  if (/^(play|listen to)\b/i.test(lowered)) {
    const query = transcript.replace(/^(play|listen to)\b/i, "").trim() || "music";
    const opened = openMusic(query);
    setCompanionReply(
      opened
        ? `I opened music for ${query}.`
        : "The browser blocked the music window. Please allow pop-ups for this site.",
      true,
    );
    return;
  }

  if (/\b(stop music|pause music|close music)\b/i.test(lowered)) {
    const closed = closeMusicWindow();
    setCompanionReply(closed ? "I closed the music window." : "I do not have an open music window to close right now.", true);
    return;
  }

  const reminder = parseReminderCommand(transcript);
  if (reminder) {
    companionState.reminders.push(reminder);
    saveReminders();
    scheduleReminder(reminder);
    const dueLabel = new Date(reminder.dueAt).toLocaleTimeString();
    setCompanionReply(`Reminder set for ${dueLabel}: ${reminder.text}.`, true);
    return;
  }

  if (/\b(what reminders do i have|show reminders|list reminders|my reminders)\b/i.test(lowered)) {
    if (!companionState.reminders.length) {
      setCompanionReply("You do not have any active reminders right now.", true);
      return;
    }
    const list = companionState.reminders
      .slice()
      .sort((left, right) => left.dueAt - right.dueAt)
      .map((item) => `${item.text} at ${new Date(item.dueAt).toLocaleTimeString()}`)
      .join(". ");
    setCompanionReply(`Your reminders are: ${list}.`, true);
    return;
  }

  if (/\b(time|what time is it|current time)\b/i.test(lowered)) {
    setCompanionReply(`It is ${new Date().toLocaleTimeString()}.`, true);
    return;
  }

  if (/\b(date|today'?s date|what is the date|day today)\b/i.test(lowered)) {
    setCompanionReply(`Today is ${new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`, true);
    return;
  }

  if (/\b(battery|battery level|how much battery)\b/i.test(lowered)) {
    setCompanionReply(await getBatteryReply(), true);
    return;
  }

  if (/\b(weather|temperature|forecast)\b/i.test(lowered)) {
    setCompanionReply(await getWeatherReply(), true);
    return;
  }

  if (/\b(what can you do|help|how can you help)\b/i.test(lowered)) {
    setCompanionReply(
      "I can switch between main, indoor, outdoor, and describe pages; repeat guidance; answer page-specific assistive questions; call a saved contact; open music; set reminders; and tell you the time, date, battery, or weather.",
      true,
    );
    return;
  }

  const delegatedReply = await delegateToPageQuestion(transcript, "current");
  setCompanionReply(delegatedReply, source !== "silent");
}

async function handleCompanionCommand(rawCommand, source = "voice") {
  const transcript = String(rawCommand || "").trim();
  if (!transcript) {
    setCompanionReply("I did not catch that. Please try again.", true);
    return;
  }

  const runId = beginCompanionCommandRun();
  activateConversationSession();
  setCompanionHeard(transcript);
  openCompanionPanel(true);
  requestNotificationPermission();
  setListeningBadge("Working on it", "medium");
  updateWakeBadgeState();

  if (isWakeOnlyUtterance(transcript)) {
    if (source === "voice" || source === "wake") {
      setCompanionReplyAndListen("Yes, I am listening. What do you need?");
      return;
    }
    setCompanionReply("Yes, I am listening. Tell me what you need.", true);
    return;
  }

  try {
    const plan = await requestCompanionPlan(transcript, source, runId);
    if (!isCurrentCommandRun(runId)) {
      return;
    }
    if (plan) {
      await executeCompanionPlan(plan, transcript, source, runId);
      return;
    }
  } catch (error) {
    if (error && error.name === "AbortError") {
      return;
    }
    // Fall back to the local assistant rules if the backend plan is unavailable.
  }

  if (!isCurrentCommandRun(runId)) {
    return;
  }
  await handleCompanionCommandLocally(transcript, source);
}

function attachCompanionUiEvents() {
  companionElements.toggle.addEventListener("click", () => {
    openCompanionPanel(true);
    if (shouldUseRealtimeVoice()) {
      if (!companionState.realtimeActive) {
        startRealtimeSession();
      }
      return;
    }
    startCommandListening();
  });

  companionElements.close.addEventListener("click", () => {
    openCompanionPanel(false);
  });

  companionElements.mic.addEventListener("click", () => {
    if (shouldUseRealtimeVoice()) {
      if (companionState.realtimeActive || companionState.realtimeConnecting) {
        stopRealtimeSession();
        return;
      }
      startRealtimeSession();
      return;
    }
    startCommandListening();
  });

  companionElements.wakeToggle.addEventListener("click", () => {
    setWakeEnabled(!companionState.wakeEnabled);
  });

  companionElements.saveContact.addEventListener("click", () => {
    saveContactFromInputs();
  });

  companionElements.contactList.addEventListener("click", (event) => {
    const callButton = event.target.closest("[data-companion-call]");
    if (callButton) {
      handleCompanionCommand(`Call ${callButton.dataset.companionCall}`, "voice");
      return;
    }

    const removeButton = event.target.closest("[data-companion-remove-contact]");
    if (removeButton) {
      delete companionState.contacts[removeButton.dataset.companionRemoveContact];
      saveContacts();
      setCompanionReply("Contact removed.", true);
    }
  });

  companionElements.reminderList.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-companion-remove-reminder]");
    if (!removeButton) {
      return;
    }
    removeReminder(removeButton.dataset.companionRemoveReminder);
    setCompanionReply("Reminder removed.", true);
  });

  document.querySelectorAll("[data-companion-command]").forEach((button) => {
    button.addEventListener("click", () => {
      if (shouldUseRealtimeVoice() && companionState.realtimeActive) {
        sendRealtimeTextMessage(button.dataset.companionCommand);
        return;
      }
      handleCompanionCommand(button.dataset.companionCommand, "typed");
    });
  });

  document.addEventListener("click", (event) => {
    const competingMic = event.target.closest("#voiceQuestion, #voiceDestination, #voiceConfirm, #talkToNavigator");
    if (competingMic) {
      suspendWakeListening(15000);
    }
  });
}

function initializeCompanion() {
  renderContacts();
  rescheduleReminders();
  attachCompanionUiEvents();
  setupRecognition();
  if (shouldUseRealtimeVoice()) {
    setCompanionHeard('Say "Hey Navi" or press Start live voice to begin a hands-free conversation.');
  } else {
    setCompanionHeard('Say "Hey Navi", say "Navi", or press the round button to talk.');
  }
  if (companionState.recognition || !shouldUseRealtimeVoice()) {
    setWakeEnabled(companionState.wakeEnabled);
  }
  armWakeListeningAfterInteraction();
  void armWakeListeningIfPermitted();
  const idleState = getIdleListeningState();
  setListeningBadge(idleState.text, idleState.level);
  setMicButtonLabel();
  updateWakeBadgeState();
  requestNotificationPermission();
  resumePendingPageAction();
  if (shouldUseRealtimeVoice() && shouldAutostartRealtime()) {
    window.setTimeout(() => {
      startRealtimeSession();
    }, 120);
  }
  window.setInterval(() => {
    const staleReminders = companionState.reminders.filter((item) => item.dueAt <= Date.now());
    staleReminders.forEach(triggerReminder);
  }, REMINDER_CHECK_INTERVAL_MS);
}

initializeCompanion();
