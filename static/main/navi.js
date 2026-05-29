(() => {
const body = document.body;

const elements = {
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

const CONTACTS_STORAGE_KEY = "navi.contacts";
const REMINDERS_STORAGE_KEY = "navi.reminders";
const WAKE_ENABLED_STORAGE_KEY = "navi.wakeEnabled";
const PENDING_PAGE_ACTION_STORAGE_KEY = "navi.pendingPageAction";
const GLOBAL_ROUTE_STORAGE_KEY = "navi.globalRoute";
const WEATHER_CACHE_MS = 10 * 60 * 1000;
const REMINDER_CHECK_INTERVAL_MS = 30000;
const CONVERSATION_SESSION_MS = 60000;
const FOLLOW_UP_TIMEOUT_MS = 18000;
const FOLLOW_UP_RESTART_MS = 240;
const ALERT_SUPPRESSION_WHILE_LISTENING_MS = 12000;
const ALERT_SUPPRESSION_AFTER_LISTENING_MS = 1800;
const ALERT_SUPPRESSION_AFTER_SPEAKING_MS = 1400;
const GOOGLE_MAPS_LOAD_TIMEOUT_MS = 10000;
const ARRIVAL_DISTANCE_METERS = 18;
const ROUTE_REFRESH_INTERVAL_MS = 12000;
const ROUTE_REFRESH_MOVE_METERS = 18;
const OFF_ROUTE_THRESHOLD_METERS = 28;
const OFF_ROUTE_COOLDOWN_MS = 9000;
const MAX_WALKING_DESTINATION_METERS = 20000;
const DESTINATION_OPTION_LIMIT = 3;
const DESTINATION_OPTION_WINDOW_METERS = 2500;
const GOOGLE_TEXT_SEARCH_RADIUS_METERS = 30000;
const GOOGLE_TEXT_SEARCH_FALLBACK_RADIUS_METERS = 50000;
const ROUTE_SEARCH_RADIUS_METERS = 260;
const ROUTE_AMENITY_MAX_SAMPLES = 5;
const ROUTE_AMENITY_ROUTE_BUFFER_METERS = 160;
const ROUTE_AMENITY_CACHE_MS = 45000;
const MAX_ROUTE_STOPOVERS = 3;
const ROUTE_QUERY_ALIASES = [
  { key: "atm", label: "ATM", plural: "ATMs", type: "atm", keyword: "ATM", patterns: [/\batm\b/i, /\bcash machine\b/i] },
  { key: "bank", label: "bank", plural: "banks", type: "bank", keyword: "bank", patterns: [/\bbank\b/i] },
  { key: "food", label: "food place", plural: "food places", type: "restaurant", keyword: "restaurant cafe food", patterns: [/\b(food|eat|meal|snack|restaurant|food shop|dining)\b/i] },
  { key: "cafe", label: "cafe", plural: "cafes", type: "cafe", keyword: "cafe coffee", patterns: [/\b(cafe|coffee shop|coffee)\b/i] },
  { key: "pharmacy", label: "pharmacy", plural: "pharmacies", type: "pharmacy", keyword: "pharmacy medicine medical store", patterns: [/\b(pharmacy|medicine|medical store|chemist|drug store)\b/i] },
  { key: "hospital", label: "hospital", plural: "hospitals", type: "hospital", keyword: "hospital clinic emergency", patterns: [/\b(hospital|clinic|emergency)\b/i] },
  { key: "bus_stop", label: "bus stop", plural: "bus stops", type: "bus_station", keyword: "bus stop", patterns: [/\b(bus stop|bus station)\b/i] },
  { key: "train_station", label: "train station", plural: "train stations", type: "train_station", keyword: "railway station train station", patterns: [/\b(train station|railway station|rail station)\b/i] },
  { key: "metro", label: "metro station", plural: "metro stations", type: "subway_station", keyword: "metro station subway station", patterns: [/\b(metro|subway)\b/i] },
  { key: "gas_station", label: "petrol pump", plural: "petrol pumps", type: "gas_station", keyword: "petrol pump gas station fuel", patterns: [/\b(petrol pump|gas station|fuel station|petrol station)\b/i] },
  { key: "grocery", label: "grocery store", plural: "grocery stores", type: "supermarket", keyword: "supermarket grocery store", patterns: [/\b(grocery|supermarket|market|mart)\b/i] },
  { key: "mall", label: "shopping mall", plural: "shopping malls", type: "shopping_mall", keyword: "shopping mall", patterns: [/\b(mall|shopping mall)\b/i] },
  { key: "hotel", label: "hotel", plural: "hotels", type: "lodging", keyword: "hotel lodging", patterns: [/\b(hotel|lodge|lodging)\b/i] },
  { key: "police", label: "police station", plural: "police stations", type: "police", keyword: "police station", patterns: [/\b(police|police station)\b/i] },
  { key: "park", label: "park", plural: "parks", type: "park", keyword: "park garden", patterns: [/\b(park|garden)\b/i] },
  { key: "restroom", label: "restroom", plural: "restrooms", keyword: "public toilet restroom washroom bathroom", patterns: [/\b(restroom|washroom|toilet|bathroom)\b/i] },
];
const DESTINATION_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "another",
  "atm",
  "bank",
  "branch",
  "building",
  "by",
  "can",
  "closest",
  "final",
  "first",
  "for",
  "go",
  "guide",
  "i",
  "is",
  "last",
  "lead",
  "me",
  "middle",
  "near",
  "nearest",
  "need",
  "number",
  "of",
  "one",
  "option",
  "other",
  "place",
  "please",
  "restaurant",
  "route",
  "second",
  "take",
  "the",
  "third",
  "to",
  "want",
]);
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WAKE_PATTERNS = [
  /^\s*hey\s+(?:navi|navy)\b[\s,.!?:-]*/i,
  /^\s*hello\s+(?:navi|navy)\b[\s,.!?:-]*/i,
  /^\s*hi\s+(?:navi|navy)\b[\s,.!?:-]*/i,
  /^\s*ok(?:ay)?\s+(?:navi|navy)\b[\s,.!?:-]*/i,
  /^\s*(?:navi|navy)\b[\s,.!?:-]*/i,
];
const WAKE_ONLY_PATTERNS = [
  /^\s*hey\s+(?:navi|navy)\s*[.!?]*\s*$/i,
  /^\s*hello\s+(?:navi|navy)\s*[.!?]*\s*$/i,
  /^\s*hi\s+(?:navi|navy)\s*[.!?]*\s*$/i,
  /^\s*ok(?:ay)?\s+(?:navi|navy)\s*[.!?]*\s*$/i,
  /^\s*(?:navi|navy)\s*[.!?]*\s*$/i,
];
const chatUrl = body.dataset.companionChatUrl || "";

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
      const until = Date.now() + duration;
      if (until > state.holdAlertsUntil) {
        state.holdAlertsUntil = until;
        emitState();
      }
    },
    setCompanionListening(active, holdDurationMs = 0) {
      state.companionListening = Boolean(active);
      emitState();
      if (!active) {
        this.holdAlerts(holdDurationMs);
      }
    },
    setCompanionSpeaking(active, holdDurationMs = 0) {
      state.companionSpeaking = Boolean(active);
      emitState();
      if (!active) {
        this.holdAlerts(holdDurationMs);
      }
    },
    shouldHoldAlerts() {
      return (
        state.companionListening ||
        state.companionSpeaking ||
        Date.now() < state.holdAlertsUntil
      );
    },
  };
}

const assistiveVoiceChannel =
  window.AssistiveVoiceChannel || createAssistiveVoiceChannel();
window.AssistiveVoiceChannel = assistiveVoiceChannel;

const state = {
  recognition: null,
  mode: "idle",
  listening: false,
  speaking: false,
  commandPending: false,
  manualListeningPaused: false,
  wakeEnabled: localStorage.getItem(WAKE_ENABLED_STORAGE_KEY) !== "false",
  micPermission: "unknown",
  contacts: loadStoredJson(CONTACTS_STORAGE_KEY, {}),
  reminders: loadStoredJson(REMINDERS_STORAGE_KEY, []),
  reminderTimers: new Map(),
  musicWindow: null,
  weatherCache: null,
  globalRoute: loadGlobalRouteState(),
  conversationUntil: 0,
  followUpTimer: null,
  lastHeard: "",
  lastReply: "",
  preferredVoice: null,
  commandRunId: 0,
};

function loadStoredJson(key, fallbackValue) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallbackValue;
  } catch (_error) {
    return fallbackValue;
  }
}

function saveStoredJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadSessionJson(key, fallbackValue) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallbackValue;
  } catch (_error) {
    return fallbackValue;
  }
}

function saveSessionJson(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (_error) {
    // Ignore storage failures.
  }
}

function defaultGlobalRouteState() {
  return {
    currentPosition: null,
    destination: null,
    pendingDestination: null,
    pendingCandidates: [],
    pendingQuery: "",
    route: null,
    waypoints: [],
    arrived: false,
    status: "Idle",
    lastRouteRefreshAt: 0,
    lastOffRouteAt: 0,
    lastRouteSearch: null,
    placeDetailsCache: {},
    routeSearchCache: {},
    isFetchingRoute: false,
    locationWatchId: null,
    googleReadyPromise: null,
    placesService: null,
    directionsService: null,
    servicesHost: null,
  };
}

function loadGlobalRouteState() {
  const stored = loadSessionJson(GLOBAL_ROUTE_STORAGE_KEY, {});
  const base = defaultGlobalRouteState();
  const next = stored && typeof stored === "object" ? stored : {};
  return {
    ...base,
    ...next,
    pendingCandidates: Array.isArray(next.pendingCandidates) ? next.pendingCandidates : [],
    waypoints: Array.isArray(next.waypoints) ? next.waypoints : [],
    placeDetailsCache: next.placeDetailsCache && typeof next.placeDetailsCache === "object"
      ? next.placeDetailsCache
      : {},
    routeSearchCache: next.routeSearchCache && typeof next.routeSearchCache === "object"
      ? next.routeSearchCache
      : {},
    lastRouteSearch: next.lastRouteSearch && typeof next.lastRouteSearch === "object"
      ? next.lastRouteSearch
      : null,
  };
}

function saveGlobalRouteState() {
  const route = state.globalRoute || defaultGlobalRouteState();
  saveSessionJson(GLOBAL_ROUTE_STORAGE_KEY, {
    currentPosition: route.currentPosition || null,
    destination: route.destination || null,
    pendingDestination: route.pendingDestination || null,
    pendingCandidates: route.pendingCandidates || [],
    pendingQuery: route.pendingQuery || "",
    route: route.route || null,
    waypoints: route.waypoints || [],
    arrived: Boolean(route.arrived),
    status: route.status || "Idle",
    lastRouteRefreshAt: Number(route.lastRouteRefreshAt || 0),
    lastOffRouteAt: Number(route.lastOffRouteAt || 0),
    lastRouteSearch: route.lastRouteSearch || null,
    placeDetailsCache: route.placeDetailsCache || {},
    routeSearchCache: route.routeSearchCache || {},
  });
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function openPanel(show = true) {
  if (!elements.panel) {
    return;
  }
  elements.panel.classList.toggle("hidden", !show);
}

function setHeard(text) {
  const message = String(text || "").trim();
  state.lastHeard = message;
  if (elements.heard) {
    elements.heard.textContent =
      message || 'Say "Hey Navi", say "Navi", or press the round button to talk.';
  }
}

function setReplyText(text) {
  const message = String(text || "").trim();
  state.lastReply = message;
  if (elements.reply) {
    elements.reply.textContent = message || "I am ready.";
  }
}

function setWakeBadge(text, level = "neutral") {
  if (!elements.wakeBadge) {
    return;
  }
  elements.wakeBadge.textContent = text;
  elements.wakeBadge.className = `badge ${level}`;
}

function setListeningBadge(text, level = "neutral") {
  if (!elements.listeningBadge) {
    return;
  }
  elements.listeningBadge.textContent = text;
  elements.listeningBadge.className = `badge ${level}`;
}

function hasActiveConversation() {
  return Date.now() < state.conversationUntil;
}

function activateConversation(durationMs = CONVERSATION_SESSION_MS) {
  state.conversationUntil = Date.now() + Math.max(0, Number(durationMs) || 0);
  updateWakeState();
}

function clearConversation() {
  state.conversationUntil = 0;
  if (state.followUpTimer) {
    window.clearTimeout(state.followUpTimer);
    state.followUpTimer = null;
  }
  updateWakeState();
}

function updateWakeState() {
  if (!state.wakeEnabled) {
    setWakeBadge("Wake word off", "neutral");
    return;
  }
  if (state.manualListeningPaused && !state.listening && !state.speaking) {
    setWakeBadge("Listening paused", "neutral");
    return;
  }
  if (!state.recognition) {
    setWakeBadge("Wake unavailable", "high");
    return;
  }
  if (state.speaking) {
    setWakeBadge("Navi is speaking", "medium");
    return;
  }
  if (state.mode === "command" || state.mode === "followup" || state.listening) {
    setWakeBadge("Listening", "low");
    return;
  }
  if (state.commandPending) {
    setWakeBadge("Working", "medium");
    return;
  }
  if (state.micPermission === "denied") {
    setWakeBadge("Microphone blocked", "high");
    return;
  }
  if (state.micPermission === "prompt") {
    setWakeBadge("Click once to enable wake", "medium");
    return;
  }
  if (hasActiveConversation()) {
    setWakeBadge("Ready for follow-up", "low");
    return;
  }
  setWakeBadge("Wake word ready", "low");
}

function setMicButtonLabel() {
  if (!elements.mic) {
    return;
  }
  if (state.speaking) {
    elements.mic.textContent = "Interrupt & talk";
    return;
  }
  if (state.commandPending) {
    elements.mic.textContent = "Working...";
    return;
  }
  if (state.listening) {
    elements.mic.textContent = "Stop listening";
    return;
  }
  elements.mic.textContent = "Talk to Navi";
}

function chooseVoice() {
  if (!("speechSynthesis" in window)) {
    return null;
  }
  if (state.preferredVoice) {
    return state.preferredVoice;
  }
  const voices = window.speechSynthesis.getVoices();
  state.preferredVoice =
    voices.find((voice) => /en-IN/i.test(voice.lang)) ||
    voices.find((voice) => /en-GB/i.test(voice.lang)) ||
    voices.find((voice) => /en-US/i.test(voice.lang)) ||
    voices[0] ||
    null;
  return state.preferredVoice;
}

function cancelSpeech() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  state.speaking = false;
  assistiveVoiceChannel.setCompanionSpeaking(
    false,
    ALERT_SUPPRESSION_AFTER_SPEAKING_MS,
  );
  setMicButtonLabel();
  updateWakeState();
}

function speakReply(text, options = {}) {
  const message = String(text || "").trim();
  const afterSpeakListen = options.afterSpeakListen !== false;
  setReplyText(message);
  if (!message) {
    if (afterSpeakListen) {
      startFollowUpSoon();
    } else {
      startWakeSoon();
    }
    return;
  }

  if (!("speechSynthesis" in window)) {
    if (afterSpeakListen) {
      startFollowUpSoon();
    } else {
      startWakeSoon();
    }
    return;
  }

  cancelSpeech();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.voice = chooseVoice();
  utterance.rate = 0.98;
  utterance.pitch = 1.0;
  utterance.onstart = () => {
    state.speaking = true;
    setListeningBadge("Speaking", "medium");
    assistiveVoiceChannel.setCompanionSpeaking(true);
    setMicButtonLabel();
    updateWakeState();
  };
  utterance.onend = () => {
    state.speaking = false;
    assistiveVoiceChannel.setCompanionSpeaking(
      false,
      ALERT_SUPPRESSION_AFTER_SPEAKING_MS,
    );
    setMicButtonLabel();
    updateWakeState();
    if (afterSpeakListen && hasActiveConversation()) {
      startFollowUpSoon();
    } else {
      startWakeSoon();
    }
  };
  utterance.onerror = () => {
    state.speaking = false;
    assistiveVoiceChannel.setCompanionSpeaking(
      false,
      ALERT_SUPPRESSION_AFTER_SPEAKING_MS,
    );
    setMicButtonLabel();
    updateWakeState();
    if (afterSpeakListen && hasActiveConversation()) {
      startFollowUpSoon();
    } else {
      startWakeSoon();
    }
  };
  window.speechSynthesis.speak(utterance);
}

async function queryMicPermission() {
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

async function requestMicPermission() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    state.micPermission = "unsupported";
    updateWakeState();
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    state.micPermission = "granted";
    updateWakeState();
    return true;
  } catch (_error) {
    state.micPermission = "denied";
    updateWakeState();
    alert("Microphone access was denied. Please enable it in your browser settings to use voice commands.");
    return false;
  }
}

async function initializeMicPermission() {
  state.micPermission = await queryMicPermission();
  updateWakeState();
  if (state.micPermission === "granted") {
    startWakeSoon(0);
  }
}

function armWakeBootstrap() {
  const bootstrap = async () => {
    if (!state.wakeEnabled || state.micPermission === "granted") {
      startWakeSoon(0);
      return;
    }
    const granted = await requestMicPermission();
    if (granted) {
      startWakeSoon(0);
    }
  };
  ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
    window.addEventListener(eventName, bootstrap, { once: true, passive: true });
  });
}

function extractWakeCommand(transcript) {
  const raw = String(transcript || "").trim();
  for (const pattern of WAKE_PATTERNS) {
    if (pattern.test(raw)) {
      const remainder = raw.replace(pattern, "").replace(/^[,.\s]+/, "").trim();
      return { matched: true, remainder };
    }
  }
  return { matched: false, remainder: "" };
}

function isWakeOnly(transcript) {
  const raw = String(transcript || "").trim();
  return WAKE_ONLY_PATTERNS.some((pattern) => pattern.test(raw));
}

function stopRecognition() {
  if (!state.recognition) {
    state.mode = "idle";
    state.listening = false;
    updateWakeState();
    return;
  }
  try {
    state.recognition.stop();
  } catch (_error) {
    // Ignore repeated stop requests.
  }
  state.listening = false;
  state.mode = "idle";
  assistiveVoiceChannel.setCompanionListening(
    false,
    ALERT_SUPPRESSION_AFTER_LISTENING_MS,
  );
  setMicButtonLabel();
  updateWakeState();
}

function pauseListeningManually() {
  state.manualListeningPaused = true;
  clearConversation();
  if (state.followUpTimer) {
    window.clearTimeout(state.followUpTimer);
    state.followUpTimer = null;
  }
  stopRecognition();
  setListeningBadge("Listening paused", "neutral");
  updateWakeState();
}

function startWakeSoon(delayMs = 400) {
  if (!state.wakeEnabled || !state.recognition || state.manualListeningPaused) {
    return;
  }
  window.setTimeout(() => {
    if (
      !state.wakeEnabled ||
      state.manualListeningPaused ||
      !state.recognition ||
      state.speaking ||
      state.commandPending ||
      state.listening ||
      state.mode !== "idle" ||
      hasActiveConversation()
    ) {
      return;
    }
    startWakeListening();
  }, delayMs);
}

function startWakeListening() {
  if (!state.recognition || !state.wakeEnabled || state.manualListeningPaused) {
    return;
  }
  if (state.micPermission === "prompt" || state.micPermission === "unknown") {
    updateWakeState();
    return;
  }
  if (state.micPermission === "denied") {
    updateWakeState();
    return;
  }
  state.mode = "wake";
  state.recognition.continuous = true;
  state.recognition.interimResults = true;
  try {
    state.recognition.start();
  } catch (_error) {
    startWakeSoon(1000);
  }
}

function startCommandListening(mode = "command") {
  if (!state.recognition) {
    setReplyText("Speech recognition is not available in this browser.");
    return;
  }
  state.manualListeningPaused = false;
  openPanel(true);
  activateConversation();
  stopRecognition();
  cancelSpeech();
  state.mode = mode;
  state.recognition.continuous = false;
  state.recognition.interimResults = true;
  try {
    state.recognition.start();
  } catch (_error) {
    setReplyText("I could not start the microphone right now. Please try again.");
    startWakeSoon(800);
  }
}

function startFollowUpSoon() {
  if (state.followUpTimer) {
    window.clearTimeout(state.followUpTimer);
  }
  state.followUpTimer = window.setTimeout(() => {
    if (!hasActiveConversation() || state.speaking || state.commandPending) {
      return;
    }
    startCommandListening("followup");
    scheduleFollowUpStop();
  }, FOLLOW_UP_RESTART_MS);
}

function scheduleFollowUpStop() {
  if (state.followUpTimer) {
    window.clearTimeout(state.followUpTimer);
  }
  state.followUpTimer = window.setTimeout(() => {
    stopRecognition();
    clearConversation();
    startWakeSoon(0);
  }, FOLLOW_UP_TIMEOUT_MS);
}

function buildContextPayload() {
  const helper = window.AssistiveVisionPage || null;
  const assistant = helper && typeof helper.getAssistantContext === "function"
    ? (helper.getAssistantContext() || {})
    : {};
  const globalRouteStep = getGlobalPrimaryRouteStep();
  const globalRoute = state.globalRoute || {};
  return {
    page: (helper && helper.page) || body.dataset.page || "home",
    current_guidance:
      (helper && typeof helper.getCurrentGuidance === "function"
        ? helper.getCurrentGuidance()
        : "") || "",
    safety:
      (helper && typeof helper.getSafetyScene === "function"
        ? helper.getSafetyScene()
        : null) || {},
    context:
      (helper && typeof helper.getContextScene === "function"
        ? helper.getContextScene()
        : null) || {},
    assistant,
    route: {
      destination_label:
        assistant.destinationLabel ||
        (globalRoute.destination && (globalRoute.destination.optionLabel || globalRoute.destination.shortName)) ||
        "",
      next_instruction: assistant.nextInstruction || (globalRouteStep && globalRouteStep.instruction) || "",
      status: assistant.routeStatus || globalRoute.status || "",
    },
  };
}

function currentPageHelper() {
  return window.AssistiveVisionPage || null;
}

function pageLabelFor(page) {
  return {
    home: "the main dashboard",
    indoor: "indoor navigation",
    outdoor: "outdoor navigation",
    describe: "the describe page",
  }[page] || "the page";
}

function pageUrlFor(page) {
  return {
    home: body.dataset.homeUrl,
    indoor: body.dataset.indoorPageUrl,
    outdoor: body.dataset.outdoorUrl,
    describe: body.dataset.describeUrl,
  }[page] || body.dataset.homeUrl;
}

function queuePendingPageAction(action) {
  try {
    sessionStorage.setItem(PENDING_PAGE_ACTION_STORAGE_KEY, JSON.stringify(action));
  } catch (_error) {
    // Ignore storage failures.
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

function navigateToPage(page, reply) {
  const url = pageUrlFor(page);
  if (reply) {
    setReplyText(reply);
  }
  window.setTimeout(() => {
    window.location.href = url;
  }, 180);
}

function renderContacts() {
  const entries = Object.entries(state.contacts).sort((left, right) =>
    left[0].localeCompare(right[0]),
  );
  if (!entries.length) {
    elements.contactList.innerHTML =
      '<p class="support-text">No saved contacts yet.</p>';
    return;
  }
  elements.contactList.innerHTML = "";
  entries.forEach(([name, number]) => {
    const card = document.createElement("article");
    card.className = "companion-list-item";
    card.innerHTML = `
      <div class="companion-list-copy">
        <strong>${name}</strong>
        <span>${number}</span>
      </div>
      <div class="companion-list-actions">
        <button class="button tertiary" type="button" data-call-contact="${name}">Call</button>
        <button class="button secondary" type="button" data-remove-contact="${name}">Remove</button>
      </div>
    `;
    elements.contactList.appendChild(card);
  });
}

function saveContacts() {
  saveStoredJson(CONTACTS_STORAGE_KEY, state.contacts);
  renderContacts();
}

function renderReminders() {
  const reminders = [...state.reminders].sort((left, right) => left.dueAt - right.dueAt);
  if (!reminders.length) {
    elements.reminderList.innerHTML =
      '<p class="support-text">No active reminders yet.</p>';
    return;
  }
  elements.reminderList.innerHTML = "";
  reminders.forEach((reminder) => {
    const card = document.createElement("article");
    card.className = "companion-list-item";
    const dueText =
      reminder.dueAt <= Date.now()
        ? "Due now"
        : new Date(reminder.dueAt).toLocaleString();
    card.innerHTML = `
      <div class="companion-list-copy">
        <strong>${reminder.text}</strong>
        <small>${dueText}</small>
      </div>
      <div class="companion-list-actions">
        <button class="button secondary" type="button" data-remove-reminder="${reminder.id}">Remove</button>
      </div>
    `;
    elements.reminderList.appendChild(card);
  });
}

function saveReminders() {
  saveStoredJson(REMINDERS_STORAGE_KEY, state.reminders);
  renderReminders();
}

function removeReminder(reminderId) {
  state.reminders = state.reminders.filter((item) => item.id !== reminderId);
  const timer = state.reminderTimers.get(reminderId);
  if (timer) {
    window.clearTimeout(timer);
    state.reminderTimers.delete(reminderId);
  }
  saveReminders();
}

function triggerReminder(reminder) {
  removeReminder(reminder.id);
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Navi Reminder", { body: reminder.text });
  }
  setHeard(reminder.text);
  speakReply(`Reminder: ${reminder.text}`, { afterSpeakListen: false });
}

function scheduleReminder(reminder) {
  const delay = Math.max(reminder.dueAt - Date.now(), 0);
  const existing = state.reminderTimers.get(reminder.id);
  if (existing) {
    window.clearTimeout(existing);
  }
  state.reminderTimers.set(
    reminder.id,
    window.setTimeout(() => triggerReminder(reminder), delay),
  );
}

function createReminder(text, delayMs) {
  requestNotificationPermission();
  const reminder = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    text: String(text || "").trim(),
    dueAt: Date.now() + Math.max(0, Number(delayMs) || 0),
  };
  if (!reminder.text) {
    return null;
  }
  state.reminders.push(reminder);
  saveReminders();
  scheduleReminder(reminder);
  return reminder;
}

function rescheduleReminders() {
  state.reminders.forEach((reminder) => {
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

function resolveContact(target) {
  const raw = String(target || "").trim();
  if (!raw) {
    return null;
  }
  if (/^\+?[\d\s-]{6,}$/.test(raw)) {
    return {
      label: raw,
      number: raw.replace(/[^\d+]/g, ""),
    };
  }
  const normalized = normalizeName(raw);
  const entry = Object.entries(state.contacts).find(
    ([name]) => normalizeName(name) === normalized,
  );
  if (!entry) {
    return null;
  }
  return { label: entry[0], number: entry[1] };
}

function openMusic(query) {
  const url = `https://music.youtube.com/search?q=${encodeURIComponent(
    query || "music",
  )}`;
  const popup = window.open(url, "_blank");
  if (popup) {
    state.musicWindow = popup;
    return true;
  }
  return false;
}

function siteLabel(site) {
  return {
    maps: "Google Maps",
    youtube: "YouTube",
    google: "Google",
    gmail: "Gmail",
    calendar: "Google Calendar",
    drive: "Google Drive",
    whatsapp: "WhatsApp Web",
  }[String(site || "").toLowerCase()] || "that site";
}

function buildSiteUrl(site, query) {
  const normalizedSite = String(site || "").trim().toLowerCase();
  const normalizedQuery = String(query || "").trim();
  if (normalizedSite === "maps") {
    return normalizedQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(normalizedQuery)}`
      : "https://www.google.com/maps";
  }
  if (normalizedSite === "youtube") {
    return normalizedQuery
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(normalizedQuery)}`
      : "https://www.youtube.com";
  }
  if (normalizedSite === "google") {
    return normalizedQuery
      ? `https://www.google.com/search?q=${encodeURIComponent(normalizedQuery)}`
      : "https://www.google.com";
  }
  if (normalizedSite === "gmail") {
    return "https://mail.google.com";
  }
  if (normalizedSite === "calendar") {
    return "https://calendar.google.com";
  }
  if (normalizedSite === "drive") {
    return "https://drive.google.com";
  }
  if (normalizedSite === "whatsapp") {
    return "https://web.whatsapp.com";
  }
  return "";
}

function openExternalSite(site, query) {
  const url = buildSiteUrl(site, query);
  if (!url) {
    return false;
  }
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (popup) {
    return true;
  }
  try {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  } catch (_error) {
    return false;
  }
}

function closeMusicWindow() {
  if (state.musicWindow && !state.musicWindow.closed) {
    state.musicWindow.close();
    state.musicWindow = null;
    return true;
  }
  return false;
}

async function getBatteryReply() {
  if (!navigator.getBattery) {
    return "Battery information is not available in this browser.";
  }
  const battery = await navigator.getBattery();
  const percent = Math.round((battery.level || 0) * 100);
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
  if (state.weatherCache && Date.now() - state.weatherCache.at < WEATHER_CACHE_MS) {
    return state.weatherCache.reply;
  }
  if (!navigator.geolocation) {
    return "Weather needs location support in this browser.";
  }
  const position = await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      },
    );
  });
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
  const reply = `It is about ${Math.round(
    current.temperature_2m ?? 0,
  )} degrees Celsius with ${weatherCodeLabel(
    current.weather_code,
  )} and wind around ${Math.round(current.wind_speed_10m ?? 0)} kilometers per hour.`;
  state.weatherCache = { at: Date.now(), reply };
  return reply;
}

function prettyLabel(value) {
  return String(value || "-")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function shortPlaceLabel(name) {
  return String(name || "").split(",")[0].trim() || String(name || "Unknown place");
}

function formatDistance(distanceMeters) {
  if (!Number.isFinite(Number(distanceMeters))) {
    return "unknown distance";
  }
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(distanceMeters)} m`;
}

function formatDuration(durationSeconds) {
  const minutes = Math.max(1, Math.round(Number(durationSeconds || 0) / 60));
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
  }
  return `${minutes} min`;
}

function haversineMeters(pointA, pointB) {
  if (!pointA || !pointB) {
    return Infinity;
  }
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadius = 6371000;
  const deltaLat = toRadians(pointB.lat - pointA.lat);
  const deltaLon = toRadians(pointB.lon - pointA.lon);
  const lat1 = toRadians(pointA.lat);
  const lat2 = toRadians(pointB.lat);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function toMeters(point, referenceLat) {
  const latFactor = 111320;
  const lonFactor = 111320 * Math.cos((referenceLat * Math.PI) / 180);
  return {
    x: point.lon * lonFactor,
    y: point.lat * latFactor,
  };
}

function pointToSegmentDistanceMeters(point, start, end) {
  const referenceLat = point.lat;
  const current = toMeters(point, referenceLat);
  const first = toMeters(start, referenceLat);
  const second = toMeters(end, referenceLat);
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(current.x - first.x, current.y - first.y);
  }
  const t = Math.max(
    0,
    Math.min(1, ((current.x - first.x) * dx + (current.y - first.y) * dy) / (dx * dx + dy * dy)),
  );
  const projectedX = first.x + t * dx;
  const projectedY = first.y + t * dy;
  return Math.hypot(current.x - projectedX, current.y - projectedY);
}

function distanceToRouteMeters(position, coordinates) {
  if (!position || !Array.isArray(coordinates) || coordinates.length < 2) {
    return Infinity;
  }
  let best = Infinity;
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = { lat: coordinates[index - 1][1], lon: coordinates[index - 1][0] };
    const end = { lat: coordinates[index][1], lon: coordinates[index][0] };
    const distance = pointToSegmentDistanceMeters(position, start, end);
    if (distance < best) {
      best = distance;
      if (best < 6) {
        break;
      }
    }
  }
  return best;
}

function normalizeDestinationText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRouteToken(value, fallback = "unknown") {
  const token = normalizeDestinationText(value).replace(/\s+/g, "_").replace(/^_+|_+$/g, "");
  return token || fallback;
}

function uniqueDestinationParts(values) {
  const seen = new Set();
  return (values || []).filter((value) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
      return false;
    }
    const key = normalizeDestinationText(trimmed);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function compactPlaceLabel(name, segments = 3) {
  return String(name || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, segments)
    .join(", ");
}

function splitAddressParts(text) {
  return String(text || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildAddressComponentMap(components = []) {
  return (components || []).reduce((index, component) => {
    (component.types || []).forEach((type) => {
      if (!index[type]) {
        index[type] = String(component.long_name || component.short_name || "").trim();
      }
    });
    return index;
  }, {});
}

function pickAddressField(componentMap, fields) {
  for (const field of fields) {
    const value = componentMap && componentMap[field];
    if (value) {
      return String(value).trim();
    }
  }
  return "";
}

function getGoogleLatLngValue(location, axis) {
  if (!location) {
    return 0;
  }
  const accessor = location[axis];
  if (typeof accessor === "function") {
    return Number(accessor.call(location));
  }
  return Number(accessor || 0);
}

function buildCandidateDetails(result) {
  const componentMap = buildAddressComponentMap(result.address_components || []);
  const formattedAddress = String(result.formatted_address || result.vicinity || "").trim();
  const addressParts = splitAddressParts(formattedAddress);
  const shortName = String(result.name || shortPlaceLabel(formattedAddress) || "Unknown place").trim();
  const localityLabel = pickAddressField(componentMap, [
    "sublocality_level_1",
    "sublocality",
    "neighborhood",
    "locality",
    "postal_town",
    "administrative_area_level_2",
  ]) || addressParts[1] || addressParts[0] || "";
  const municipalityLabel = pickAddressField(componentMap, [
    "locality",
    "postal_town",
    "administrative_area_level_2",
    "administrative_area_level_3",
  ]) || addressParts[2] || addressParts[1] || "";
  const stateLabel = pickAddressField(componentMap, [
    "administrative_area_level_1",
    "administrative_area_level_2",
  ]) || addressParts[addressParts.length - 2] || "";
  const roadLabel = pickAddressField(componentMap, [
    "route",
    "premise",
    "sublocality_level_1",
    "sublocality",
    "neighborhood",
  ]) || String(result.vicinity || "").trim();
  const landmarkLabel = roadLabel && normalizeDestinationText(roadLabel) !== normalizeDestinationText(localityLabel)
    ? roadLabel
    : "";
  const optionParts = uniqueDestinationParts([shortName, localityLabel]);
  const fallbackLabel = compactPlaceLabel([shortName, formattedAddress].filter(Boolean).join(", "), 3);
  const optionLabel = optionParts.length > 1 ? optionParts.join(", ") : fallbackLabel;
  const detailParts = uniqueDestinationParts([
    municipalityLabel && normalizeDestinationText(municipalityLabel) !== normalizeDestinationText(localityLabel)
      ? municipalityLabel
      : "",
    stateLabel,
  ]);
  return {
    name: formattedAddress || shortName,
    shortName,
    optionLabel,
    localityLabel,
    municipalityLabel,
    stateLabel,
    landmarkLabel,
    detailLabel: detailParts.join(", "),
    searchText: uniqueDestinationParts([
      shortName,
      formattedAddress,
      optionLabel,
      localityLabel,
      municipalityLabel,
      stateLabel,
      landmarkLabel,
      (result.types || []).join(" "),
    ]).join(" "),
    formattedAddress,
    businessStatus: result.business_status || result.businessStatus || "",
    rating: Number.isFinite(Number(result.rating)) ? Number(result.rating) : null,
    userRatingsTotal: Number.isFinite(Number(result.user_ratings_total ?? result.userRatingsTotal))
      ? Number(result.user_ratings_total ?? result.userRatingsTotal)
      : null,
    phoneNumber: String(result.formatted_phone_number || result.formattedPhoneNumber || "").trim(),
    website: String(result.website || result.websiteURI || "").trim(),
    googleUrl: String(result.url || result.googleMapsURI || "").trim(),
    utcOffsetMinutes: Number.isFinite(Number(result.utc_offset_minutes ?? result.utcOffsetMinutes))
      ? Number(result.utc_offset_minutes ?? result.utcOffsetMinutes)
      : null,
    openingHours: result.opening_hours || result.currentOpeningHours || result.regularOpeningHours || null,
    priceLevel: Number.isFinite(Number(result.price_level ?? result.priceLevel))
      ? Number(result.price_level ?? result.priceLevel)
      : null,
    editorialSummary: String(
      (result.editorial_summary && result.editorial_summary.overview) ||
      (result.editorialSummary && result.editorialSummary.overview) ||
      result.editorialSummary ||
      "",
    ).trim(),
    delivery: result.delivery ?? result.hasDelivery ?? null,
    dineIn: result.dine_in ?? result.dineIn ?? null,
    takeout: result.takeout ?? result.hasTakeout ?? null,
    reservable: result.reservable ?? null,
    servesBreakfast: result.serves_breakfast ?? result.servesBreakfast ?? null,
    servesBrunch: result.serves_brunch ?? result.servesBrunch ?? null,
    servesLunch: result.serves_lunch ?? result.servesLunch ?? null,
    servesDinner: result.serves_dinner ?? result.servesDinner ?? null,
    servesVegetarianFood: result.serves_vegetarian_food ?? result.servesVegetarianFood ?? null,
    servesBeer: result.serves_beer ?? result.servesBeer ?? null,
    servesWine: result.serves_wine ?? result.servesWine ?? null,
    servesCoffee: result.serves_coffee ?? result.servesCoffee ?? null,
    servesDessert: result.serves_dessert ?? result.servesDessert ?? null,
    types: Array.isArray(result.types) ? result.types : [],
    lat: getGoogleLatLngValue(result.geometry && result.geometry.location, "lat"),
    lon: getGoogleLatLngValue(result.geometry && result.geometry.location, "lng"),
    placeId: result.place_id || "",
  };
}

function enrichDestinationCandidates(candidates) {
  const origin = state.globalRoute.currentPosition;
  return (candidates || []).map((candidate) => ({
    ...candidate,
    distanceMeters: origin ? haversineMeters(origin, candidate) : null,
  }));
}

function tokenizeDestinationText(text) {
  return normalizeDestinationText(text)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !DESTINATION_STOP_WORDS.has(token));
}

function scoreCandidateAgainstQuery(query, candidate) {
  const tokens = tokenizeDestinationText(query);
  if (!tokens.length) {
    return 0;
  }
  const brandText = normalizeDestinationText(`${candidate.shortName || ""} ${candidate.optionLabel || ""}`);
  const localityText = normalizeDestinationText([
    candidate.localityLabel,
    candidate.municipalityLabel,
    candidate.stateLabel,
    candidate.landmarkLabel,
    candidate.detailLabel,
  ].join(" "));
  const searchText = normalizeDestinationText(candidate.searchText || `${candidate.name || ""} ${candidate.optionLabel || ""}`);
  let score = 0;
  tokens.forEach((token) => {
    if (localityText.includes(token)) {
      score += token.length >= 6 ? 8 : 5;
      return;
    }
    if (brandText.includes(token)) {
      score += token.length >= 6 ? 5 : 3;
      return;
    }
    if (searchText.includes(token)) {
      score += 1;
    }
  });
  if (tokens.length > 1 && tokens.every((token) => searchText.includes(token))) {
    score += 4;
  }
  return score;
}

function rankDestinationCandidates(candidates, query) {
  return enrichDestinationCandidates(candidates)
    .map((candidate) => ({
      ...candidate,
      queryScore: scoreCandidateAgainstQuery(query, candidate),
    }))
    .sort((left, right) => {
      if (right.queryScore !== left.queryScore) {
        return right.queryScore - left.queryScore;
      }
      if (left.distanceMeters === null && right.distanceMeters === null) {
        return 0;
      }
      if (left.distanceMeters === null) {
        return 1;
      }
      if (right.distanceMeters === null) {
        return -1;
      }
      return left.distanceMeters - right.distanceMeters;
    });
}

function buildChoiceMeta(candidate, separator = " - ") {
  const parts = [];
  if (candidate.distanceMeters !== null && candidate.distanceMeters !== undefined) {
    parts.push(`About ${formatDistance(candidate.distanceMeters)} away`);
  }
  if (candidate.landmarkLabel) {
    parts.push(`Near ${candidate.landmarkLabel}`);
  }
  if (candidate.detailLabel) {
    parts.push(candidate.detailLabel);
  }
  return parts.join(separator);
}

function buildChoicePrompt(query, candidates) {
  const intro = `I found ${candidates.length} nearby matches for ${query}.`;
  const options = candidates
    .map((candidate, index) => {
      const meta = buildChoiceMeta(candidate, ", ");
      return `Option ${index + 1}, ${candidate.optionLabel}${meta ? `, ${meta}` : ""}.`;
    })
    .join(" ");
  return `${intro} ${options} Say option 1, option 2, or option 3, or say the locality name you want.`.trim();
}

function parseChoiceIndex(text, totalChoices = DESTINATION_OPTION_LIMIT) {
  const lowered = String(text || "").toLowerCase();
  if (/\b(nearest|closest|first|option 1|option one|number 1)\b/.test(lowered)) {
    return 0;
  }
  if (/\b(second|option 2|option two|number 2)\b/.test(lowered)) {
    return 1;
  }
  if (/\b(third|option 3|option three|number 3)\b/.test(lowered)) {
    return 2;
  }
  if (/\b(last|final)\b/.test(lowered)) {
    return Math.max(0, totalChoices - 1);
  }
  if (/\b(middle)\b/.test(lowered) && totalChoices >= 3) {
    return 1;
  }
  if (/\b(other|another)\b/.test(lowered) && totalChoices === 2) {
    return 1;
  }
  return -1;
}

function findCandidateByPhrase(text, candidates) {
  const spokenText = normalizeDestinationText(text);
  const tokens = tokenizeDestinationText(text);
  if (!spokenText) {
    return -1;
  }
  let bestIndex = -1;
  let bestScore = 0;
  let tied = false;
  (candidates || []).forEach((candidate, index) => {
    const candidateText = normalizeDestinationText(candidate.searchText || `${candidate.optionLabel || ""} ${candidate.name || ""}`);
    let score = 0;
    tokens.forEach((token) => {
      if (candidateText.includes(token)) {
        score += token.length >= 6 ? 5 : 3;
      }
    });
    if (spokenText.includes("other") || spokenText.includes("another")) {
      score += index === 1 && candidates.length === 2 ? 4 : 0;
    }
    if (spokenText.includes("middle")) {
      score += index === 1 && candidates.length >= 3 ? 4 : 0;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
      tied = false;
    } else if (score > 0 && score === bestScore) {
      tied = true;
    }
  });
  return tied ? -1 : bestIndex;
}

function looksLikeDestinationRequest(text) {
  return /\b(take me|guide me|navigate|route me|go to|lead me|i want to go|i need to go|can you take me|can you guide me|please take me|please guide me|reach)\b/i.test(text);
}

function looksLikeBareDestination(text) {
  const lowered = String(text || "").trim().toLowerCase();
  if (!lowered || lowered.split(/\s+/).length > 7) {
    return false;
  }
  if (/\b(what|what's|when|why|how|who|which|tell me|can you|could you|would you|will you|do|does|is|are|help)\b/.test(lowered)) {
    return false;
  }
  if (/\b(nearest|nearby|closest)\b/.test(lowered)) {
    return true;
  }
  return /\b(bank|atm|hospital|pharmacy|clinic|restaurant|cafe|mall|market|shop|store|supermarket|mart|station|stop|airport|hotel|park|college|school|office|temple|church|mosque|salon|gym|kfc|dominos|pizza|bus|railway|road|street|avenue)\b/.test(lowered);
}

function isYes(text) {
  return /\b(yes|yeah|yep|correct|confirm|go ahead|start|do it|that one)\b/i.test(text);
}

function isNo(text) {
  return /\b(no|nope|wrong|cancel|not that|try again|different place)\b/i.test(text);
}

function detectPlaceInfoTopic(text) {
  const lowered = String(text || "").toLowerCase();
  if (/\b(open|closed|close now|open now|opening time|closing time|hours|timing|timings|when does .* close|when does .* open|is .* open|is it open|is this place open)\b/.test(lowered)) {
    return "hours";
  }
  if (/\b(address|full address|where exactly|where is|location of|which area|which locality|what locality)\b/.test(lowered)) {
    return "address";
  }
  if (/\b(phone|contact|contact number|phone number|call number|mobile number)\b/.test(lowered)) {
    return "phone";
  }
  if (/\b(website|site|web site|webpage|link)\b/.test(lowered)) {
    return "website";
  }
  if (/\b(rating|review|reviews|stars|google rating|is it good)\b/.test(lowered)) {
    return "rating";
  }
  if (/\b(budget|price range|price|cost|expensive|cheap|affordable|how costly|how expensive)\b/.test(lowered)) {
    return "budget";
  }
  if (/\b(food|cuisine|menu|what do they serve|what food|what kind of restaurant|what kind of place|veg|vegetarian|breakfast|lunch|dinner|dessert|coffee|takeout|delivery|dine in)\b/.test(lowered)) {
    return "food";
  }
  if (/\b(where are you taking me|what destination|which destination|what place is this|tell me about the place|tell me about this place|tell me about the destination|what is this place)\b/.test(lowered)) {
    return "summary";
  }
  return "";
}

function hasGoogleMapsLoaded() {
  return Boolean(window.google && window.google.maps && window.google.maps.places);
}

function waitForGoogleMaps() {
  const googleMapsKey = body.dataset.googleMapsKey || "";
  if (!googleMapsKey) {
    return Promise.reject(new Error("Google Maps API key is missing."));
  }
  if (hasGoogleMapsLoaded()) {
    return Promise.resolve(window.google.maps);
  }
  if (state.globalRoute.googleReadyPromise) {
    return state.globalRoute.googleReadyPromise;
  }
  state.globalRoute.googleReadyPromise = new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    let script = document.querySelector("script[data-navi-google-maps='true']");
    if (!script) {
      script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(body.dataset.googleMapsKey || "")}&libraries=places&v=weekly&loading=async`;
      script.async = true;
      script.defer = true;
      script.dataset.naviGoogleMaps = "true";
      document.head.appendChild(script);
    }
    const fail = (message) => {
      if (settled) {
        return;
      }
      settled = true;
      state.globalRoute.googleReadyPromise = null;
      reject(new Error(message));
    };
    const timer = window.setInterval(() => {
      if (hasGoogleMapsLoaded()) {
        if (!settled) {
          settled = true;
          window.clearInterval(timer);
          resolve(window.google.maps);
        }
        return;
      }
      if (Date.now() - startedAt >= GOOGLE_MAPS_LOAD_TIMEOUT_MS) {
        window.clearInterval(timer);
        fail("Google Maps did not load. Check the API key and enabled APIs.");
      }
    }, 120);
    script.addEventListener("error", () => {
      window.clearInterval(timer);
      fail("Google Maps script failed to load.");
    }, { once: true });
  });
  return state.globalRoute.googleReadyPromise;
}

async function ensureGlobalRouteServices() {
  await waitForGoogleMaps();
  if (!state.globalRoute.servicesHost) {
    state.globalRoute.servicesHost = document.createElement("div");
  }
  if (!state.globalRoute.placesService) {
    state.globalRoute.placesService = new window.google.maps.places.PlacesService(state.globalRoute.servicesHost);
  }
  if (!state.globalRoute.directionsService) {
    state.globalRoute.directionsService = new window.google.maps.DirectionsService();
  }
  return state.globalRoute;
}

function describePlaceSearchFailure(status) {
  if (!window.google || !window.google.maps || !window.google.maps.places) {
    return "Google Maps is not ready yet.";
  }
  const statusMap = window.google.maps.places.PlacesServiceStatus;
  if (status === statusMap.REQUEST_DENIED) {
    return "Google denied the place search. Check that Maps JavaScript API and Places API are enabled for this API key.";
  }
  if (status === statusMap.OVER_QUERY_LIMIT) {
    return "Google Maps search hit the usage limit for this API key.";
  }
  if (status === statusMap.INVALID_REQUEST) {
    return "Google could not understand that destination search.";
  }
  return "Google place search failed: " + status + ".";
}

function requestTextSearch(service, request) {
  return new Promise((resolve, reject) => {
    service.textSearch(request, (results, status) => {
      const statusMap = window.google.maps.places.PlacesServiceStatus;
      if (status === statusMap.OK) {
        resolve(results || []);
        return;
      }
      if (status === statusMap.ZERO_RESULTS) {
        resolve([]);
        return;
      }
      reject(new Error(describePlaceSearchFailure(status)));
    });
  });
}

function requestNearbySearch(service, request) {
  return new Promise((resolve, reject) => {
    service.nearbySearch(request, (results, status) => {
      const statusMap = window.google.maps.places.PlacesServiceStatus;
      if (status === statusMap.OK) {
        resolve(results || []);
        return;
      }
      if (status === statusMap.ZERO_RESULTS) {
        resolve([]);
        return;
      }
      reject(new Error(describePlaceSearchFailure(status)));
    });
  });
}

function requestPlaceDetails(service, placeId) {
  return new Promise((resolve, reject) => {
    service.getDetails(
      {
        placeId,
        fields: [
          "name",
          "formatted_address",
          "geometry",
          "address_components",
          "vicinity",
          "place_id",
          "types",
          "business_status",
          "formatted_phone_number",
          "website",
          "url",
          "rating",
          "user_ratings_total",
          "utc_offset_minutes",
          "opening_hours",
          "price_level",
          "editorial_summary",
          "delivery",
          "dine_in",
          "takeout",
          "reservable",
          "serves_breakfast",
          "serves_brunch",
          "serves_lunch",
          "serves_dinner",
          "serves_vegetarian_food",
          "serves_beer",
          "serves_wine",
          "serves_coffee",
          "serves_dessert",
        ],
      },
      (result, status) => {
        const statusMap = window.google.maps.places.PlacesServiceStatus;
        if (status === statusMap.OK && result) {
          resolve(result);
          return;
        }
        if (status === statusMap.ZERO_RESULTS) {
          resolve(null);
          return;
        }
        reject(new Error(describePlaceSearchFailure(status)));
      },
    );
  });
}

function dedupePlaceResults(results) {
  const seen = new Map();
  (results || []).forEach((result) => {
    const location = result.geometry && result.geometry.location;
    const lat = getGoogleLatLngValue(location, "lat").toFixed(6);
    const lon = getGoogleLatLngValue(location, "lng").toFixed(6);
    const key = result.place_id || `${result.name || "place"}:${lat}:${lon}`;
    if (!seen.has(key)) {
      seen.set(key, result);
    }
  });
  return Array.from(seen.values());
}

async function hydratePlaceResults(service, results) {
  const rawResults = dedupePlaceResults(results);
  const limit = Math.min(rawResults.length, Math.max(DESTINATION_OPTION_LIMIT + 2, 5));
  const detailedResults = await Promise.all(
    rawResults.slice(0, limit).map(async (result) => {
      if (!result.place_id) {
        return result;
      }
      try {
        return (await requestPlaceDetails(service, result.place_id)) || result;
      } catch (_error) {
        return result;
      }
    }),
  );
  return dedupePlaceResults([...detailedResults, ...rawResults.slice(limit)]);
}

async function geocodeGlobalDestination(query, origin = null, nearestRequested = false) {
  const navigation = await ensureGlobalRouteServices();
  const service = navigation.placesService;
  const originLatLng = origin ? new window.google.maps.LatLng(origin.lat, origin.lon) : null;
  let results = [];
  if (nearestRequested && originLatLng) {
    results = await requestNearbySearch(service, {
      location: originLatLng,
      rankBy: window.google.maps.places.RankBy.DISTANCE,
      keyword: query,
    });
  } else {
    results = await requestTextSearch(
      service,
      originLatLng
        ? {
            query,
            location: originLatLng,
            radius: GOOGLE_TEXT_SEARCH_RADIUS_METERS,
          }
        : { query },
    );
    if (!results.length && originLatLng) {
      results = await requestTextSearch(service, {
        query,
        location: originLatLng,
        radius: GOOGLE_TEXT_SEARCH_FALLBACK_RADIUS_METERS,
      });
    }
    if (originLatLng) {
      try {
        const nearbyResults = await requestNearbySearch(service, {
          location: originLatLng,
          rankBy: window.google.maps.places.RankBy.DISTANCE,
          keyword: query,
        });
        results = dedupePlaceResults([...(results || []), ...nearbyResults]);
      } catch (error) {
        if (!results.length) {
          throw error;
        }
      }
    }
  }
  const hydratedResults = await hydratePlaceResults(service, results);
  return hydratedResults
    .map((result) => buildCandidateDetails(result))
    .filter((candidate) => Number.isFinite(candidate.lat) && Number.isFinite(candidate.lon));
}

function hasRichPlaceDetails(candidate) {
  return Boolean(
    candidate &&
    (
      candidate.openingHours ||
      candidate.businessStatus ||
      candidate.phoneNumber ||
      candidate.website ||
      candidate.googleUrl ||
      candidate.rating !== null ||
      candidate.userRatingsTotal !== null
    )
  );
}

function syncGlobalRouteCandidate(candidate) {
  if (!candidate || !candidate.placeId) {
    return candidate;
  }
  const navigation = state.globalRoute;
  const merge = (current) => {
    if (!current || current.placeId !== candidate.placeId) {
      return current;
    }
    return { ...current, ...candidate };
  };
  navigation.destination = merge(navigation.destination);
  navigation.pendingDestination = merge(navigation.pendingDestination);
  navigation.pendingCandidates = (navigation.pendingCandidates || []).map((current) => merge(current));
  navigation.waypoints = (navigation.waypoints || []).map((current) => merge(current));
  if (navigation.lastRouteSearch && Array.isArray(navigation.lastRouteSearch.results)) {
    navigation.lastRouteSearch = {
      ...navigation.lastRouteSearch,
      results: navigation.lastRouteSearch.results.map((current) => merge(current)),
    };
  }
  navigation.placeDetailsCache[candidate.placeId] = {
    ...(navigation.placeDetailsCache[candidate.placeId] || {}),
    ...candidate,
  };
  saveGlobalRouteState();
  return candidate;
}

async function ensureGlobalRouteCandidateDetails(candidate) {
  if (!candidate) {
    return null;
  }
  if (!candidate.placeId) {
    return candidate;
  }
  const cached = state.globalRoute.placeDetailsCache[candidate.placeId];
  if (cached) {
    return syncGlobalRouteCandidate({
      ...candidate,
      ...cached,
      distanceMeters: candidate.distanceMeters ?? cached.distanceMeters ?? null,
    });
  }
  if (hasRichPlaceDetails(candidate)) {
    return syncGlobalRouteCandidate(candidate);
  }
  try {
    const navigation = await ensureGlobalRouteServices();
    const detail = await requestPlaceDetails(navigation.placesService, candidate.placeId);
    if (!detail) {
      return candidate;
    }
    const merged = {
      ...candidate,
      ...buildCandidateDetails(detail),
      distanceMeters: candidate.distanceMeters ?? null,
    };
    return syncGlobalRouteCandidate(merged);
  } catch (_error) {
    return candidate;
  }
}

function sanitizeHoursLine(line) {
  return String(line || "").replace(/[.]+$/g, "").trim();
}

function getPlaceDayName(candidate) {
  if (Number.isFinite(candidate && candidate.utcOffsetMinutes)) {
    const utcNow = Date.now() + new Date().getTimezoneOffset() * 60000;
    return DAY_NAMES[new Date(utcNow + candidate.utcOffsetMinutes * 60000).getDay()];
  }
  return DAY_NAMES[new Date().getDay()];
}

function getTodayHoursLine(candidate) {
  const lines = candidate && candidate.openingHours && Array.isArray(candidate.openingHours.weekday_text)
    ? candidate.openingHours.weekday_text
    : [];
  if (!lines.length) {
    return "";
  }
  const dayName = getPlaceDayName(candidate).toLowerCase();
  const match = lines.find((line) => String(line || "").toLowerCase().startsWith(dayName));
  return sanitizeHoursLine(match || lines[0]);
}

function getPlaceOpenNow(candidate) {
  const openingHours = candidate && candidate.openingHours;
  if (!openingHours) {
    return null;
  }
  if (typeof openingHours.isOpen === "function") {
    const value = openingHours.isOpen();
    if (value === true || value === false) {
      return value;
    }
  }
  if (openingHours.open_now === true || openingHours.open_now === false) {
    return Boolean(openingHours.open_now);
  }
  return null;
}

function formatWebsiteLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch (_error) {
    return String(url || "").trim();
  }
}

function formatPlaceTypeLabel(candidate) {
  const ignoredTypes = new Set(["point_of_interest", "establishment", "food", "store", "premise", "political"]);
  const preferredOrder = ["bank", "atm", "hospital", "pharmacy", "restaurant", "cafe", "shopping_mall", "bus_station", "train_station", "subway_station", "lodging", "school", "university", "park"];
  const types = Array.isArray(candidate && candidate.types)
    ? candidate.types.filter((type) => !ignoredTypes.has(type))
    : [];
  const preferred = preferredOrder.find((type) => types.includes(type)) || types[0];
  return preferred ? prettyLabel(preferred).toLowerCase() : "place";
}

function joinNaturalList(values) {
  const items = (values || []).filter(Boolean);
  if (!items.length) {
    return "";
  }
  if (items.length === 1) {
    return items[0];
  }
  if (items.length === 2) {
    return items[0] + " and " + items[1];
  }
  return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
}

function getBudgetLabel(candidate) {
  const level = Number(candidate && candidate.priceLevel);
  if (!Number.isFinite(level)) {
    return "";
  }
  const labels = {
    0: "very affordable",
    1: "budget-friendly",
    2: "moderately priced",
    3: "a little expensive",
    4: "expensive",
  };
  return labels[level] || "moderately priced";
}

function getDiningFeatures(candidate) {
  const features = [];
  if (candidate && candidate.servesBreakfast === true) {
    features.push("breakfast");
  }
  if (candidate && candidate.servesBrunch === true) {
    features.push("brunch");
  }
  if (candidate && candidate.servesLunch === true) {
    features.push("lunch");
  }
  if (candidate && candidate.servesDinner === true) {
    features.push("dinner");
  }
  if (candidate && candidate.servesVegetarianFood === true) {
    features.push("vegetarian food");
  }
  if (candidate && candidate.servesCoffee === true) {
    features.push("coffee");
  }
  if (candidate && candidate.servesDessert === true) {
    features.push("dessert");
  }
  if (candidate && candidate.servesBeer === true) {
    features.push("beer");
  }
  if (candidate && candidate.servesWine === true) {
    features.push("wine");
  }
  return features;
}

function getDiningServiceModes(candidate) {
  const features = [];
  if (candidate && candidate.dineIn === true) {
    features.push("dine-in");
  }
  if (candidate && candidate.takeout === true) {
    features.push("takeout");
  }
  if (candidate && candidate.delivery === true) {
    features.push("delivery");
  }
  if (candidate && candidate.reservable === true) {
    features.push("reservations");
  }
  return features;
}

function buildPlaceHoursReply(candidate) {
  const label = candidate.optionLabel || candidate.shortName || "this place";
  const businessStatus = String(candidate.businessStatus || "").toUpperCase();
  const todayHours = getTodayHoursLine(candidate);
  const openNow = getPlaceOpenNow(candidate);
  if (businessStatus === "CLOSED_PERMANENTLY") {
    return label + " is marked as permanently closed in Google Places.";
  }
  if (businessStatus === "CLOSED_TEMPORARILY") {
    return label + " is marked as temporarily closed right now in Google Places.";
  }
  if (openNow === true) {
    return todayHours
      ? label + " appears to be open now. Today's hours: " + todayHours + "."
      : label + " appears to be open now.";
  }
  if (openNow === false) {
    return todayHours
      ? label + " appears to be closed right now. Today's hours: " + todayHours + "."
      : label + " appears to be closed right now.";
  }
  if (todayHours) {
    return "I found today's hours for " + label + ": " + todayHours + ".";
  }
  return "I could not find reliable opening hours for " + label + " in Google Places.";
}

function buildPlaceAddressReply(candidate) {
  const label = candidate.optionLabel || candidate.shortName || "this place";
  const parts = [];
  if (candidate.formattedAddress) {
    parts.push(label + " is at " + candidate.formattedAddress + ".");
  } else if (candidate.localityLabel) {
    parts.push(label + " is around " + candidate.localityLabel + ".");
  } else {
    parts.push("I only have a partial location for " + label + ".");
  }
  if (candidate.distanceMeters !== null && candidate.distanceMeters !== undefined) {
    parts.push("It is about " + formatDistance(candidate.distanceMeters) + " away.");
  }
  if (candidate.landmarkLabel) {
    parts.push("A nearby landmark is " + candidate.landmarkLabel + ".");
  }
  return parts.join(" ");
}

function buildPlaceRatingReply(candidate) {
  const label = candidate.optionLabel || candidate.shortName || "this place";
  if (candidate.rating !== null && candidate.rating !== undefined) {
    const reviewText = candidate.userRatingsTotal
      ? " from " + candidate.userRatingsTotal + " Google review" + (candidate.userRatingsTotal === 1 ? "" : "s")
      : " on Google";
    return label + " is rated " + candidate.rating.toFixed(1) + " out of 5" + reviewText + ".";
  }
  return "I could not find a public Google rating for " + label + ".";
}

function buildPlacePhoneReply(candidate) {
  const label = candidate.optionLabel || candidate.shortName || "this place";
  if (candidate.phoneNumber) {
    return "The phone number for " + label + " is " + candidate.phoneNumber + ".";
  }
  return "I could not find a public phone number for " + label + ".";
}

function buildPlaceWebsiteReply(candidate) {
  const label = candidate.optionLabel || candidate.shortName || "this place";
  if (candidate.website) {
    return label + " has a website listed as " + formatWebsiteLabel(candidate.website) + ".";
  }
  if (candidate.googleUrl) {
    return label + " does not show a dedicated website, but it does have a Google Maps listing.";
  }
  return "I could not find a public website for " + label + ".";
}

function buildPlaceBudgetReply(candidate) {
  const label = candidate.optionLabel || candidate.shortName || "this place";
  const budgetLabel = getBudgetLabel(candidate);
  if (!budgetLabel) {
    return "I could not find a reliable Google budget estimate for " + label + ".";
  }
  return label + " looks " + budgetLabel + " on Google Places.";
}

function buildPlaceFoodReply(candidate) {
  const label = candidate.optionLabel || candidate.shortName || "this place";
  const typeLabel = formatPlaceTypeLabel(candidate);
  const diningFeatures = getDiningFeatures(candidate);
  const serviceModes = getDiningServiceModes(candidate);
  const parts = [label + " looks like a " + typeLabel + "."];
  if (candidate.editorialSummary) {
    parts.push(candidate.editorialSummary.replace(/[.]+$/g, "") + ".");
  }
  if (diningFeatures.length) {
    parts.push("Google says it offers " + joinNaturalList(diningFeatures) + ".");
  }
  if (serviceModes.length) {
    parts.push("It supports " + joinNaturalList(serviceModes) + ".");
  }
  const budgetLabel = getBudgetLabel(candidate);
  if (budgetLabel) {
    parts.push("Budget looks " + budgetLabel + ".");
  }
  if (!diningFeatures.length && !serviceModes.length) {
    parts.push("I do not have a full menu list from Google Places, but I can still tell you its rating, budget, address, and whether it appears open.");
  }
  return parts.join(" ");
}

function buildPlaceSummaryReply(candidate) {
  const label = candidate.optionLabel || candidate.shortName || "this place";
  const typeLabel = formatPlaceTypeLabel(candidate);
  const parts = [label + " looks like a " + typeLabel + "."];
  if (candidate.editorialSummary) {
    parts.push(candidate.editorialSummary.replace(/[.]+$/g, "") + ".");
  }
  if (candidate.localityLabel) {
    parts.push("It is around " + candidate.localityLabel + ".");
  }
  if (candidate.distanceMeters !== null && candidate.distanceMeters !== undefined) {
    parts.push("It is about " + formatDistance(candidate.distanceMeters) + " away.");
  }
  const budgetLabel = getBudgetLabel(candidate);
  if (budgetLabel) {
    parts.push("Budget looks " + budgetLabel + ".");
  }
  if (candidate.rating !== null && candidate.rating !== undefined) {
    const count = candidate.userRatingsTotal ? " from " + candidate.userRatingsTotal + " reviews" : "";
    parts.push("Its Google rating is " + candidate.rating.toFixed(1) + " out of 5" + count + ".");
  }
  const todayHours = getTodayHoursLine(candidate);
  const openNow = getPlaceOpenNow(candidate);
  if (openNow === true) {
    parts.push("It appears to be open now" + (todayHours ? ", and today's hours are " + todayHours : "") + ".");
  } else if (openNow === false) {
    parts.push("It appears to be closed right now" + (todayHours ? ", and today's hours are " + todayHours : "") + ".");
  }
  return parts.join(" ");
}

function buildGlobalPlaceInfoReply(candidate, topic) {
  switch (topic) {
    case "hours":
      return buildPlaceHoursReply(candidate);
    case "address":
      return buildPlaceAddressReply(candidate);
    case "rating":
      return buildPlaceRatingReply(candidate);
    case "budget":
      return buildPlaceBudgetReply(candidate);
    case "food":
      return buildPlaceFoodReply(candidate);
    case "phone":
      return buildPlacePhoneReply(candidate);
    case "website":
      return buildPlaceWebsiteReply(candidate);
    default:
      return buildPlaceSummaryReply(candidate);
  }
}

function shouldOfferDestinationChoices(query, candidates, nearestRequested = false) {
  if (!candidates || candidates.length <= 1) {
    return false;
  }
  if (nearestRequested) {
    return true;
  }
  const bestScore = candidates[0].queryScore || 0;
  const secondScore = candidates[1] ? (candidates[1].queryScore || 0) : -1;
  if (bestScore >= 8 && bestScore >= secondScore + 4) {
    return false;
  }
  const nearestDistance = candidates[0].distanceMeters;
  const closeCandidates = nearestDistance === null
    ? candidates.length
    : candidates.filter((candidate) => candidate.distanceMeters !== null && candidate.distanceMeters - nearestDistance <= DESTINATION_OPTION_WINDOW_METERS).length;
  return closeCandidates > 1;
}

function normalizeDestinationQuery(rawInput) {
  let query = String(rawInput || "").trim().replace(/[?.!]+$/g, "");
  const phrases = [
    /^take me to\s+/i,
    /^guide me to\s+/i,
    /^navigate to\s+/i,
    /^go to\s+/i,
    /^route to\s+/i,
    /^lead me to\s+/i,
    /^i need to go to\s+/i,
    /^can you take me to\s+/i,
    /^can you guide me to\s+/i,
    /^please take me to\s+/i,
    /^please guide me to\s+/i,
    /^i want to go to\s+/i,
  ];
  phrases.forEach((pattern) => {
    query = query.replace(pattern, "");
  });
  query = query
    .replace(/\b(the\s+)?(nearest|nearby|closest)\b/gi, " ")
    .replace(/\bplace\b/gi, " ")
    .replace(/\bnear\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return query;
}

function stripHtmlInstruction(text) {
  const html = String(text || "").trim();
  if (!html) {
    return "";
  }
  const container = document.createElement("div");
  container.innerHTML = html.replace(/<div[^>]*>/gi, ". ").replace(/<\/div>/gi, " ");
  return container.textContent.replace(/\s+/g, " ").trim();
}

function buildStepInstruction(step) {
  const base = stripHtmlInstruction(step.instructions || step.html_instructions);
  const distanceValue = step.distance && step.distance.value !== undefined
    ? Number(step.distance.value)
    : Number(step.distance || 0);
  const sentence = base || "Continue ahead";
  if (distanceValue > 8 && !/\bfor\s+\d/i.test(sentence)) {
    return sentence.replace(/[.]+$/g, "") + " for " + formatDistance(distanceValue) + ".";
  }
  return /[.!?]$/.test(sentence) ? sentence : sentence + ".";
}

function parseRouteSteps(rawSteps) {
  return (rawSteps || [])
    .map((step) => {
      const distance = step.distance && step.distance.value !== undefined
        ? Number(step.distance.value)
        : Number(step.distance || 0);
      const duration = step.duration && step.duration.value !== undefined
        ? Number(step.duration.value)
        : Number(step.duration || 0);
      const startLocation = step.start_location || null;
      return {
        instruction: buildStepInstruction(step),
        distance,
        duration,
        type: step.travel_mode || "WALKING",
        location: startLocation
          ? {
              lat: getGoogleLatLngValue(startLocation, "lat"),
              lon: getGoogleLatLngValue(startLocation, "lng"),
            }
          : null,
      };
    })
    .filter((step) => step.instruction && (step.distance > 1 || /destination/i.test(step.instruction)));
}

function getGlobalPrimaryRouteStep() {
  const route = state.globalRoute.route;
  if (!route || !Array.isArray(route.steps) || !route.steps.length) {
    return null;
  }
  return route.steps[0];
}

function requestWalkingDirections(service, request) {
  return new Promise((resolve, reject) => {
    service.route(request, (result, status) => {
      if (status === window.google.maps.DirectionsStatus.OK || status === "OK") {
        resolve(result);
        return;
      }
      reject(new Error(String(status || "UNKNOWN_ERROR")));
    });
  });
}

function buildRouteGeometryFromDirections(route) {
  const overviewPath = route && route.overview_path ? route.overview_path : [];
  return {
    coordinates: overviewPath.map((point) => [
      getGoogleLatLngValue(point, "lng"),
      getGoogleLatLngValue(point, "lat"),
    ]),
  };
}

function buildGoogleRoute(directionsResult) {
  const route = directionsResult && directionsResult.routes && directionsResult.routes[0];
  const legs = route && Array.isArray(route.legs) ? route.legs : [];
  if (!route || !legs.length) {
    return null;
  }
  const steps = [];
  legs.forEach((leg, index) => {
    steps.push(...parseRouteSteps(leg.steps || []));
    if (index < legs.length - 1) {
      const stopLabel = shortPlaceLabel(leg.end_address || `stop ${index + 1}`);
      steps.push({
        instruction: `Reach stop ${index + 1}, ${stopLabel}. Continue from there toward the final destination.`,
        distance: 0,
        duration: 0,
        type: "WAYPOINT",
        location: leg.end_location
          ? {
              lat: getGoogleLatLngValue(leg.end_location, "lat"),
              lon: getGoogleLatLngValue(leg.end_location, "lng"),
            }
          : null,
      });
    }
  });
  return {
    distance: legs.reduce((total, leg) => total + (leg.distance ? Number(leg.distance.value || 0) : 0), 0),
    duration: legs.reduce((total, leg) => total + (leg.duration ? Number(leg.duration.value || 0) : 0), 0),
    geometry: buildRouteGeometryFromDirections(route),
    steps,
    warnings: route.warnings || [],
    directionsResult,
  };
}

function buildDirectionsErrorMessage(error) {
  const raw = String((error && error.message) || error || "").trim();
  if (/REQUEST_DENIED|not authorized|ApiNotActivatedMapError|DirectionsService/i.test(raw)) {
    return "Google could not build the walking route. Check that Maps JavaScript API and Directions API are enabled for this API key.";
  }
  if (/ZERO_RESULTS/i.test(raw)) {
    return "No walking route could be found for that destination.";
  }
  if (/OVER_QUERY_LIMIT/i.test(raw)) {
    return "Google Maps routing hit the usage limit for this API key.";
  }
  return raw || "Google could not build the walking route right now.";
}

function routeCoordinateToPoint(coordinate) {
  return { lat: Number(coordinate[1]), lon: Number(coordinate[0]) };
}

function getRouteStopLabel(stop) {
  return stop ? (stop.optionLabel || stop.shortName || shortPlaceLabel(stop.name) || "route stop") : "route stop";
}

function buildRouteStopsSentence() {
  const names = (state.globalRoute.waypoints || []).map((stop) => getRouteStopLabel(stop)).filter(Boolean);
  if (!names.length) {
    return "";
  }
  if (names.length === 1) {
    return `We will also stop at ${names[0]} before the final destination.`;
  }
  return `We will also stop at ${joinNaturalList(names)} before the final destination.`;
}

function describeGlobalRouteProgress(route) {
  if (!route) {
    return "There is no active route yet.";
  }
  const stopText = buildRouteStopsSentence();
  return `From here, it is about ${formatDistance(route.distance)} and around ${formatDuration(route.duration)} to go.${stopText ? ` ${stopText}` : ""}`;
}

function buildGlobalRoutePlanReply() {
  const navigation = state.globalRoute;
  if (!navigation.destination) {
    return "There is no active walking route yet.";
  }
  const destinationLabel = navigation.destination.optionLabel || navigation.destination.shortName;
  const parts = [`I am guiding you to ${destinationLabel}.`];
  if (navigation.route) {
    parts.push(describeGlobalRouteProgress(navigation.route));
  }
  const nextStep = getGlobalPrimaryRouteStep();
  if (nextStep) {
    parts.push(`Next, ${nextStep.instruction}`);
  }
  return parts.join(" ");
}

function describeGlobalLocationStatus() {
  const location = state.globalRoute.currentPosition;
  if (!location) {
    return "I do not have the current location yet. Please let me capture it first.";
  }
  const accuracyText = location.accuracy ? `with about ${Math.round(location.accuracy)} meters of accuracy` : "with the current GPS lock";
  return `I have the current location ${accuracyText}.`;
}

function describeGlobalSceneStatus() {
  const helper = currentPageHelper();
  const scene = helper && typeof helper.getContextScene === "function"
    ? (helper.getContextScene() || (typeof helper.getSafetyScene === "function" ? helper.getSafetyScene() : null))
    : null;
  if (!scene) {
    return "I am still waiting for the live scene feed.";
  }
  if (scene.path_clear) {
    return `${scene.scene_caption || ""} ${scene.spoken_message || ""}`.trim();
  }
  return `${scene.spoken_message || ""} ${scene.scene_caption || ""}`.trim();
}

function handleGlobalLocationSuccess(position) {
  const navigation = state.globalRoute;
  const previousPosition = navigation.currentPosition ? { ...navigation.currentPosition } : null;
  const coords = position.coords || position;
  navigation.currentPosition = {
    lat: Number(coords.latitude !== undefined ? coords.latitude : coords.lat),
    lon: Number(coords.longitude !== undefined ? coords.longitude : coords.lon),
    accuracy: Number(coords.accuracy || 0),
    timestamp: Date.now(),
  };
  saveGlobalRouteState();
  void maybeRefreshGlobalRoute(previousPosition);
}

function handleGlobalLocationError(error) {
  state.globalRoute.status = "Location error";
  saveGlobalRouteState();
  return error && error.message ? error.message : "Location access failed.";
}

function beginGlobalLocationWatch() {
  if (!("geolocation" in navigator) || state.globalRoute.locationWatchId !== null) {
    return;
  }
  state.globalRoute.locationWatchId = navigator.geolocation.watchPosition(
    handleGlobalLocationSuccess,
    handleGlobalLocationError,
    {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 10000,
    },
  );
}

function stopGlobalLocationWatch() {
  if ("geolocation" in navigator && state.globalRoute.locationWatchId !== null) {
    navigator.geolocation.clearWatch(state.globalRoute.locationWatchId);
  }
  state.globalRoute.locationWatchId = null;
}

function captureGlobalCurrentLocation(startWatch = true) {
  if (!("geolocation" in navigator)) {
    const error = new Error("Geolocation is not available in this browser.");
    handleGlobalLocationError(error);
    return Promise.reject(error);
  }
  state.globalRoute.status = "Locating";
  saveGlobalRouteState();
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        handleGlobalLocationSuccess(position);
        if (startWatch) {
          beginGlobalLocationWatch();
        }
        resolve(state.globalRoute.currentPosition);
      },
      (error) => {
        handleGlobalLocationError(error);
        reject(error);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      },
    );
  });
}

async function fetchGlobalRoute(reason = "manual_refresh") {
  const navigation = state.globalRoute;
  if (navigation.isFetchingRoute || !navigation.destination) {
    return navigation.destination ? "" : "There is no active walking route yet.";
  }
  const previousRoute = navigation.route
    ? { distance: navigation.route.distance, duration: navigation.route.duration }
    : null;
  navigation.isFetchingRoute = true;
  navigation.status = "Routing";
  saveGlobalRouteState();
  try {
    await ensureGlobalRouteServices();
    if (!navigation.currentPosition) {
      await captureGlobalCurrentLocation(true);
    }
    if (!navigation.currentPosition) {
      throw new Error("Current location is not available yet.");
    }
    const origin = navigation.currentPosition;
    const destination = navigation.destination;
    const directionsResult = await requestWalkingDirections(navigation.directionsService, {
      origin: { lat: origin.lat, lng: origin.lon },
      destination: { lat: destination.lat, lng: destination.lon },
      waypoints: (navigation.waypoints || []).map((stop) => ({
        location: { lat: stop.lat, lng: stop.lon },
        stopover: true,
      })),
      travelMode: window.google.maps.TravelMode.WALKING,
      provideRouteAlternatives: false,
      unitSystem: window.google.maps.UnitSystem.METRIC,
    });
    const route = buildGoogleRoute(directionsResult);
    if (!route) {
      throw new Error("No walking route could be found for that destination.");
    }
    navigation.route = route;
    navigation.arrived = false;
    navigation.routeSearchCache = {};
    navigation.lastRouteRefreshAt = Date.now();
    navigation.status = "Guiding";
    saveGlobalRouteState();
    const nextStep = getGlobalPrimaryRouteStep();
    if (reason === "new_destination") {
      return `All set. I am guiding you to ${navigation.destination.optionLabel || navigation.destination.shortName} on the shortest walking route. ${describeGlobalRouteProgress(route)} ${nextStep ? `First, ${nextStep.instruction}` : ""}`.trim();
    }
    if (reason === "off_route") {
      const extraDistance = previousRoute ? Math.max(0, route.distance - previousRoute.distance) : 0;
      return `I noticed we moved away from the path, so I changed the route. ${describeGlobalRouteProgress(route)}${extraDistance > 20 ? ` That adds about ${formatDistance(extraDistance)} more walking.` : ""} ${nextStep ? `Now, ${nextStep.instruction}` : ""}`.trim();
    }
    if (reason === "shortest_correction") {
      return `I corrected us back to the shortest walking route. ${describeGlobalRouteProgress(route)} ${nextStep ? `Next, ${nextStep.instruction}` : ""}`.trim();
    }
    if (reason === "manual_refresh") {
      return `I refreshed the route. ${describeGlobalRouteProgress(route)} ${nextStep ? `Next, ${nextStep.instruction}` : ""}`.trim();
    }
    if (reason === "stop_added") {
      const latestStop = navigation.waypoints.length
        ? getRouteStopLabel(navigation.waypoints[navigation.waypoints.length - 1])
        : "the extra stop";
      return `I added ${latestStop} to the walking route. ${describeGlobalRouteProgress(route)} ${nextStep ? `Next, ${nextStep.instruction}` : ""}`.trim();
    }
    if (reason === "stop_removed") {
      return `I updated the walking route after removing the extra stop. ${describeGlobalRouteProgress(route)} ${nextStep ? `Next, ${nextStep.instruction}` : ""}`.trim();
    }
    return describeGlobalRouteProgress(route);
  } catch (error) {
    navigation.status = "Route error";
    saveGlobalRouteState();
    return buildDirectionsErrorMessage(error);
  } finally {
    navigation.isFetchingRoute = false;
  }
}

function announceGlobalRouteUpdate(message) {
  if (!message) {
    return;
  }
  setReplyText(message);
  if (state.commandPending || state.listening || state.speaking) {
    return;
  }
  speakReply(message, { afterSpeakListen: false });
}

function markGlobalRouteArrived() {
  const navigation = state.globalRoute;
  if (!navigation.destination || navigation.arrived) {
    return;
  }
  navigation.arrived = true;
  navigation.status = "Arrived";
  saveGlobalRouteState();
  announceGlobalRouteUpdate(
    `You are near ${navigation.destination.optionLabel || navigation.destination.shortName}. Slow down and scan around you carefully.`,
  );
}

async function maybeHandleGlobalOffRoute() {
  const navigation = state.globalRoute;
  if (!navigation.route || !navigation.route.geometry || navigation.arrived || navigation.isFetchingRoute) {
    return;
  }
  const deviation = distanceToRouteMeters(navigation.currentPosition, navigation.route.geometry.coordinates);
  if (deviation <= OFF_ROUTE_THRESHOLD_METERS) {
    return;
  }
  const now = Date.now();
  if (now - navigation.lastOffRouteAt < OFF_ROUTE_COOLDOWN_MS) {
    return;
  }
  navigation.lastOffRouteAt = now;
  saveGlobalRouteState();
  const message = await fetchGlobalRoute("off_route");
  announceGlobalRouteUpdate(message);
}

async function maybeRefreshGlobalRoute(previousPosition) {
  const navigation = state.globalRoute;
  if (!navigation.destination || navigation.arrived || !navigation.currentPosition) {
    return;
  }
  const remainingDistance = haversineMeters(navigation.currentPosition, navigation.destination);
  if (remainingDistance <= ARRIVAL_DISTANCE_METERS) {
    markGlobalRouteArrived();
    return;
  }
  if (!navigation.route) {
    const message = await fetchGlobalRoute("new_destination");
    announceGlobalRouteUpdate(message);
    return;
  }
  await maybeHandleGlobalOffRoute();
  const movedDistance = previousPosition ? haversineMeters(previousPosition, navigation.currentPosition) : Infinity;
  const enoughTimePassed = Date.now() - navigation.lastRouteRefreshAt >= ROUTE_REFRESH_INTERVAL_MS;
  if (movedDistance >= ROUTE_REFRESH_MOVE_METERS && enoughTimePassed && !navigation.isFetchingRoute) {
    await fetchGlobalRoute("progress_refresh");
  }
}

function hasRouteContext(text) {
  return /\b(on my route|on the route|on my way|on the way|along the route|along the way|ahead on the route|ahead of me|near my route|near the route|before the destination|before we reach|while going|during the route)\b/i.test(text);
}

function wantsAddRouteStop(text) {
  return /\b(add|include|insert|make a stop|make it a stop|stop at|stop by|take me via|take me through|put .* on (my|the) route|via|through|detour)\b/i.test(text);
}

function normalizeRouteSearchQuery(text) {
  return String(text || "")
    .replace(/[?.!]+/g, " ")
    .replace(/\b(can you|could you|would you|please|tell me|let me know|i want|i need|show me|check|find|search for|look for|look up|locate|is there|are there|do we pass by|do we have|can i get|can we get)\b/gi, " ")
    .replace(/\b(add|include|insert|stop at|stop by|take me via|take me through|make a stop|make it a stop|put|route me via|guide me via)\b/gi, " ")
    .replace(/\b(on my route|on the route|on my way|on the way|along the route|along the way|ahead on the route|ahead of me|near my route|near the route|before the destination|before we reach|while going|during the route|to my route|into my route)\b/gi, " ")
    .replace(/\b(open now|open right now|available now|available)\b/gi, " ")
    .replace(/\b(the|a|an)\b/gi, " ")
    .replace(/\b(nearest|closest|nearby)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferRouteSearchConfig(query) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) {
    return null;
  }
  const alias = ROUTE_QUERY_ALIASES.find((entry) => (entry.patterns || []).some((pattern) => pattern.test(normalizedQuery)));
  if (alias) {
    return { ...alias };
  }
  const label = normalizedQuery.replace(/\s+/g, " ").trim();
  return {
    key: normalizeRouteToken(label, "route_place"),
    label,
    plural: "matching places",
    keyword: label,
  };
}

function parseRouteSearchIntent(text) {
  const transcript = String(text || "").trim();
  const lowered = transcript.toLowerCase();
  const routeContext = hasRouteContext(lowered);
  const wantsAdd = wantsAddRouteStop(lowered);
  if (!routeContext && !(state.globalRoute.route && wantsAdd)) {
    return null;
  }
  const query = normalizeRouteSearchQuery(transcript);
  const openNow = /\b(open now|open right now|available now)\b/i.test(transcript);
  const nearestRequested = /\b(nearest|closest|nearby)\b/i.test(transcript);
  if (!query) {
    return { type: "route_search_missing_query" };
  }
  const config = inferRouteSearchConfig(query);
  if (!config) {
    return { type: "route_search_missing_query" };
  }
  return {
    type: wantsAdd ? "route_add_search" : "route_place_search",
    query,
    config,
    openNow,
    nearestRequested,
  };
}

function getClosestRouteCoordinateIndex(position, coordinates) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  (coordinates || []).forEach((coordinate, index) => {
    const point = routeCoordinateToPoint(coordinate);
    const distance = haversineMeters(position, point);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function getRouteSamplePoints(route, currentPosition) {
  const coordinates = route && route.geometry && Array.isArray(route.geometry.coordinates)
    ? route.geometry.coordinates
    : [];
  if (!coordinates.length) {
    return currentPosition ? [currentPosition] : [];
  }
  const startIndex = currentPosition ? getClosestRouteCoordinateIndex(currentPosition, coordinates) : 0;
  const remaining = coordinates.slice(startIndex);
  const points = currentPosition ? [currentPosition] : [];
  const step = Math.max(1, Math.floor(remaining.length / Math.max(1, ROUTE_AMENITY_MAX_SAMPLES - points.length)));
  for (let index = 0; index < remaining.length && points.length < ROUTE_AMENITY_MAX_SAMPLES; index += step) {
    points.push(routeCoordinateToPoint(remaining[index]));
  }
  const lastPoint = routeCoordinateToPoint(remaining[remaining.length - 1]);
  points.push(lastPoint);
  const seen = new Set();
  return points
    .filter((point) => {
      const key = point.lat.toFixed(5) + ":" + point.lon.toFixed(5);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, ROUTE_AMENITY_MAX_SAMPLES);
}

function buildRouteAmenityCacheKey(intent) {
  const navigation = state.globalRoute;
  const routeDistance = navigation.route && navigation.route.distance ? Math.round(navigation.route.distance / 50) : 0;
  const destinationKey = navigation.destination && navigation.destination.placeId ? navigation.destination.placeId : "no-destination";
  const waypointKey = (navigation.waypoints || []).map((stop) => stop.placeId || `${stop.lat}:${stop.lon}`).join("|") || "direct";
  return [intent.config.key, intent.openNow ? "open" : "any", destinationKey, waypointKey, routeDistance].join(":");
}

async function searchGlobalRouteAmenities(intent) {
  const navigation = state.globalRoute;
  if (!navigation.route || !navigation.currentPosition) {
    return [];
  }
  const config = intent.config || inferRouteSearchConfig(intent.query);
  if (!config) {
    return [];
  }
  const cacheKey = buildRouteAmenityCacheKey({ ...intent, config });
  const cached = navigation.routeSearchCache[cacheKey];
  if (cached && Date.now() - cached.at < ROUTE_AMENITY_CACHE_MS) {
    return cached.results;
  }
  const services = await ensureGlobalRouteServices();
  const samplePoints = getRouteSamplePoints(navigation.route, navigation.currentPosition);
  const rawResults = (await Promise.all(
    samplePoints.map(async (point) => {
      try {
        return await requestNearbySearch(services.placesService, {
          location: new window.google.maps.LatLng(point.lat, point.lon),
          radius: ROUTE_SEARCH_RADIUS_METERS,
          type: config.type || undefined,
          keyword: config.keyword || intent.query,
          openNow: intent.openNow ? true : undefined,
        });
      } catch (_error) {
        return [];
      }
    }),
  )).flat();
  const routeCandidates = dedupePlaceResults(rawResults)
    .map((result) => buildCandidateDetails(result))
    .map((candidate) => ({
      ...candidate,
      currentDistanceMeters: haversineMeters(navigation.currentPosition, candidate),
      routeDeviationMeters: navigation.route && navigation.route.geometry
        ? distanceToRouteMeters(candidate, navigation.route.geometry.coordinates)
        : null,
    }))
    .filter((candidate) => candidate.routeDeviationMeters === null || candidate.routeDeviationMeters <= ROUTE_AMENITY_ROUTE_BUFFER_METERS)
    .sort((left, right) => {
      if ((left.currentDistanceMeters ?? Infinity) !== (right.currentDistanceMeters ?? Infinity)) {
        return (left.currentDistanceMeters ?? Infinity) - (right.currentDistanceMeters ?? Infinity);
      }
      if ((left.routeDeviationMeters ?? Infinity) !== (right.routeDeviationMeters ?? Infinity)) {
        return (left.routeDeviationMeters ?? Infinity) - (right.routeDeviationMeters ?? Infinity);
      }
      return (right.rating ?? 0) - (left.rating ?? 0);
    });
  const results = [];
  for (const candidate of routeCandidates.slice(0, DESTINATION_OPTION_LIMIT)) {
    results.push(await ensureGlobalRouteCandidateDetails(candidate));
  }
  navigation.routeSearchCache[cacheKey] = { at: Date.now(), results };
  saveGlobalRouteState();
  return results;
}

function describeGlobalRouteAmenityCandidate(candidate, config) {
  const parts = [candidate.optionLabel || candidate.shortName || config.label];
  if (candidate.currentDistanceMeters !== null && candidate.currentDistanceMeters !== undefined) {
    parts.push("about " + formatDistance(candidate.currentDistanceMeters) + " from you");
  }
  if (candidate.localityLabel) {
    parts.push("around " + candidate.localityLabel);
  }
  if (candidate.landmarkLabel) {
    parts.push("near " + candidate.landmarkLabel);
  }
  if (candidate.routeDeviationMeters !== null && candidate.routeDeviationMeters !== undefined && candidate.routeDeviationMeters > 35) {
    parts.push("roughly " + formatDistance(candidate.routeDeviationMeters) + " off the route");
  }
  const openNow = getPlaceOpenNow(candidate);
  if (openNow === true) {
    parts.push("open now");
  } else if (openNow === false) {
    parts.push("closed now");
  }
  if (candidate.rating !== null && candidate.rating !== undefined) {
    parts.push(candidate.rating.toFixed(1) + " stars");
  }
  return parts.join(", ");
}

function rememberGlobalRouteSearch(intent, results) {
  state.globalRoute.lastRouteSearch = {
    query: intent.query,
    config: intent.config,
    openNow: intent.openNow,
    pendingAction: intent.type === "route_add_search" ? "add" : "info",
    selectedIndex: results.length === 1 ? 0 : null,
    results: results || [],
    createdAt: Date.now(),
  };
  saveGlobalRouteState();
}

function buildGlobalRouteAmenityReply(intent, results) {
  const config = intent.config || inferRouteSearchConfig(intent.query);
  if (!config) {
    return "I could not understand which place you want on the route.";
  }
  if (!results.length) {
    const qualifier = intent.openNow ? " open right now" : "";
    return `I could not find any ${config.plural}${qualifier} along your current route.`;
  }
  const descriptions = results.slice(0, DESTINATION_OPTION_LIMIT).map((candidate, index) => `Option ${index + 1} is ${describeGlobalRouteAmenityCandidate(candidate, config)}.`);
  const hint = intent.type === "route_add_search"
    ? (results.length === 1
        ? "Say add it if you want me to include this stop on the route."
        : "Say add option 1, add option 2, add option 3, or say the locality name if you want me to include one as a stop.")
    : (results.length === 1
        ? "You can ask me if it is open, ask for the budget or address, or say add it to my route."
        : "You can ask about option 1, option 2, or say add option 1 to include it on the route.");
  return `I found ${results.length} ${config.plural} along your route. ${descriptions.join(" ")} ${hint}`.trim();
}

function buildGlobalRouteResultChoiceReply(mode, topic = "summary") {
  const examples = ((state.globalRoute.lastRouteSearch && state.globalRoute.lastRouteSearch.results) || [])
    .map((candidate) => candidate.localityLabel || candidate.optionLabel)
    .filter(Boolean)
    .slice(0, 2)
    .join(" or ");
  if (mode === "add") {
    return examples
      ? `I found a few route-side matches. Say add option 1, add option 2, or say the locality name like ${examples}.`
      : "I found a few route-side matches. Say add option 1, add option 2, or add option 3 so I know which stop to include.";
  }
  const topicLabel = {
    hours: "whether it is open",
    address: "the exact address",
    rating: "the Google rating",
    budget: "the budget",
    food: "what kind of place it is and what it offers",
    phone: "the phone number",
    website: "the website",
    summary: "more about that place",
  }[topic] || "more about that place";
  return examples
    ? `I found a few route-side matches. Say option 1, option 2, or say the locality name like ${examples}, and I will tell you ${topicLabel}.`
    : `I found a few route-side matches. Say option 1, option 2, or option 3, and I will tell you ${topicLabel}.`;
}

async function addGlobalRouteStopover(candidate) {
  const navigation = state.globalRoute;
  if (!navigation.destination) {
    return "Tell me the destination first, then I can add a stop on the route.";
  }
  const detailedCandidate = await ensureGlobalRouteCandidateDetails(candidate);
  if (!detailedCandidate || !Number.isFinite(detailedCandidate.lat) || !Number.isFinite(detailedCandidate.lon)) {
    return "I could not lock that stop onto the route yet. Please try another nearby option.";
  }
  const label = getRouteStopLabel(detailedCandidate);
  if (navigation.destination.placeId && detailedCandidate.placeId && navigation.destination.placeId === detailedCandidate.placeId) {
    return label + " is already the final destination.";
  }
  const existingIndex = (navigation.waypoints || []).findIndex((stop) => {
    if (!stop) {
      return false;
    }
    if (stop.placeId && detailedCandidate.placeId) {
      return stop.placeId === detailedCandidate.placeId;
    }
    return haversineMeters(stop, detailedCandidate) < 25;
  });
  if (existingIndex >= 0) {
    return label + ` is already on the route as stop ${existingIndex + 1}.`;
  }
  if ((navigation.waypoints || []).length >= MAX_ROUTE_STOPOVERS) {
    return `I can keep up to ${MAX_ROUTE_STOPOVERS} extra stops at a time. Remove one first if you want a new stop.`;
  }
  navigation.waypoints = [...(navigation.waypoints || []), detailedCandidate];
  navigation.arrived = false;
  navigation.lastOffRouteAt = 0;
  navigation.routeSearchCache = {};
  saveGlobalRouteState();
  return await fetchGlobalRoute("stop_added");
}

function clearGlobalRoute() {
  const currentPosition = state.globalRoute.currentPosition || null;
  stopGlobalLocationWatch();
  state.globalRoute = {
    ...defaultGlobalRouteState(),
    currentPosition,
  };
  saveGlobalRouteState();
  return "The route is cleared. Tell me the next place whenever you are ready.";
}

function detectGlobalRouteSearchFollowUp(text, placeInfoTopic) {
  const lastSearch = state.globalRoute.lastRouteSearch;
  if (!lastSearch || !Array.isArray(lastSearch.results) || !lastSearch.results.length) {
    return null;
  }
  const lowered = String(text || "").toLowerCase();
  const choiceIndex = parseChoiceIndex(text, lastSearch.results.length);
  const phraseIndex = findCandidateByPhrase(text, lastSearch.results);
  const resolvedIndex = choiceIndex >= 0 ? choiceIndex : phraseIndex;
  const mentionsReference = /\b(this one|that one|this place|that place|this stop|that stop|it|there|option|one near)\b/i.test(text);
  if (placeInfoTopic) {
    if (resolvedIndex >= 0) {
      return { type: "route_result_info", topic: placeInfoTopic, index: resolvedIndex };
    }
    if (Number.isInteger(lastSearch.selectedIndex) && mentionsReference) {
      return { type: "route_result_info", topic: placeInfoTopic, index: lastSearch.selectedIndex };
    }
    if (lastSearch.results.length === 1 && mentionsReference) {
      return { type: "route_result_info", topic: placeInfoTopic, index: 0 };
    }
    return { type: "route_result_choice_unclear", mode: "info", topic: placeInfoTopic };
  }
  if (/\b(add|include|insert|stop at|stop by|make a stop|via|through)\b/i.test(lowered)) {
    if (resolvedIndex >= 0) {
      return { type: "route_add_existing", index: resolvedIndex };
    }
    if (Number.isInteger(lastSearch.selectedIndex) && mentionsReference) {
      return { type: "route_add_existing", index: lastSearch.selectedIndex };
    }
    if (lastSearch.results.length === 1 && /\b(add it|include it|stop there|take me there)\b/i.test(lowered)) {
      return { type: "route_add_existing", index: 0 };
    }
    return { type: "route_result_choice_unclear", mode: "add" };
  }
  if (resolvedIndex >= 0) {
    if (lastSearch.pendingAction === "add") {
      return { type: "route_add_existing", index: resolvedIndex };
    }
    return { type: "route_result_info", topic: "summary", index: resolvedIndex };
  }
  return null;
}

function detectGlobalRouteIntent(text) {
  const transcript = String(text || "").trim();
  const lowered = transcript.toLowerCase();
  const navigation = state.globalRoute;
  if (!transcript) {
    return null;
  }
  const routeSearchIntent = parseRouteSearchIntent(transcript);
  const placeInfoTopic = detectPlaceInfoTopic(transcript);
  const routeSearchFollowUp = detectGlobalRouteSearchFollowUp(transcript, placeInfoTopic);
  if (navigation.pendingCandidates && navigation.pendingCandidates.length) {
    const choiceIndex = parseChoiceIndex(transcript, navigation.pendingCandidates.length);
    const phraseIndex = findCandidateByPhrase(transcript, navigation.pendingCandidates);
    const resolvedIndex = choiceIndex >= 0 ? choiceIndex : phraseIndex;
    if (placeInfoTopic) {
      if (resolvedIndex >= 0) {
        return { type: "pending_place_info", topic: placeInfoTopic, index: resolvedIndex };
      }
      if (isNo(transcript)) {
        return { type: "confirm_no" };
      }
      return { type: "choice_unclear" };
    }
    if (choiceIndex >= 0 || phraseIndex >= 0) {
      return { type: "choose_option", index: resolvedIndex };
    }
    if (isNo(transcript)) {
      return { type: "confirm_no" };
    }
    return { type: "choice_unclear" };
  }
  if (navigation.pendingDestination) {
    if (isYes(transcript)) {
      return { type: "confirm_yes" };
    }
    if (isNo(transcript)) {
      return { type: "confirm_no" };
    }
    if (placeInfoTopic) {
      return { type: "place_info", topic: placeInfoTopic, pending: true };
    }
    return { type: "confirm_unclear" };
  }
  if (/\b(remove|delete|skip|cancel|drop)\b/.test(lowered) && /\b(stop|stopover|waypoint)\b/.test(lowered)) {
    const stops = navigation.waypoints || [];
    const choiceIndex = parseChoiceIndex(transcript, stops.length || DESTINATION_OPTION_LIMIT);
    const phraseIndex = stops.length ? findCandidateByPhrase(transcript, stops) : -1;
    const resolvedIndex = choiceIndex >= 0 ? choiceIndex : phraseIndex;
    return { type: "remove_stopover", index: resolvedIndex >= 0 ? resolvedIndex : null };
  }
  if (routeSearchFollowUp) {
    return routeSearchFollowUp;
  }
  if (routeSearchIntent) {
    return routeSearchIntent;
  }
  if (placeInfoTopic) {
    if (navigation.destination) {
      return { type: "place_info", topic: placeInfoTopic };
    }
    return null;
  }
  if (/\b(where are you taking me|what is my route|what's my route|route summary|full route|what stops are on my route|what stopovers are on my route|route plan|travel plan|what is the plan)\b/i.test(lowered)) {
    return { type: "route_plan" };
  }
  if (looksLikeDestinationRequest(transcript)) {
    return { type: "destination", query: transcript };
  }
  if (/\b(shortest route|correct me|bring me back|reroute|route again|wrong path|wrong route|lost|off route)\b/i.test(lowered) && navigation.destination) {
    return { type: "shortest_route" };
  }
  if (/\b(how much farther|how far|distance left|time left|eta|remaining|how long|where am i going)\b/i.test(lowered) && navigation.destination) {
    return { type: "progress" };
  }
  if (/\b(repeat|say that again|what next|next step|which way now|where next)\b/i.test(lowered) && navigation.destination) {
    return { type: "repeat_step" };
  }
  if (/\b(stop navigation|clear route|cancel route|stop route)\b/i.test(lowered) && navigation.destination) {
    return { type: "clear_route" };
  }
  if (/\b(refresh route|update route|recheck route)\b/i.test(lowered) && navigation.destination) {
    return { type: "refresh_route" };
  }
  if (/\b(where am i|current location|my location)\b/i.test(lowered) && navigation.destination) {
    return { type: "location_status" };
  }
  if (/\b(what is ahead|what's ahead|what is in front|what's in front|is the path clear|is it safe|safe side|obstacle)\b/i.test(lowered) && navigation.destination) {
    return { type: "scene_status" };
  }
  if (!navigation.destination && looksLikeBareDestination(transcript)) {
    return { type: "destination", query: transcript };
  }
  return null;
}

async function handleGlobalDestinationRequest(rawValue, source = "voice") {
  const spokenQuery = String(rawValue || "").trim();
  const nearestRequested = /\b(nearest|nearby|closest)\b/i.test(spokenQuery);
  const query = normalizeDestinationQuery(rawValue);
  if (!query) {
    return "Please tell me the place again so I can set the walk.";
  }
  const origin = state.globalRoute.currentPosition || (await captureGlobalCurrentLocation(true).catch(() => null));
  if (!origin) {
    return "I need your current location before I can compare nearby walking destinations.";
  }
  const rankedCandidates = rankDestinationCandidates(await geocodeGlobalDestination(query, origin, nearestRequested), query);
  if (!rankedCandidates.length) {
    return "I could not find that destination. Please say it in another way.";
  }
  const candidates = rankedCandidates.slice(0, DESTINATION_OPTION_LIMIT);
  const nearestCandidate = candidates[0];
  if (nearestCandidate.distanceMeters !== null && nearestCandidate.distanceMeters > MAX_WALKING_DESTINATION_METERS) {
    return `${nearestCandidate.optionLabel} is about ${formatDistance(nearestCandidate.distanceMeters)} away, which is too far for walking guidance. Please choose a nearer place.`;
  }
  if (shouldOfferDestinationChoices(query, candidates, nearestRequested)) {
    state.globalRoute.pendingDestination = null;
    state.globalRoute.pendingCandidates = candidates;
    state.globalRoute.pendingQuery = query;
    state.globalRoute.status = "Choose place";
    saveGlobalRouteState();
    return buildChoicePrompt(query, candidates);
  }
  const candidate = candidates[0];
  state.globalRoute.pendingCandidates = [];
  state.globalRoute.pendingDestination = candidate;
  state.globalRoute.pendingQuery = query;
  state.globalRoute.status = "Confirm";
  saveGlobalRouteState();
  const choiceMeta = buildChoiceMeta(candidate, ", ");
  if (source === "voice") {
    return `I found ${candidate.optionLabel || candidate.shortName}${choiceMeta ? `, ${choiceMeta}` : ""}. Should I start walking guidance there?`;
  }
  return activateGlobalDestination(candidate);
}

async function activateGlobalDestination(candidate) {
  const navigation = state.globalRoute;
  let nextDestination = candidate;
  try {
    nextDestination = (await ensureGlobalRouteCandidateDetails(candidate)) || candidate;
  } catch (_error) {
    nextDestination = candidate;
  }
  navigation.destination = nextDestination;
  navigation.waypoints = [];
  navigation.route = null;
  navigation.arrived = false;
  navigation.lastOffRouteAt = 0;
  navigation.routeSearchCache = {};
  navigation.lastRouteSearch = null;
  navigation.pendingDestination = null;
  navigation.pendingCandidates = [];
  navigation.pendingQuery = "";
  navigation.status = "Locating";
  saveGlobalRouteState();
  try {
    await captureGlobalCurrentLocation(true);
    return await fetchGlobalRoute("new_destination");
  } catch (error) {
    return error && error.message ? error.message : "I could not set the route right now.";
  }
}

async function handleGlobalRouteQuestion(question, source = "voice") {
  const intent = detectGlobalRouteIntent(question);
  if (!intent) {
    return null;
  }
  switch (intent.type) {
    case "confirm_yes":
      return activateGlobalDestination(state.globalRoute.pendingDestination);
    case "confirm_no":
      state.globalRoute.pendingDestination = null;
      state.globalRoute.pendingCandidates = [];
      state.globalRoute.pendingQuery = "";
      state.globalRoute.status = "Retry";
      saveGlobalRouteState();
      return "Alright, tell me the destination again and I will confirm it before routing.";
    case "confirm_unclear":
      return "Please answer with yes or no so I can continue.";
    case "choice_unclear":
      return state.globalRoute.pendingCandidates.length
        ? buildChoicePrompt(state.globalRoute.pendingQuery || "that destination", state.globalRoute.pendingCandidates)
        : "Please choose one of the listed options first.";
    case "choose_option": {
      const candidate = state.globalRoute.pendingCandidates[intent.index];
      return candidate ? activateGlobalDestination(candidate) : "Please choose one of the listed options first.";
    }
    case "pending_place_info": {
      const candidate = state.globalRoute.pendingCandidates[intent.index];
      if (!candidate) {
        return "Please choose one of the listed options first.";
      }
      const detailedCandidate = await ensureGlobalRouteCandidateDetails(candidate);
      return buildGlobalPlaceInfoReply(detailedCandidate, intent.topic);
    }
    case "place_info": {
      const candidate = intent.pending ? state.globalRoute.pendingDestination : state.globalRoute.destination;
      if (!candidate) {
        return "Tell me the destination first, then I can answer whether it is open, where it is, its rating, budget, food style, phone number, or website.";
      }
      const detailedCandidate = await ensureGlobalRouteCandidateDetails(candidate);
      return buildGlobalPlaceInfoReply(detailedCandidate, intent.topic);
    }
    case "route_search_missing_query":
      return "Tell me what kind of place you want on the route. I can search for things like ATM, bank, cafe, restaurant, restroom, pharmacy, bus stop, petrol pump, hotel, grocery store, brand names, or another place you mention.";
    case "route_place_search": {
      if (!state.globalRoute.route || !state.globalRoute.destination) {
        return "Set a destination first, then I can check what is available on your route.";
      }
      const results = await searchGlobalRouteAmenities(intent);
      rememberGlobalRouteSearch(intent, results);
      return buildGlobalRouteAmenityReply(intent, results);
    }
    case "route_add_search": {
      if (!state.globalRoute.route || !state.globalRoute.destination) {
        return "Set a destination first, then I can find a stop to add on the route.";
      }
      const results = await searchGlobalRouteAmenities(intent);
      rememberGlobalRouteSearch(intent, results);
      if (!results.length) {
        return buildGlobalRouteAmenityReply(intent, results);
      }
      if (intent.nearestRequested || results.length === 1) {
        state.globalRoute.lastRouteSearch = { ...state.globalRoute.lastRouteSearch, selectedIndex: 0 };
        saveGlobalRouteState();
        return addGlobalRouteStopover(results[0]);
      }
      return buildGlobalRouteAmenityReply(intent, results);
    }
    case "route_result_info": {
      const lastSearch = state.globalRoute.lastRouteSearch;
      if (!lastSearch || !Array.isArray(lastSearch.results) || !lastSearch.results[intent.index]) {
        return "Ask me to search for a place on your route first, then I can tell you more about it.";
      }
      const detailedCandidate = await ensureGlobalRouteCandidateDetails(lastSearch.results[intent.index]);
      const results = [...lastSearch.results];
      results[intent.index] = detailedCandidate;
      state.globalRoute.lastRouteSearch = { ...lastSearch, results, selectedIndex: intent.index };
      saveGlobalRouteState();
      return buildGlobalPlaceInfoReply(detailedCandidate, intent.topic || "summary");
    }
    case "route_add_existing": {
      const lastSearch = state.globalRoute.lastRouteSearch;
      if (!lastSearch || !Array.isArray(lastSearch.results) || !lastSearch.results[intent.index]) {
        return "Search for a route-side place first, then tell me which option to add.";
      }
      state.globalRoute.lastRouteSearch = { ...lastSearch, selectedIndex: intent.index };
      saveGlobalRouteState();
      return addGlobalRouteStopover(lastSearch.results[intent.index]);
    }
    case "route_result_choice_unclear":
      return buildGlobalRouteResultChoiceReply(intent.mode, intent.topic);
    case "remove_stopover": {
      const stops = [...(state.globalRoute.waypoints || [])];
      if (!stops.length) {
        return "There is no extra stop on the route right now.";
      }
      const index = Number.isInteger(intent.index) && intent.index >= 0 && intent.index < stops.length ? intent.index : stops.length - 1;
      stops.splice(index, 1);
      state.globalRoute.waypoints = stops;
      state.globalRoute.routeSearchCache = {};
      state.globalRoute.arrived = false;
      saveGlobalRouteState();
      return await fetchGlobalRoute("stop_removed");
    }
    case "destination":
      return handleGlobalDestinationRequest(intent.query, source);
    case "shortest_route":
      return state.globalRoute.destination
        ? fetchGlobalRoute("shortest_correction")
        : "Tell me where you want to go first, then I can correct the route if needed.";
    case "route_plan":
      return buildGlobalRoutePlanReply();
    case "progress":
      return describeGlobalRouteProgress(state.globalRoute.route);
    case "repeat_step": {
      const step = getGlobalPrimaryRouteStep();
      return step ? "Next, " + step.instruction : "There is no active route step yet. Tell me the destination first.";
    }
    case "clear_route":
      return clearGlobalRoute();
    case "refresh_route":
      return state.globalRoute.destination ? fetchGlobalRoute("manual_refresh") : "There is no route to refresh yet.";
    case "location_status":
      return describeGlobalLocationStatus();
    case "scene_status":
      return describeGlobalSceneStatus();
    default:
      return null;
  }
}

async function maybeHandleGlobalOutdoorCommand(question, source = "voice") {
  const currentPage = (currentPageHelper() && currentPageHelper().page) || body.dataset.page || "home";
  if (currentPage === "outdoor") {
    return null;
  }
  return handleGlobalRouteQuestion(question, source);
}

function resumeGlobalRouteIfNeeded() {
  const navigation = state.globalRoute;
  const currentPage = (currentPageHelper() && currentPageHelper().page) || body.dataset.page || "home";
  if (currentPage === "outdoor" || !navigation.destination) {
    return;
  }
  if (navigation.currentPosition) {
    beginGlobalLocationWatch();
    void maybeRefreshGlobalRoute(navigation.currentPosition);
    return;
  }
  void captureGlobalCurrentLocation(true).catch(() => {});
}

async function askHomeAssistantDirect(question) {
  const response = await fetch(
    `${body.dataset.askUrl}?q=${encodeURIComponent(String(question || "").trim())}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`Main assistant request failed with ${response.status}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error);
  }
  return payload.answer && payload.answer.answer
    ? payload.answer.answer
    : "I could not get a reply from the main dashboard yet.";
}

async function askIndoorAssistantDirect(question, mode = "navigator") {
  const response = await fetch(
    `${body.dataset.indoorUrl}?q=${encodeURIComponent(String(question || "").trim())}&mode=${encodeURIComponent(mode)}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`Indoor assistant request failed with ${response.status}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error);
  }
  return payload.answer && payload.answer.answer
    ? payload.answer.answer
    : "I could not get a reply from that assistant yet.";
}

async function delegateToPageQuestion(question, targetPage = "current") {
  const helper = currentPageHelper();
  const currentPage = (helper && helper.page) || body.dataset.page || "home";
  const page = targetPage === "current" ? currentPage : targetPage;
  if (page !== currentPage) {
    if (page === "home") {
      return askHomeAssistantDirect(question);
    }
    if (page === "indoor") {
      return askIndoorAssistantDirect(question, "navigator");
    }
    if (page === "describe") {
      return askIndoorAssistantDirect(question, "describe");
    }
    if (page === "outdoor") {
      const globalReply = await maybeHandleGlobalOutdoorCommand(question, "typed");
      if (globalReply) {
        return globalReply;
      }
    }
    queuePendingPageAction({
      tool: "delegate_page",
      page,
      question,
    });
    navigateToPage(page, `I will continue that on ${pageLabelFor(page)}.`);
    return "__navigating__";
  }
  if (!helper || typeof helper.askQuestion !== "function") {
    return "This page does not expose a page assistant yet.";
  }
  const reply = await helper.askQuestion(question);
  return reply || "I could not get a reply from this page yet.";
}

async function executeAction(action, transcript) {
  const tool = action && action.tool;
  if (!tool) {
    return "";
  }
  if (tool === "reply_only") {
    return String(action.text || "").trim();
  }
  if (tool === "switch_page") {
    const currentPage = (currentPageHelper() && currentPageHelper().page) || body.dataset.page || "home";
    const page = action.page === "current" ? currentPage : (action.page || "home");
    if (page === currentPage) {
      return "";
    }
    navigateToPage(page, String(action.text || "").trim() || `Opening ${pageLabelFor(page)}.`);
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
      return "I still need both the contact name and the phone number.";
    }
    state.contacts[name] = number;
    saveContacts();
    return `${name} is saved as a contact.`;
  }
  if (tool === "call_contact") {
    const contact = resolveContact(action.target || "");
    if (!contact) {
      return "I could not find that contact.";
    }
    window.setTimeout(() => {
      window.location.href = `tel:${contact.number}`;
    }, 160);
    return `Calling ${contact.label}.`;
  }
  if (tool === "open_site") {
    const site = String(action.site || "").trim();
    const query = String(action.query || "").trim();
    if (!site) {
      return "I need to know which site to open.";
    }
    return openExternalSite(site, query)
      ? query
        ? `I opened ${siteLabel(site)} for ${query}.`
        : `I opened ${siteLabel(site)}.`
      : "I could not open that site right now.";
  }
  if (tool === "open_music") {
    const query = String(action.query || "music").trim() || "music";
    return openMusic(query)
      ? `I opened music for ${query}.`
      : "The browser blocked the music window. Please allow pop-ups for this site.";
  }
  if (tool === "stop_music") {
    return closeMusicWindow()
      ? "I closed the music window."
      : "I do not have an open music window to close right now.";
  }
  if (tool === "set_reminder") {
    const reminder = createReminder(action.text, action.delay_ms);
    return reminder
      ? `Reminder set for ${new Date(reminder.dueAt).toLocaleTimeString()}: ${reminder.text}.`
      : "I could not set that reminder yet.";
  }
  if (tool === "list_reminders") {
    if (!state.reminders.length) {
      return "You do not have any active reminders right now.";
    }
    return `Your reminders are: ${state.reminders
      .slice()
      .sort((left, right) => left.dueAt - right.dueAt)
      .map((item) => `${item.text} at ${new Date(item.dueAt).toLocaleTimeString()}`)
      .join(". ")}.`;
  }
  if (tool === "get_time") {
    return `It is ${new Date().toLocaleTimeString()}.`;
  }
  if (tool === "get_date") {
    return `Today is ${new Date().toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })}.`;
  }
  if (tool === "get_battery") {
    return getBatteryReply();
  }
  if (tool === "get_weather") {
    return getWeatherReply();
  }
  return "";
}

async function sendMessageToBackend(message, source = "voice") {
  const transcript = String(message || "").trim();
  if (!transcript) {
    speakReply("I did not catch that. Please try again.", { afterSpeakListen: false });
    return;
  }

  state.commandRunId += 1;
  const runId = state.commandRunId;
  state.commandPending = true;
  setMicButtonLabel();
  activateConversation();
  openPanel(true);
  setHeard(transcript);
  setListeningBadge("Thinking", "medium");
  assistiveVoiceChannel.holdAlerts(ALERT_SUPPRESSION_WHILE_LISTENING_MS);

  try {
    const localOutdoorReply = await maybeHandleGlobalOutdoorCommand(transcript, source);
    if (typeof localOutdoorReply === "string" && localOutdoorReply.trim()) {
      if (runId !== state.commandRunId) {
        return;
      }
      speakReply(localOutdoorReply.trim(), { afterSpeakListen: source !== "silent" });
      return;
    }
    const response = await fetch(chatUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: transcript,
        context: buildContextPayload(),
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Navi request failed with ${response.status}${errorText ? `: ${errorText.slice(0, 120)}` : ""}`,
      );
    }
    const payload = await response.json();
    if (runId !== state.commandRunId) {
      return;
    }

    let reply = String(payload.reply || "").trim();
    let navigating = false;
    const actions = Array.isArray(payload.actions) ? payload.actions : [];
    for (const action of actions) {
      if (runId !== state.commandRunId) {
        return;
      }
      const actionReply = await executeAction(action, transcript);
      if (actionReply === "__navigating__") {
        navigating = true;
        break;
      }
      if (typeof actionReply === "string" && actionReply.trim()) {
        reply = actionReply.trim();
      }
    }

    if (runId !== state.commandRunId || navigating) {
      return;
    }
    if (!reply) {
      reply = "I am ready.";
    }
    speakReply(reply, { afterSpeakListen: source !== "silent" });
  } catch (error) {
    if (runId !== state.commandRunId) {
      return;
    }
    console.error("Navi request failed", error);
    speakReply(
      "Navi could not complete that request right now. Please try again after a refresh.",
      { afterSpeakListen: false },
    );
  } finally {
    if (runId === state.commandRunId) {
      state.commandPending = false;
      setMicButtonLabel();
      updateWakeState();
    }
  }
}

async function resumePendingPageAction() {
  const pending = consumePendingPageAction();
  if (!pending) {
    return;
  }
  const currentPage = (currentPageHelper() && currentPageHelper().page) || body.dataset.page || "home";
  if (pending.page !== currentPage) {
    queuePendingPageAction(pending);
    return;
  }
  if (pending.tool === "delegate_page" && pending.question) {
    const reply = await delegateToPageQuestion(pending.question, "current");
    if (reply && reply !== "__navigating__") {
      setHeard(pending.question);
      speakReply(reply, { afterSpeakListen: false });
    }
  }
}

function setupRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    state.recognition = null;
    state.wakeEnabled = false;
    localStorage.setItem(WAKE_ENABLED_STORAGE_KEY, "false");
    setWakeBadge("Wake unavailable", "high");
    setListeningBadge("Voice unavailable", "high");
    if (elements.mic) {
      elements.mic.disabled = true;
      elements.mic.textContent = "Mic unavailable";
    }
    if (elements.wakeToggle) {
      elements.wakeToggle.textContent = "Wake word unavailable";
      elements.wakeToggle.disabled = true;
    }
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  state.recognition = recognition;

  recognition.onstart = () => {
    state.listening = true;
    if (state.mode === "wake") {
      setListeningBadge("Wake listening", "low");
      assistiveVoiceChannel.setCompanionListening(false);
    } else if (state.mode === "followup") {
      setListeningBadge("Listening for follow-up", "medium");
      assistiveVoiceChannel.setCompanionListening(true);
      assistiveVoiceChannel.holdAlerts(ALERT_SUPPRESSION_WHILE_LISTENING_MS);
    } else {
      setListeningBadge("Listening", "medium");
      assistiveVoiceChannel.setCompanionListening(true);
      assistiveVoiceChannel.holdAlerts(ALERT_SUPPRESSION_WHILE_LISTENING_MS);
    }
    setMicButtonLabel();
    updateWakeState();
  };

  recognition.onend = () => {
    const previousMode = state.mode;
    state.listening = false;
    state.mode = "idle";
    assistiveVoiceChannel.setCompanionListening(
      false,
      ALERT_SUPPRESSION_AFTER_LISTENING_MS,
    );
    setMicButtonLabel();
    updateWakeState();
    if (previousMode === "wake") {
      startWakeSoon(600);
      return;
    }
    if (
      (previousMode === "command" || previousMode === "followup") &&
      hasActiveConversation() &&
      !state.speaking &&
      !state.commandPending
    ) {
      startFollowUpSoon();
      scheduleFollowUpStop();
      return;
    }
    if (!hasActiveConversation()) {
      startWakeSoon(400);
    }
  };

  recognition.onerror = (event) => {
    state.listening = false;
    state.mode = "idle";
    assistiveVoiceChannel.setCompanionListening(
      false,
      ALERT_SUPPRESSION_AFTER_LISTENING_MS,
    );
    const errorType = String(event && event.error ? event.error : "");
    if (errorType === "not-allowed" || errorType === "service-not-allowed") {
      state.micPermission = "denied";
      setListeningBadge("Microphone blocked", "high");
    } else {
      setListeningBadge("Mic issue", "high");
    }
    setMicButtonLabel();
    updateWakeState();
    if (state.micPermission !== "denied") {
      startWakeSoon(1000);
    }
  };

  recognition.onresult = async (event) => {
    const result = event.results[event.results.length - 1];
    if (!result || !result[0]) {
      return;
    }
    const transcript = String(result[0].transcript || "").trim();
    const isFinal = Boolean(result.isFinal);
    if (!transcript) {
      return;
    }
    setHeard(transcript);

    if (state.mode === "wake") {
      const wake = extractWakeCommand(transcript);
      if (!wake.matched) {
        return;
      }
      if (!isFinal) {
        setListeningBadge("Heard Navi", "medium");
        return;
      }
      stopRecognition();
      openPanel(true);
      activateConversation();
      if (wake.remainder) {
        await sendMessageToBackend(wake.remainder, "voice");
        return;
      }
      speakReply("Yes, I am listening.", { afterSpeakListen: true });
      return;
    }

    if (!isFinal) {
      return;
    }
    stopRecognition();
    await sendMessageToBackend(transcript, "voice");
  };
}

function saveContactFromInputs() {
  const name = String(elements.contactName.value || "").trim();
  const number = String(elements.contactNumber.value || "").trim();
  if (!name || !number) {
    setReplyText("Please enter both a contact name and a phone number first.");
    return;
  }
  state.contacts[name] = number;
  elements.contactName.value = "";
  elements.contactNumber.value = "";
  saveContacts();
  speakReply(`${name} is saved as a contact.`, { afterSpeakListen: false });
}

function setWakeEnabled(enabled) {
  state.wakeEnabled = Boolean(enabled);
  state.manualListeningPaused = false;
  localStorage.setItem(WAKE_ENABLED_STORAGE_KEY, state.wakeEnabled ? "true" : "false");
  if (elements.wakeToggle) {
    elements.wakeToggle.textContent = `Wake word: ${state.wakeEnabled ? "On" : "Off"}`;
  }
  if (!state.wakeEnabled) {
    clearConversation();
    stopRecognition();
  } else {
    startWakeSoon(0);
  }
  setMicButtonLabel();
  updateWakeState();
}

function attachUiEvents() {
  elements.toggle.addEventListener("click", async () => {
    openPanel(true);
    state.manualListeningPaused = false;
    if (state.speaking) {
      cancelSpeech();
    }
    if (state.micPermission !== "granted") {
      await requestMicPermission();
    }
    startCommandListening("command");
  });

  elements.close.addEventListener("click", () => {
    openPanel(false);
  });

  elements.mic.addEventListener("click", async () => {
    openPanel(true);
    state.manualListeningPaused = false;
    if (state.speaking) {
      cancelSpeech();
      startCommandListening("command");
      return;
    }
    if (state.listening) {
      pauseListeningManually();
      return;
    }
    if (state.micPermission !== "granted") {
      await requestMicPermission();
    }
    startCommandListening("command");
  });

  elements.wakeToggle.addEventListener("click", async () => {
    const nextValue = !state.wakeEnabled;
    if (nextValue && state.micPermission !== "granted") {
      await requestMicPermission();
    }
    setWakeEnabled(nextValue);
  });

  elements.saveContact.addEventListener("click", saveContactFromInputs);

  elements.contactList.addEventListener("click", (event) => {
    const callButton = event.target.closest("[data-call-contact]");
    if (callButton) {
      void sendMessageToBackend(`Call ${callButton.dataset.callContact}`, "silent");
      return;
    }
    const removeButton = event.target.closest("[data-remove-contact]");
    if (removeButton) {
      delete state.contacts[removeButton.dataset.removeContact];
      saveContacts();
      setReplyText("Contact removed.");
    }
  });

  elements.reminderList.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-reminder]");
    if (!removeButton) {
      return;
    }
    removeReminder(removeButton.dataset.removeReminder);
    setReplyText("Reminder removed.");
  });

  document.querySelectorAll("[data-companion-command]").forEach((button) => {
    button.addEventListener("click", () => {
      openPanel(true);
      void sendMessageToBackend(button.dataset.companionCommand || "", "typed");
    });
  });
}

function initializeNavi() {
  renderContacts();
  rescheduleReminders();
  setupRecognition();
  setHeard("");
  setReplyText(
    "I can help with page switching, current site guidance, indoor help, description, walking routes from any page, route-side place search, contacts, Google, Maps, YouTube, music, reminders, time, date, battery, weather, and broader Gemini-style questions.",
  );
  attachUiEvents();
  if (elements.wakeToggle) {
    elements.wakeToggle.textContent = `Wake word: ${state.wakeEnabled ? "On" : "Off"}`;
  }
  setListeningBadge("Idle", "neutral");
  setMicButtonLabel();
  updateWakeState();
  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      state.preferredVoice = null;
      chooseVoice();
    };
  }
  armWakeBootstrap();
  void initializeMicPermission();
  void resumePendingPageAction();
  resumeGlobalRouteIfNeeded();
  window.setInterval(() => {
    const dueReminders = state.reminders.filter((item) => item.dueAt <= Date.now());
    dueReminders.forEach(triggerReminder);
  }, REMINDER_CHECK_INTERVAL_MS);
}

initializeNavi();
})();
