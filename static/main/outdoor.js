const body = document.body;
const sceneUrl = body.dataset.sceneUrl;
const safetyUrl = body.dataset.safetyUrl || `${sceneUrl}?view=safety`;
const contextUrl = body.dataset.contextUrl || `${sceneUrl}?view=context`;
const googleMapsKey = body.dataset.googleMapsKey || "";

const ARRIVAL_DISTANCE_METERS = 18;
const ROUTE_REFRESH_INTERVAL_MS = 12000;
const ROUTE_REFRESH_MOVE_METERS = 18;
const ROUTE_STEP_PREVIEW_COUNT = 6;
const OFF_ROUTE_THRESHOLD_METERS = 28;
const OFF_ROUTE_COOLDOWN_MS = 9000;
const SPEECH_CONFIRMATION_THRESHOLD = 0.72;
const MAX_WALKING_DESTINATION_METERS = 20000;
const DESTINATION_OPTION_LIMIT = 3;
const DESTINATION_OPTION_WINDOW_METERS = 2500;
const GOOGLE_MAPS_LOAD_TIMEOUT_MS = 10000;
const GOOGLE_TEXT_SEARCH_RADIUS_METERS = 30000;
const GOOGLE_TEXT_SEARCH_FALLBACK_RADIUS_METERS = 50000;
const SAME_ALERT_BURST_LIMIT = 3;
const SAME_ALERT_MIN_INTERVAL_MS = 3200;
const SAME_ALERT_COOLDOWN_MS = 6500;
const SAFETY_REFRESH_MS = 110;
const CONTEXT_REFRESH_MS = 900;
const MAX_CONVERSATION_ITEMS = 8;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
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

const elements = {
  voiceToggle: document.getElementById("voiceToggle"),
  talkToNavigator: document.getElementById("talkToNavigator"),
  repeatInstruction: document.getElementById("repeatInstruction"),
  destinationForm: document.getElementById("destinationForm"),
  destinationInput: document.getElementById("destinationInput"),
  voiceDestination: document.getElementById("voiceDestination"),
  useLocation: document.getElementById("useLocation"),
  refreshRoute: document.getElementById("refreshRoute"),
  shortestRoute: document.getElementById("shortestRoute"),
  clearRoute: document.getElementById("clearRoute"),
  confirmationCard: document.getElementById("confirmationCard"),
  confirmationText: document.getElementById("confirmationText"),
  confirmationChoices: document.getElementById("confirmationChoices"),
  confirmDestination: document.getElementById("confirmDestination"),
  retryDestination: document.getElementById("retryDestination"),
  voiceConfirm: document.getElementById("voiceConfirm"),
  journeyMessage: document.getElementById("journeyMessage"),
  routeStatusBadge: document.getElementById("routeStatusBadge"),
  locationText: document.getElementById("locationText"),
  destinationLabel: document.getElementById("destinationLabel"),
  routeDistance: document.getElementById("routeDistance"),
  routeEta: document.getElementById("routeEta"),
  routeMap: document.getElementById("routeMap"),
  routeMapStatus: document.getElementById("routeMapStatus"),
  nextRouteInstruction: document.getElementById("nextRouteInstruction"),
  routeStepList: document.getElementById("routeStepList"),
  connectionBadge: document.getElementById("connectionBadge"),
  urgencyBadge: document.getElementById("urgencyBadge"),
  commandCard: document.getElementById("commandCard"),
  commandValue: document.getElementById("commandValue"),
  spokenMessage: document.getElementById("spokenMessage"),
  safeDirection: document.getElementById("safeDirection"),
  clearSteps: document.getElementById("clearSteps"),
  objectCount: document.getElementById("objectCount"),
  sceneSummary: document.getElementById("sceneSummary"),
  heardTranscript: document.getElementById("heardTranscript"),
  assistantReply: document.getElementById("assistantReply"),
  conversationFeed: document.getElementById("conversationFeed"),
  conversationHint: document.getElementById("conversationHint"),
  lastUpdated: document.getElementById("lastUpdated"),
  obstacleList: document.getElementById("obstacleList"),
};

const appState = {
  voiceEnabled: true,
  lastSpokenMessage: "",
  preferredVoice: null,
  latestSafetyScene: null,
  latestContextScene: null,
  safetyPolling: false,
  contextPolling: false,
  recognition: null,
  recognitionActive: false,
  activeSpeechMode: null,
  pendingAutoListenMode: null,
  pendingAutoListenDelay: 0,
  autoListenTimer: null,
  assistantSpeaking: false,
  assistantSpeechToken: 0,
  pendingSafetyAlert: null,
  safetySpeech: {
    lastKey: "",
    repeatCount: 0,
    lastAt: 0,
    nextReminderAt: 0,
  },
  userActivatedAudio: false,
  voiceKickstarted: false,
  streamLoaded: false,
  navigation: {
    currentPosition: null,
    locationWatchId: null,
    destination: null,
    pendingDestination: null,
    pendingCandidates: [],
    waypoints: [],
    route: null,
    isFetchingRoute: false,
    arrived: false,
    lastRouteRefreshAt: 0,
    lastRouteOrigin: null,
    lastOffRouteAt: 0,
    map: null,
    placesService: null,
    placesServiceHost: null,
    directionsService: null,
    directionsRenderer: null,
    googleReadyPromise: null,
    currentMarker: null,
    destinationMarker: null,
    waypointMarkers: [],
    placeDetailsCache: {},
    routeSearchCache: {},
    lastRouteSearch: null,
  },
};

function prettyLabel(value) {
  return String(value || "-")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function shortPlaceLabel(name) {
  return String(name || "").split(",")[0].trim() || String(name || "Unknown place");
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

function buildSafetyAlertKey(scene) {
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

function setRouteStatus(text, level = "neutral") {
  elements.routeStatusBadge.textContent = text;
  setBadgeClass(elements.routeStatusBadge, level);
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
    const match = voices.find(test);
    if (match) {
      appState.preferredVoice = match;
      return match;
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

  if (options.cancel !== false && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
    window.speechSynthesis.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(message);
  utterance.voice = chooseVoice();
  utterance.rate = options.rate || 0.96;
  utterance.pitch = options.pitch || 1.02;
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

function clearAutoListenQueue() {
  window.clearTimeout(appState.autoListenTimer);
  appState.pendingAutoListenMode = null;
  appState.pendingAutoListenDelay = 0;
}

function companionIsHoldingAlerts() {
  const voiceChannel = window.AssistiveVoiceChannel;
  return Boolean(
    voiceChannel &&
    typeof voiceChannel.shouldHoldAlerts === "function" &&
    voiceChannel.shouldHoldAlerts()
  );
}

function shouldHoldSafetySpeech() {
  return Boolean(
    appState.recognitionActive ||
    appState.assistantSpeaking ||
    appState.pendingAutoListenMode ||
    companionIsHoldingAlerts()
  );
}

function flushPendingSafetyAlert() {
  if (!appState.pendingSafetyAlert || shouldHoldSafetySpeech()) {
    return;
  }

  const pending = appState.pendingSafetyAlert;
  appState.pendingSafetyAlert = null;
  speakSafetyGuidance(pending.text, pending.key, pending.urgent, pending.force);
}

function maybeStartQueuedAutoListen() {
  if (!appState.pendingAutoListenMode || appState.assistantSpeaking || appState.recognitionActive) {
    return;
  }

  const mode = appState.pendingAutoListenMode;
  const delay = appState.pendingAutoListenDelay || 0;
  window.clearTimeout(appState.autoListenTimer);
  appState.autoListenTimer = window.setTimeout(() => {
    if (appState.assistantSpeaking || appState.recognitionActive || !appState.pendingAutoListenMode) {
      return;
    }

    clearAutoListenQueue();
    startSpeechCapture(mode, true);
  }, delay);
}

function finishAssistantSpeech(token) {
  if (token !== appState.assistantSpeechToken) {
    return;
  }

  appState.assistantSpeaking = false;
  maybeStartQueuedAutoListen();
  flushPendingSafetyAlert();
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
    onend: () => {
      if (typeof options.onend === "function") {
        options.onend();
      }
      finishAssistantSpeech(token);
    },
  });

  if (!spoken && token === appState.assistantSpeechToken) {
    appState.assistantSpeaking = false;
    maybeStartQueuedAutoListen();
    flushPendingSafetyAlert();
  }

  return spoken;
}

function resetSafetySpeech() {
  appState.safetySpeech.lastKey = "";
  appState.safetySpeech.repeatCount = 0;
  appState.safetySpeech.lastAt = 0;
  appState.safetySpeech.nextReminderAt = 0;
}

function speakSafetyGuidance(text, key, urgent = false, force = false) {
  const message = String(text || "").trim();
  const speechKey = String(key || message).trim();
  if (!message || !speechKey) {
    return;
  }

  if (shouldHoldSafetySpeech()) {
    appState.pendingSafetyAlert = urgent
      ? { text: message, key: speechKey, urgent, force }
      : null;
    return;
  }

  const now = Date.now();
  const safetySpeech = appState.safetySpeech;

  if (force || speechKey !== safetySpeech.lastKey) {
    if (speak(message, { force: true })) {
      safetySpeech.lastKey = speechKey;
      safetySpeech.repeatCount = 1;
      safetySpeech.lastAt = now;
      safetySpeech.nextReminderAt = 0;
    }
    return;
  }

  if (!urgent || (window.speechSynthesis && (window.speechSynthesis.speaking || window.speechSynthesis.pending))) {
    return;
  }

  if (safetySpeech.repeatCount < SAME_ALERT_BURST_LIMIT) {
    if (now - safetySpeech.lastAt < SAME_ALERT_MIN_INTERVAL_MS) {
      return;
    }

    if (speak(message, { force: true })) {
      safetySpeech.repeatCount += 1;
      safetySpeech.lastAt = now;
      if (safetySpeech.repeatCount >= SAME_ALERT_BURST_LIMIT) {
        safetySpeech.nextReminderAt = now + SAME_ALERT_COOLDOWN_MS;
      }
    }
    return;
  }

  if (now < safetySpeech.nextReminderAt) {
    return;
  }

  if (speak(message, { force: true })) {
    safetySpeech.lastAt = now;
    safetySpeech.nextReminderAt = now + SAME_ALERT_COOLDOWN_MS;
  }
}

function appendConversation(role, text) {
  if (!elements.conversationFeed || !text) {
    return;
  }

  const entry = document.createElement("article");
  entry.className = `conversation-entry ${role}`;
  entry.innerHTML = `
    <strong>${role === "assistant" ? "Navigator" : "User"}</strong>
    <p>${text}</p>
  `;
  elements.conversationFeed.prepend(entry);

  while (elements.conversationFeed.children.length > MAX_CONVERSATION_ITEMS) {
    elements.conversationFeed.removeChild(elements.conversationFeed.lastElementChild);
  }
}

function updateHeardTranscript(text) {
  elements.heardTranscript.textContent = text || "Nothing yet.";
}

function setAssistantReply(text, options = {}) {
  const message = String(text || "").trim();
  if (!message) {
    return;
  }

  elements.assistantReply.textContent = message;
  elements.journeyMessage.textContent = message;

  if (options.log !== false) {
    appendConversation("assistant", message);
  }

  if (options.speak) {
    speakAssistantMessage(message, { force: options.force !== false });
  }
}

function queueAutoListen(mode, delay = 850) {
  if (!appState.recognition) {
    return;
  }

  window.clearTimeout(appState.autoListenTimer);
  appState.pendingAutoListenMode = mode;
  appState.pendingAutoListenDelay = delay;
  maybeStartQueuedAutoListen();
}

function updateSpeechButtons(listening = false) {
  elements.voiceDestination.textContent =
    listening && appState.activeSpeechMode === "destination" ? "Listening..." : "Speak destination";
  elements.voiceConfirm.textContent =
    listening && appState.activeSpeechMode === "confirm" ? "Listening..." : "Answer by voice";
  elements.talkToNavigator.textContent =
    listening && appState.activeSpeechMode === "conversation" ? "Listening..." : "Talk to navigator";
}

function startSpeechCapture(mode = "conversation", silent = false) {
  if (!appState.recognition) {
    setAssistantReply("Speech recognition is not available in this browser.", { speak: false });
    return;
  }

  clearAutoListenQueue();
  appState.assistantSpeechToken += 1;
  appState.assistantSpeaking = false;
  appState.recognitionActive = true;
  cancelSpeechPlayback();
  appState.activeSpeechMode = mode;
  updateSpeechButtons(true);
  if (!silent && mode === "conversation") {
    elements.conversationHint.textContent = "Speak naturally. I can confirm destinations and adjust the route.";
  }

  try {
    appState.recognition.start();
  } catch (error) {
    appState.recognitionActive = false;
    updateSpeechButtons(false);
    flushPendingSafetyAlert();
  }
}

function formatDistance(distanceMeters) {
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(distanceMeters)} m`;
}

function formatDuration(durationSeconds) {
  const minutes = Math.max(1, Math.round(durationSeconds / 60));
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
  const refLat = point.lat;
  const p = toMeters(point, refLat);
  const a = toMeters(start, refLat);
  const b = toMeters(end, refLat);
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  if (dx === 0 && dy === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function distanceToRouteMeters(position, coordinates) {
  if (!position || !coordinates || coordinates.length < 2) {
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

function compactPlaceLabel(name, segments = 3) {
  return String(name || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, segments)
    .join(", ");
}

function normalizeDestinationText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function splitAddressParts(text) {
  return String(text || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
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
    userRatingsTotal: Number.isFinite(Number(result.user_ratings_total ?? result.userRatingsTotal)) ? Number(result.user_ratings_total ?? result.userRatingsTotal) : null,
    phoneNumber: String(result.formatted_phone_number || result.formattedPhoneNumber || "").trim(),
    website: String(result.website || result.websiteURI || "").trim(),
    googleUrl: String(result.url || result.googleMapsURI || "").trim(),
    utcOffsetMinutes: Number.isFinite(Number(result.utc_offset_minutes ?? result.utcOffsetMinutes)) ? Number(result.utc_offset_minutes ?? result.utcOffsetMinutes) : null,
    openingHours: result.opening_hours || result.currentOpeningHours || result.regularOpeningHours || null,
    priceLevel: Number.isFinite(Number(result.price_level ?? result.priceLevel)) ? Number(result.price_level ?? result.priceLevel) : null,
    editorialSummary: String((result.editorial_summary && result.editorial_summary.overview) || (result.editorialSummary && result.editorialSummary.overview) || result.editorialSummary || "").trim(),
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
  const origin = appState.navigation.currentPosition;
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
  if (candidate.distanceMeters !== null) {
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
    : candidates.filter(
      (candidate) => candidate.distanceMeters !== null && candidate.distanceMeters - nearestDistance <= DESTINATION_OPTION_WINDOW_METERS,
    ).length;

  return closeCandidates > 1;
}

function buildChoicePrompt(query, candidates) {
  const intro = `I found ${candidates.length} nearby matches for ${query}.`;
  const options = candidates.map((candidate, index) => {
    const meta = buildChoiceMeta(candidate, ", ");
    return `Option ${index + 1}, ${candidate.optionLabel}${meta ? `, ${meta}` : ""}.`;
  }).join(" ");
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

  candidates.forEach((candidate, index) => {
    const candidateText = normalizeDestinationText(candidate.searchText || `${candidate.optionLabel || ""} ${candidate.name || ""}`);
    let score = 0;

    tokens.forEach((token) => {
      if (!candidateText.includes(token)) {
        return;
      }

      score += token.length >= 6 ? 5 : 3;
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

async function ensureSearchLocation() {
  if (appState.navigation.currentPosition) {
    return appState.navigation.currentPosition;
  }

  try {
    return await captureCurrentLocation(true);
  } catch (error) {
    return null;
  }
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

function renderRouteSteps() {
  const route = appState.navigation.route;
  if (!route || !route.steps || !route.steps.length) {
    elements.routeStepList.innerHTML = "<li>Capture your location and set a destination to begin.</li>";
    return;
  }

  elements.routeStepList.innerHTML = "";
  route.steps.slice(0, ROUTE_STEP_PREVIEW_COUNT).forEach((step) => {
    const item = document.createElement("li");
    item.textContent = step.instruction;
    elements.routeStepList.appendChild(item);
  });
}

function getPrimaryRouteStep() {
  const route = appState.navigation.route;
  if (!route || !route.steps || !route.steps.length) {
    return null;
  }
  return route.steps[0];
}

function hasGoogleMapsLoaded() {
  return Boolean(window.google && window.google.maps && window.google.maps.places);
}

function waitForGoogleMaps() {
  if (!googleMapsKey) {
    return Promise.reject(new Error("Google Maps API key is missing."));
  }

  if (hasGoogleMapsLoaded()) {
    return Promise.resolve(window.google.maps);
  }

  if (appState.navigation.googleReadyPromise) {
    return appState.navigation.googleReadyPromise;
  }

  appState.navigation.googleReadyPromise = new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (hasGoogleMapsLoaded()) {
        window.clearInterval(timer);
        resolve(window.google.maps);
        return;
      }

      if (Date.now() - startedAt >= GOOGLE_MAPS_LOAD_TIMEOUT_MS) {
        window.clearInterval(timer);
        reject(new Error("Google Maps did not load. Check the API key and enabled APIs."));
      }
    }, 120);
  });

  return appState.navigation.googleReadyPromise;
}

async function ensureGoogleServices() {
  await waitForGoogleMaps();
  const navigation = appState.navigation;

  if (!navigation.placesService) {
    navigation.placesServiceHost = navigation.placesServiceHost || document.createElement("div");
    navigation.placesService = new window.google.maps.places.PlacesService(navigation.placesServiceHost);
  }

  if (!elements.routeMap) {
    return navigation;
  }

  if (!navigation.map) {
    navigation.map = new window.google.maps.Map(elements.routeMap, {
      center: { lat: 20.5937, lng: 78.9629 },
      zoom: 4,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
      clickableIcons: false,
      gestureHandling: "greedy",
    });
  }

  if (!navigation.directionsService) {
    navigation.directionsService = new window.google.maps.DirectionsService();
  }

  if (!navigation.directionsRenderer) {
    navigation.directionsRenderer = new window.google.maps.DirectionsRenderer({
      map: navigation.map,
      suppressMarkers: true,
      preserveViewport: false,
      polylineOptions: {
        strokeColor: "#145b63",
        strokeWeight: 6,
        strokeOpacity: 0.9,
      },
    });
  }

  return navigation;
}

function setRouteMarker(markerKey, position, title, iconOptions = null) {
  const navigation = appState.navigation;
  if (!navigation.map) {
    return;
  }

  if (!position) {
    if (navigation[markerKey]) {
      navigation[markerKey].setMap(null);
      navigation[markerKey] = null;
    }
    return;
  }

  if (!navigation[markerKey]) {
    navigation[markerKey] = new window.google.maps.Marker({
      map: navigation.map,
      title,
      icon: iconOptions || undefined,
    });
  }

  navigation[markerKey].setMap(navigation.map);
  navigation[markerKey].setTitle(title || "");
  navigation[markerKey].setPosition({ lat: position.lat, lng: position.lon });
}

function clearWaypointMarkers() {
  const navigation = appState.navigation;
  (navigation.waypointMarkers || []).forEach((marker) => marker.setMap(null));
  navigation.waypointMarkers = [];
}

function syncWaypointMarkers() {
  const navigation = appState.navigation;
  if (!navigation.map) {
    return;
  }

  clearWaypointMarkers();
  (navigation.waypoints || []).forEach((waypoint, index) => {
    if (!waypoint || !Number.isFinite(waypoint.lat) || !Number.isFinite(waypoint.lon)) {
      return;
    }

    const marker = new window.google.maps.Marker({
      map: navigation.map,
      title: `Stop ${index + 1}: ${waypoint.optionLabel || waypoint.shortName || "Route stop"}`,
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 6,
        fillColor: "#f4b740",
        fillOpacity: 0.95,
        strokeColor: "#8a5b00",
        strokeOpacity: 1,
        strokeWeight: 2,
      },
      position: { lat: waypoint.lat, lng: waypoint.lon },
    });
    navigation.waypointMarkers.push(marker);
  });
}

function clearRouteMap() {
  const navigation = appState.navigation;
  if (navigation.directionsRenderer) {
    navigation.directionsRenderer.set("directions", null);
  }
}

function updateRouteMap() {
  const navigation = appState.navigation;
  if (!elements.routeMap) {
    return;
  }

  if (!navigation.map) {
    elements.routeMapStatus.textContent = googleMapsKey
      ? "Google map is loading."
      : "Add a Google Maps API key to enable the route map.";
    return;
  }

  setRouteMarker("currentMarker", navigation.currentPosition, "Current location", {
    path: window.google.maps.SymbolPath.CIRCLE,
    scale: 7,
    fillColor: "#ffffff",
    fillOpacity: 1,
    strokeColor: "#145b63",
    strokeOpacity: 1,
    strokeWeight: 3,
  });

  setRouteMarker(
    "destinationMarker",
    navigation.destination,
    navigation.destination ? (navigation.destination.optionLabel || navigation.destination.shortName) : "",
    {
      path: window.google.maps.SymbolPath.CIRCLE,
      scale: 7,
      fillColor: "#f6d6d0",
      fillOpacity: 0.98,
      strokeColor: "#9a3524",
      strokeOpacity: 1,
      strokeWeight: 3,
    },
  );

  syncWaypointMarkers();

  if (navigation.route && navigation.route.directionsResult && navigation.directionsRenderer) {
    navigation.directionsRenderer.setDirections(navigation.route.directionsResult);
    elements.routeMapStatus.textContent = navigation.route.warnings && navigation.route.warnings.length
      ? "Walking route ready. " + navigation.route.warnings[0]
      : "Showing the current shortest walking route.";
    return;
  }

  clearRouteMap();

  const bounds = new window.google.maps.LatLngBounds();
  let hasBounds = false;
  if (navigation.currentPosition) {
    bounds.extend({ lat: navigation.currentPosition.lat, lng: navigation.currentPosition.lon });
    hasBounds = true;
  }
  if (navigation.destination) {
    bounds.extend({ lat: navigation.destination.lat, lng: navigation.destination.lon });
    hasBounds = true;
  }
  (navigation.waypoints || []).forEach((waypoint) => {
    if (!waypoint || !Number.isFinite(waypoint.lat) || !Number.isFinite(waypoint.lon)) {
      return;
    }
    bounds.extend({ lat: waypoint.lat, lng: waypoint.lon });
    hasBounds = true;
  });

  if (hasBounds) {
    navigation.map.fitBounds(bounds);
    elements.routeMapStatus.textContent = navigation.currentPosition
      ? "Map is ready. Waiting for route guidance."
      : "Map is ready. Capture the current location to begin.";
  } else {
    navigation.map.setCenter({ lat: 20.5937, lng: 78.9629 });
    navigation.map.setZoom(4);
    elements.routeMapStatus.textContent = "Map will appear after a route is ready.";
  }
}

async function initializeGoogleMaps() {
  if (!elements.routeMap) {
    return;
  }

  try {
    await ensureGoogleServices();
    updateRouteMap();
  } catch (error) {
    elements.routeMapStatus.textContent = error.message;
  }
}

function getRouteStopLabel(stop) {
  return stop ? (stop.optionLabel || stop.shortName || shortPlaceLabel(stop.name) || "route stop") : "route stop";
}

function buildRouteStopsLabel(waypoints = appState.navigation.waypoints) {
  const names = (waypoints || []).map((stop) => getRouteStopLabel(stop)).filter(Boolean);
  if (!names.length) {
    return "";
  }
  if (names.length === 1) {
    return `via ${names[0]}`;
  }
  return `via ${names.length} stops`;
}

function buildDestinationPlanLabel() {
  const navigation = appState.navigation;
  if (!navigation.destination) {
    return "No destination selected";
  }

  const destinationLabel = navigation.destination.optionLabel || navigation.destination.shortName;
  const stopsLabel = buildRouteStopsLabel(navigation.waypoints);
  return stopsLabel ? `${destinationLabel} ${stopsLabel}` : destinationLabel;
}

function buildRouteStopsSentence() {
  const names = (appState.navigation.waypoints || []).map((stop) => getRouteStopLabel(stop)).filter(Boolean);
  if (!names.length) {
    return "";
  }
  if (names.length === 1) {
    return `We will also stop at ${names[0]} before the final destination.`;
  }
  return `We will also stop at ${joinNaturalList(names)} before the final destination.`;
}

function renderNavigationOverview() {
  const navigation = appState.navigation;
  const location = navigation.currentPosition;
  const route = navigation.route;
  const nextStep = getPrimaryRouteStep();

  if (location) {
    const accuracyText = location.accuracy ? `accuracy ${Math.round(location.accuracy)} m` : "location locked";
    elements.locationText.textContent = `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)} (${accuracyText})`;
  } else {
    elements.locationText.textContent = "Not captured yet";
  }

  elements.destinationLabel.textContent = buildDestinationPlanLabel();

  if (navigation.arrived && navigation.destination) {
    elements.routeDistance.textContent = "Arrived";
    elements.routeEta.textContent = "Here now";
    elements.nextRouteInstruction.textContent = `You are near ${navigation.destination.optionLabel || navigation.destination.shortName}.`;
  } else if (route) {
    elements.routeDistance.textContent = formatDistance(route.distance);
    elements.routeEta.textContent = formatDuration(route.duration);
    elements.nextRouteInstruction.textContent = nextStep
      ? nextStep.instruction
      : "Keep following the current path.";
  } else {
    elements.routeDistance.textContent = "Waiting for route";
    elements.routeEta.textContent = "Waiting for route";
    elements.nextRouteInstruction.textContent = "No active route yet.";
  }

  renderRouteSteps();
  updateRouteMap();
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

function buildSafetyVoiceGuidance(scene) {
  if (!scene) {
    return { text: "Waiting for live safety guidance.", key: "idle", urgent: false };
  }

  const urgent = ["STOP", "MOVE_LEFT", "MOVE_RIGHT", "SLOW"].includes(scene.command);
  return {
    text: scene.spoken_message || (urgent ? "Obstacle ahead." : "Path seems clear. Continue carefully."),
    key: buildSafetyAlertKey(scene),
    urgent,
  };
}

function speakLatestSafetyGuidance(force = true) {
  const safetyGuidance = buildSafetyVoiceGuidance(appState.latestSafetyScene);
  speakSafetyGuidance(safetyGuidance.text, safetyGuidance.key, safetyGuidance.urgent, force);
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
  speakLatestSafetyGuidance(true);
}

function kickstartVoiceGuidance() {
  appState.userActivatedAudio = true;
  if (!appState.latestSafetyScene) {
    return;
  }
  finalizeVoiceKickstart();
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
  elements.commandCard.className = `command-card urgency-${scene.urgency || "low"}`;
  elements.urgencyBadge.textContent = prettyLabel(scene.urgency);
  setBadgeClass(elements.urgencyBadge, scene.urgency || "neutral");

  if (scene.error) {
    elements.connectionBadge.textContent = "Camera issue";
    setBadgeClass(elements.connectionBadge, "high");
  } else {
    const isLive = scene.running || appState.streamLoaded;
    elements.connectionBadge.textContent = isLive ? "Live" : "Idle";
    setBadgeClass(elements.connectionBadge, isLive ? "low" : "neutral");
  }

  const safetyGuidance = buildSafetyVoiceGuidance(scene);
  speakSafetyGuidance(safetyGuidance.text, safetyGuidance.key, safetyGuidance.urgent, false);
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
function renderConfirmationChoices(candidates) {
  elements.confirmationChoices.innerHTML = "";
  if (!candidates || !candidates.length) {
    elements.confirmationChoices.classList.add("hidden");
    elements.confirmDestination.classList.remove("hidden");
    return;
  }

  elements.confirmDestination.classList.add("hidden");
  elements.confirmationChoices.classList.remove("hidden");

  candidates.forEach((candidate, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice-button";
    button.dataset.choiceIndex = String(index);
    const choiceMeta = buildChoiceMeta(candidate);
    button.innerHTML = `
      <strong>Option ${index + 1}</strong>
      <span>${candidate.optionLabel}</span>
      <small>${choiceMeta || "Tap to choose this place"}</small>
    `;
    elements.confirmationChoices.appendChild(button);
  });
}

function showDestinationChoices(candidates, query, source) {
  appState.navigation.pendingDestination = null;
  appState.navigation.pendingCandidates = candidates;
  elements.confirmationCard.classList.remove("hidden");
  elements.confirmationText.textContent = `I found ${candidates.length} nearby matches for ${query}. Choose by option number or by locality name.`;
  renderConfirmationChoices(candidates);
  setRouteStatus("Choose place", "medium");
  setAssistantReply(buildChoicePrompt(query, candidates), {
    speak: source === "voice",
    force: true,
  });

  if (source === "voice") {
    queueAutoListen("confirm");
  }
}

function showConfirmation(candidate, transcript, source) {
  appState.navigation.pendingCandidates = [];
  appState.navigation.pendingDestination = candidate;
  elements.confirmationCard.classList.remove("hidden");
  const choiceMeta = buildChoiceMeta(candidate, ", ");
  elements.confirmationText.textContent = `I heard "${transcript}". Should I start walking guidance to ${candidate.optionLabel || candidate.name}${choiceMeta ? `, ${choiceMeta}` : ""}?`;
  renderConfirmationChoices([]);
  setRouteStatus("Confirm", "medium");
  setAssistantReply(`I found ${candidate.optionLabel || candidate.shortName}${choiceMeta ? `, ${choiceMeta}` : ""}. Should I start walking guidance there?`, {
    speak: source === "voice",
    force: true,
  });

  if (source === "voice") {
    queueAutoListen("confirm");
  }
}

function hideConfirmation() {
  elements.confirmationCard.classList.add("hidden");
  elements.confirmationChoices.innerHTML = "";
  elements.confirmationChoices.classList.add("hidden");
  elements.confirmDestination.classList.remove("hidden");
  appState.navigation.pendingDestination = null;
  appState.navigation.pendingCandidates = [];
}

function selectPendingCandidate(index, source = "typed") {
  const candidate = appState.navigation.pendingCandidates[index];
  if (!candidate) {
    setAssistantReply("Please choose one of the listed options first.", {
      speak: source === "voice",
      force: true,
    });
    if (source === "voice") {
      queueAutoListen("confirm");
    }
    return;
  }

  elements.destinationInput.value = candidate.optionLabel || candidate.shortName;
  activateDestination(candidate);
}

function isYes(text) {
  return /\b(yes|yeah|yep|correct|confirm|go ahead|start|do it|that one)\b/i.test(text);
}

function isNo(text) {
  return /\b(no|nope|wrong|cancel|not that|try again|different place)\b/i.test(text);
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

function detectIntent(text) {
  const transcript = String(text || "").trim();
  const lowered = transcript.toLowerCase();
  const routeSearchIntent = parseRouteSearchIntent(transcript);
  const placeInfoTopic = detectPlaceInfoTopic(transcript);
  const routeSearchFollowUp = detectRouteSearchFollowUp(transcript, placeInfoTopic);
  const stopoverControlIntent = detectStopoverControlIntent(transcript);
  const waypointInfoIntent = detectWaypointInfoIntent(transcript, placeInfoTopic);

  if (!transcript) {
    return { type: "unknown" };
  }

  if (/\b(what can you do|help me|how can you help|what can i ask|what do you help with)\b/i.test(lowered)) {
    return { type: "capabilities" };
  }

  if (appState.navigation.pendingCandidates && appState.navigation.pendingCandidates.length) {
    const choiceIndex = parseChoiceIndex(transcript, appState.navigation.pendingCandidates.length);
    const phraseIndex = findCandidateByPhrase(transcript, appState.navigation.pendingCandidates);
    const resolvedIndex = choiceIndex >= 0 ? choiceIndex : phraseIndex;

    if (placeInfoTopic) {
      if (resolvedIndex >= 0) {
        return { type: "place_info", topic: placeInfoTopic, index: resolvedIndex };
      }
      if (isNo(transcript)) {
        return { type: "confirm_no" };
      }
      return { type: "place_info_needs_choice", topic: placeInfoTopic };
    }

    if (choiceIndex >= 0) {
      return { type: "choose_option", index: choiceIndex };
    }

    if (phraseIndex >= 0) {
      return { type: "choose_option", index: phraseIndex };
    }

    if (isNo(transcript)) {
      return { type: "confirm_no" };
    }
    return { type: "choice_unclear" };
  }

  if (appState.navigation.pendingDestination) {
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

  if (stopoverControlIntent) {
    return stopoverControlIntent;
  }

  if (routeSearchFollowUp) {
    return routeSearchFollowUp;
  }

  if (routeSearchIntent) {
    return routeSearchIntent;
  }

  if (waypointInfoIntent) {
    return waypointInfoIntent;
  }

  if (placeInfoTopic) {
    if (appState.navigation.destination) {
      return { type: "place_info", topic: placeInfoTopic };
    }
    return { type: "place_info_no_context", topic: placeInfoTopic };
  }

  if (/\b(where are you taking me|what is my route|what's my route|route summary|full route|what stops are on my route|what stopovers are on my route|route plan|travel plan|what is the plan)\b/i.test(lowered)) {
    return { type: "route_plan" };
  }

  if (looksLikeDestinationRequest(transcript)) {
    return { type: "destination", query: transcript };
  }

  if (/\b(shortest route|correct me|bring me back|reroute|route again|wrong path|wrong route|lost|off route)\b/i.test(lowered)) {
    return { type: "shortest_route" };
  }

  if (/\b(how much farther|how far|distance left|time left|eta|remaining|how long)\b/i.test(lowered)) {
    return { type: "progress" };
  }

  if (/\b(repeat|say that again|what next|next step|which way now|where next)\b/i.test(lowered)) {
    return { type: "repeat_step" };
  }

  if (/\b(stop navigation|clear route|cancel route|stop route)\b/i.test(lowered)) {
    return { type: "clear_route" };
  }

  if (/\b(refresh route|update route|recheck route)\b/i.test(lowered)) {
    return { type: "refresh_route" };
  }

  if (/\b(where am i|current location|my location)\b/i.test(lowered)) {
    return { type: "location_status" };
  }

  if (/\b(what is ahead|what's ahead|what is in front|what's in front|is the path clear|is it safe|safe side|obstacle)\b/i.test(lowered)) {
    return { type: "scene_status" };
  }

  if (!appState.navigation.destination && looksLikeBareDestination(transcript)) {
    return { type: "destination", query: transcript };
  }

  return { type: "unsupported" };
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
        fields: ["name", "formatted_address", "geometry", "address_components", "vicinity", "place_id", "types", "business_status", "formatted_phone_number", "website", "url", "rating", "user_ratings_total", "utc_offset_minutes", "opening_hours", "price_level", "editorial_summary", "delivery", "dine_in", "takeout", "reservable", "serves_breakfast", "serves_brunch", "serves_lunch", "serves_dinner", "serves_vegetarian_food", "serves_beer", "serves_wine", "serves_coffee", "serves_dessert"],
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
    const key = result.place_id || (result.name || "place") + ":" + lat + ":" + lon;
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
      } catch (error) {
        return result;
      }
    }),
  );

  return dedupePlaceResults([...detailedResults, ...rawResults.slice(limit)]);
}

async function geocodeDestination(query, origin = null, nearestRequested = false) {
  const navigation = await ensureGoogleServices();
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
    candidate && (
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

function syncPlaceCandidate(candidate) {
  if (!candidate || !candidate.placeId) {
    return candidate;
  }

  const navigation = appState.navigation;
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
  navigation.placeDetailsCache[candidate.placeId] = { ...(navigation.placeDetailsCache[candidate.placeId] || {}), ...candidate };
  return candidate;
}

async function ensureCandidateDetails(candidate) {
  if (!candidate) {
    return null;
  }

  if (!candidate.placeId) {
    return candidate;
  }

  const cached = appState.navigation.placeDetailsCache[candidate.placeId];
  if (cached) {
    return syncPlaceCandidate({ ...candidate, ...cached, distanceMeters: candidate.distanceMeters ?? cached.distanceMeters ?? null });
  }

  if (hasRichPlaceDetails(candidate)) {
    return syncPlaceCandidate(candidate);
  }

  try {
    const navigation = await ensureGoogleServices();
    const detail = await requestPlaceDetails(navigation.placesService, candidate.placeId);
    if (!detail) {
      return candidate;
    }

    const merged = {
      ...candidate,
      ...buildCandidateDetails(detail),
      distanceMeters: candidate.distanceMeters ?? null,
    };
    return syncPlaceCandidate(merged);
  } catch (error) {
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
  } catch (error) {
    return String(url || "").trim();
  }
}

function formatPlaceTypeLabel(candidate) {
  const ignoredTypes = new Set(["point_of_interest", "establishment", "food", "store", "premise", "political"]);
  const preferredOrder = ["bank", "atm", "hospital", "pharmacy", "restaurant", "cafe", "shopping_mall", "bus_station", "train_station", "subway_station", "lodging", "school", "university", "park"];
  const types = Array.isArray(candidate && candidate.types) ? candidate.types.filter((type) => !ignoredTypes.has(type)) : [];
  const preferred = preferredOrder.find((type) => types.includes(type)) || types[0];
  return preferred ? prettyLabel(preferred).toLowerCase() : "place";
}

function formatBusinessStatusLabel(status) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "CLOSED_PERMANENTLY") {
    return "permanently closed";
  }
  if (normalized === "CLOSED_TEMPORARILY") {
    return "temporarily closed";
  }
  if (normalized === "OPERATIONAL") {
    return "operating normally";
  }
  return "";
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
    features.push("table reservations");
  }
  return features;
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
  const businessStatus = formatBusinessStatusLabel(candidate.businessStatus);
  if (businessStatus && businessStatus !== "operating normally") {
    parts.push("Google marks it as " + businessStatus + ".");
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

function buildPlaceInfoReply(candidate, topic) {
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

function formatPlaceInfoTopicLabel(topic) {
  switch (topic) {
    case "hours":
      return "whether it is open";
    case "address":
      return "the exact address";
    case "rating":
      return "the Google rating";
    case "budget":
      return "the budget";
    case "food":
      return "what kind of place it is and what it offers";
    case "phone":
      return "the phone number";
    case "website":
      return "the website";
    default:
      return "more about that place";
  }
}

function buildPlaceInfoChoiceReply(topic) {
  return "I found multiple matching branches. Say option 1, option 2, option 3, or say the locality name, and I will tell you " + formatPlaceInfoTopicLabel(topic) + ".";
}

async function handlePlaceInfoIntent(intent, source = "voice") {
  let candidate = null;
  if (Number.isInteger(intent.index)) {
    candidate = appState.navigation.pendingCandidates[intent.index] || null;
  } else if (intent.pending && appState.navigation.pendingDestination) {
    candidate = appState.navigation.pendingDestination;
  } else if (appState.navigation.pendingDestination) {
    candidate = appState.navigation.pendingDestination;
  } else if (appState.navigation.destination) {
    candidate = appState.navigation.destination;
  }

  if (!candidate) {
    setAssistantReply("Tell me the destination first, or choose one of the listed branches, then I can answer place details for you.", {
      speak: source === "voice",
      force: true,
    });
    return;
  }

  const detailedCandidate = await ensureCandidateDetails(candidate);
  const message = buildPlaceInfoReply(detailedCandidate, intent.topic);
  setAssistantReply(message, {
    speak: source === "voice",
    force: true,
  });

  if (source === "voice" && appState.navigation.pendingCandidates && appState.navigation.pendingCandidates.length) {
    queueAutoListen("confirm", 900);
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
    key: normalizeAlertToken(label, "route_place"),
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
  if (!routeContext && !(appState.navigation.route && wantsAdd)) {
    return null;
  }

  if (/\b(route summary|route plan|what stops|remove stop|skip stop|drop stop|cancel stop)\b/.test(lowered)) {
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

function routeCoordinateToPoint(coordinate) {
  return { lat: Number(coordinate[1]), lon: Number(coordinate[0]) };
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
  return points.filter((point) => {
    const key = point.lat.toFixed(5) + ":" + point.lon.toFixed(5);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, ROUTE_AMENITY_MAX_SAMPLES);
}

function buildRouteAmenityCacheKey(intent) {
  const navigation = appState.navigation;
  const routeDistance = navigation.route && navigation.route.distance ? Math.round(navigation.route.distance / 50) : 0;
  const destinationKey = navigation.destination && navigation.destination.placeId ? navigation.destination.placeId : "no-destination";
  const waypointKey = (navigation.waypoints || []).map((stop) => stop.placeId || `${stop.lat}:${stop.lon}`).join("|") || "direct";
  return [intent.config.key, intent.openNow ? "open" : "any", destinationKey, waypointKey, routeDistance].join(":");
}

async function searchRouteAmenities(intent) {
  const navigation = appState.navigation;
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

  const services = await ensureGoogleServices();
  const samplePoints = getRouteSamplePoints(navigation.route, navigation.currentPosition);
  const rawResults = (await Promise.all(samplePoints.map(async (point) => {
    try {
      return await requestNearbySearch(services.placesService, {
        location: new window.google.maps.LatLng(point.lat, point.lon),
        radius: ROUTE_SEARCH_RADIUS_METERS,
        type: config.type || undefined,
        keyword: config.keyword || intent.query,
        openNow: intent.openNow ? true : undefined,
      });
    } catch (error) {
      return [];
    }
  }))).flat();

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
    results.push(await ensureCandidateDetails(candidate));
  }

  navigation.routeSearchCache[cacheKey] = { at: Date.now(), results };
  return results;
}

function describeRouteAmenityCandidate(candidate, config) {
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

function rememberRouteSearch(intent, results) {
  appState.navigation.lastRouteSearch = {
    query: intent.query,
    config: intent.config,
    openNow: intent.openNow,
    pendingAction: intent.type === "route_add_search" ? "add" : "info",
    selectedIndex: results.length === 1 ? 0 : null,
    results: results || [],
    createdAt: Date.now(),
  };
}

function buildRouteAmenityReply(intent, results) {
  const config = intent.config || inferRouteSearchConfig(intent.query);
  if (!config) {
    return "I could not understand which place you want on the route.";
  }
  if (!results.length) {
    const qualifier = intent.openNow ? " open right now" : "";
    return `I could not find any ${config.plural}${qualifier} along your current route.`;
  }

  const descriptions = results.slice(0, DESTINATION_OPTION_LIMIT).map((candidate, index) => {
    const prefix = `Option ${index + 1} is `;
    return prefix + describeRouteAmenityCandidate(candidate, config) + ".";
  });

  const hint = intent.type === "route_add_search"
    ? (results.length === 1
      ? "Say add it if you want me to include this stop on the route."
      : "Say add option 1, add option 2, add option 3, or say the locality name if you want me to include one as a stop.")
    : (results.length === 1
      ? "You can ask me if it is open, ask for the budget or address, or say add it to my route."
      : "You can ask about option 1, option 2, or say add option 1 to include it on the route.");

  return `I found ${results.length} ${config.plural} along your route. ${descriptions.join(" ")} ${hint}`.trim();
}

function buildRouteResultChoiceReply(mode, topic = "summary") {
  const examples = ((appState.navigation.lastRouteSearch && appState.navigation.lastRouteSearch.results) || [])
    .map((candidate) => candidate.localityLabel || candidate.optionLabel)
    .filter(Boolean)
    .slice(0, 2)
    .join(" or ");
  if (mode === "add") {
    return examples
      ? `I found a few route-side matches. Say add option 1, add option 2, or say the locality name like ${examples}.`
      : "I found a few route-side matches. Say add option 1, add option 2, or add option 3 so I know which stop to include.";
  }
  const topicLabel = formatPlaceInfoTopicLabel(topic);
  return examples
    ? `I found a few route-side matches. Say option 1, option 2, or say the locality name like ${examples}, and I will tell you ${topicLabel}.`
    : `I found a few route-side matches. Say option 1, option 2, or option 3, and I will tell you ${topicLabel}.`;
}

function detectRouteSearchFollowUp(text, placeInfoTopic) {
  const lastSearch = appState.navigation.lastRouteSearch;
  if (!lastSearch || !Array.isArray(lastSearch.results) || !lastSearch.results.length) {
    return null;
  }

  const lowered = String(text || "").toLowerCase();
  const choiceIndex = parseChoiceIndex(text, lastSearch.results.length);
  const phraseIndex = findCandidateByPhrase(text, lastSearch.results);
  let resolvedIndex = choiceIndex >= 0 ? choiceIndex : phraseIndex;
  const mentionsReference = /\b(this one|that one|this place|that place|this stop|that stop|first one|second one|third one|last one|other one|another one|the one)\b/.test(lowered);

  if (resolvedIndex < 0 && Number.isInteger(lastSearch.selectedIndex) && mentionsReference) {
    resolvedIndex = lastSearch.selectedIndex;
  }
  if (resolvedIndex < 0 && lastSearch.results.length === 1 && (mentionsReference || /\b(it|place|stop|shop)\b/.test(lowered))) {
    resolvedIndex = 0;
  }

  const wantsAdd = wantsAddRouteStop(lowered) || /\b(add it|make it a stop|include it)\b/.test(lowered);
  const wantsSummary = /\b(tell me about|what about|describe|summary|which one is|what is this|what is that)\b/.test(lowered);

  if ((placeInfoTopic || wantsSummary) && resolvedIndex >= 0) {
    return { type: "route_result_info", index: resolvedIndex, topic: placeInfoTopic || "summary" };
  }

  if ((placeInfoTopic || wantsSummary) && lastSearch.results.length === 1) {
    return { type: "route_result_info", index: 0, topic: placeInfoTopic || "summary" };
  }

  if (wantsAdd && resolvedIndex >= 0) {
    return { type: "route_add_existing", index: resolvedIndex };
  }

  if (wantsAdd && lastSearch.results.length === 1) {
    return { type: "route_add_existing", index: 0 };
  }

  if (lastSearch.pendingAction === "add" && resolvedIndex >= 0) {
    return { type: "route_add_existing", index: resolvedIndex };
  }

  if (lastSearch.pendingAction === "add" && /\b(yes|okay|go ahead|do it|add it)\b/.test(lowered) && lastSearch.results.length === 1) {
    return { type: "route_add_existing", index: 0 };
  }

  if ((placeInfoTopic || wantsSummary) && lastSearch.results.length > 1) {
    return { type: "route_result_choice_unclear", mode: "info", topic: placeInfoTopic || "summary" };
  }

  if ((wantsAdd || lastSearch.pendingAction === "add") && lastSearch.results.length > 1 && (mentionsReference || /\boption\b/.test(lowered))) {
    return { type: "route_result_choice_unclear", mode: "add" };
  }

  if (resolvedIndex >= 0) {
    return { type: "route_result_info", index: resolvedIndex, topic: "summary" };
  }

  return null;
}

function detectStopoverControlIntent(text) {
  const lowered = String(text || "").toLowerCase();
  if (/\b(where are you taking me|what is my route|what's my route|route summary|full route|what stops are on my route|what stopovers are on my route|route plan|travel plan|what is the plan)\b/.test(lowered)) {
    return { type: "route_plan" };
  }

  if (/\b(remove|delete|skip|cancel|drop)\b/.test(lowered) && /\b(stop|stopover|waypoint)\b/.test(lowered)) {
    const stops = appState.navigation.waypoints || [];
    const choiceIndex = parseChoiceIndex(text, stops.length || DESTINATION_OPTION_LIMIT);
    const phraseIndex = stops.length ? findCandidateByPhrase(text, stops) : -1;
    const resolvedIndex = choiceIndex >= 0 ? choiceIndex : phraseIndex;
    return { type: "remove_stopover", index: resolvedIndex >= 0 ? resolvedIndex : null };
  }

  return null;
}

function detectWaypointInfoIntent(text, placeInfoTopic) {
  const stops = appState.navigation.waypoints || [];
  if (!placeInfoTopic || !stops.length) {
    return null;
  }

  if (!/\b(stop|stopover|waypoint|added place|added stop)\b/i.test(text)) {
    return null;
  }

  const choiceIndex = parseChoiceIndex(text, stops.length);
  const phraseIndex = findCandidateByPhrase(text, stops);
  const resolvedIndex = choiceIndex >= 0 ? choiceIndex : phraseIndex;
  return {
    type: "route_stop_info",
    topic: placeInfoTopic,
    index: resolvedIndex >= 0 ? resolvedIndex : stops.length - 1,
  };
}

async function handleRouteAmenityIntent(intent, source = "voice") {
  if (!appState.navigation.route || !appState.navigation.destination) {
    setAssistantReply("Set a destination first, then I can check what is available on your route.", {
      speak: source === "voice",
      force: true,
    });
    return;
  }

  const results = await searchRouteAmenities(intent);
  rememberRouteSearch(intent, results);
  setAssistantReply(buildRouteAmenityReply(intent, results), {
    speak: source === "voice",
    force: true,
  });
}

async function handleRouteResultInfoIntent(intent, source = "voice") {
  const lastSearch = appState.navigation.lastRouteSearch;
  if (!lastSearch || !Array.isArray(lastSearch.results) || !lastSearch.results[intent.index]) {
    setAssistantReply("Ask me to search for a place on your route first, then I can tell you more about it.", {
      speak: source === "voice",
      force: true,
    });
    return;
  }

  const detailedCandidate = await ensureCandidateDetails(lastSearch.results[intent.index]);
  const results = [...lastSearch.results];
  results[intent.index] = detailedCandidate;
  appState.navigation.lastRouteSearch = {
    ...lastSearch,
    results,
    selectedIndex: intent.index,
  };
  setAssistantReply(buildPlaceInfoReply(detailedCandidate, intent.topic || "summary"), {
    speak: source === "voice",
    force: true,
  });
}

async function addRouteStopover(candidate, source = "voice") {
  const navigation = appState.navigation;
  if (!navigation.destination) {
    setAssistantReply("Tell me the destination first, then I can add a stop on the route.", {
      speak: source === "voice",
      force: true,
    });
    return;
  }

  const detailedCandidate = await ensureCandidateDetails(candidate);
  if (!detailedCandidate || !Number.isFinite(detailedCandidate.lat) || !Number.isFinite(detailedCandidate.lon)) {
    setAssistantReply("I could not lock that stop onto the route yet. Please try another nearby option.", {
      speak: source === "voice",
      force: true,
    });
    return;
  }

  const label = getRouteStopLabel(detailedCandidate);
  const destinationLabel = navigation.destination.optionLabel || navigation.destination.shortName;
  if (navigation.destination.placeId && detailedCandidate.placeId && navigation.destination.placeId === detailedCandidate.placeId) {
    setAssistantReply(label + " is already the final destination.", {
      speak: source === "voice",
      force: true,
    });
    return;
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
    setAssistantReply(label + ` is already on the route as stop ${existingIndex + 1}.`, {
      speak: source === "voice",
      force: true,
    });
    return;
  }

  if ((navigation.waypoints || []).length >= MAX_ROUTE_STOPOVERS) {
    setAssistantReply(`I can keep up to ${MAX_ROUTE_STOPOVERS} extra stops at a time. Remove one first if you want a new stop.`, {
      speak: source === "voice",
      force: true,
    });
    return;
  }

  navigation.waypoints = [...(navigation.waypoints || []), detailedCandidate];
  navigation.arrived = false;
  navigation.lastOffRouteAt = 0;
  navigation.routeSearchCache = {};
  renderNavigationOverview();
  setAssistantReply(`I added ${label} as a stop before ${destinationLabel}. I am updating the walking route now.`, {
    speak: source === "voice",
    force: true,
  });
  await fetchRoute("stop_added");
}

async function handleRouteAddSearchIntent(intent, source = "voice") {
  if (!appState.navigation.route || !appState.navigation.destination) {
    setAssistantReply("Set a destination first, then I can find a stop to add on the route.", {
      speak: source === "voice",
      force: true,
    });
    return;
  }

  const results = await searchRouteAmenities(intent);
  rememberRouteSearch(intent, results);
  if (!results.length) {
    setAssistantReply(buildRouteAmenityReply(intent, results), {
      speak: source === "voice",
      force: true,
    });
    return;
  }

  if (intent.nearestRequested || results.length === 1) {
    appState.navigation.lastRouteSearch = {
      ...appState.navigation.lastRouteSearch,
      selectedIndex: 0,
    };
    await addRouteStopover(results[0], source);
    return;
  }

  setAssistantReply(buildRouteAmenityReply(intent, results), {
    speak: source === "voice",
    force: true,
  });
}

async function handleRouteAddExistingIntent(intent, source = "voice") {
  const lastSearch = appState.navigation.lastRouteSearch;
  if (!lastSearch || !Array.isArray(lastSearch.results) || !lastSearch.results[intent.index]) {
    setAssistantReply("Search for a route-side place first, then tell me which option to add.", {
      speak: source === "voice",
      force: true,
    });
    return;
  }

  appState.navigation.lastRouteSearch = {
    ...lastSearch,
    selectedIndex: intent.index,
  };
  await addRouteStopover(lastSearch.results[intent.index], source);
}

async function handleRouteStopInfoIntent(intent, source = "voice") {
  const stops = appState.navigation.waypoints || [];
  const candidate = stops[intent.index];
  if (!candidate) {
    setAssistantReply("There is no matching stop on the route yet.", {
      speak: source === "voice",
      force: true,
    });
    return;
  }

  const detailedCandidate = await ensureCandidateDetails(candidate);
  const nextStops = [...stops];
  nextStops[intent.index] = detailedCandidate;
  appState.navigation.waypoints = nextStops;
  setAssistantReply(buildPlaceInfoReply(detailedCandidate, intent.topic || "summary"), {
    speak: source === "voice",
    force: true,
  });
}

async function handleRemoveStopoverIntent(intent, source = "voice") {
  const navigation = appState.navigation;
  const stops = [...(navigation.waypoints || [])];
  if (!stops.length) {
    setAssistantReply("There is no extra stop on the route right now.", {
      speak: source === "voice",
      force: true,
    });
    return;
  }

  const index = Number.isInteger(intent.index) && intent.index >= 0 && intent.index < stops.length
    ? intent.index
    : stops.length - 1;
  const [removed] = stops.splice(index, 1);
  navigation.waypoints = stops;
  navigation.routeSearchCache = {};
  navigation.arrived = false;
  renderNavigationOverview();
  setAssistantReply(`I removed ${getRouteStopLabel(removed)} from the route. I am updating the walking path now.`, {
    speak: source === "voice",
    force: true,
  });
  await fetchRoute("stop_removed");
}

function buildRoutePlanReply() {
  const navigation = appState.navigation;
  if (!navigation.destination) {
    return "There is no active walking route yet.";
  }

  const destinationLabel = navigation.destination.optionLabel || navigation.destination.shortName;
  const parts = [`I am guiding you to ${destinationLabel}.`];
  if (navigation.route) {
    parts.push(describeProgress(navigation.route));
  }
  const nextStep = getPrimaryRouteStep();
  if (nextStep) {
    parts.push(`Next, ${nextStep.instruction}`);
  }
  return parts.join(" ");
}

function handleRouteSearchMissingQuery(source = "voice") {
  setAssistantReply(
    "Tell me what kind of place you want on the route. I can search for things like ATM, bank, cafe, restaurant, restroom, pharmacy, bus stop, petrol pump, hotel, grocery store, brand names, or another place you mention.",
    {
      speak: source === "voice",
      force: true,
    },
  );
}

async function handleDestinationRequest(rawValue, source = "typed", confidence = 1) {
  const spokenQuery = String(rawValue || "").trim();
  const nearestRequested = /\b(nearest|nearby|closest)\b/i.test(spokenQuery);
  const query = normalizeDestinationQuery(rawValue);
  if (!query) {
    setAssistantReply("Please tell me the place again so I can set the walk.", {
      speak: source !== "typed",
      force: true,
    });
    return;
  }

  setRouteStatus("Searching", "medium");
  const origin = await ensureSearchLocation();
  if (!origin) {
    setAssistantReply("I need your current location before I can compare nearby walking destinations.", {
      speak: source !== "typed",
      force: true,
    });
    return;
  }

  setAssistantReply(`Looking for ${nearestRequested ? `the nearest ${query}` : query} near you.`, {
    speak: source === "voice",
    force: true,
  });

  try {
    const rankedCandidates = rankDestinationCandidates(await geocodeDestination(query, origin, nearestRequested), query);
    if (!rankedCandidates.length) {
      throw new Error("I could not find that destination. Please say it in another way.");
    }

    const candidates = rankedCandidates.slice(0, DESTINATION_OPTION_LIMIT);
    const nearestCandidate = candidates[0];
    if (nearestCandidate.distanceMeters !== null && nearestCandidate.distanceMeters > MAX_WALKING_DESTINATION_METERS) {
      throw new Error(`${nearestCandidate.optionLabel} is about ${formatDistance(nearestCandidate.distanceMeters)} away, which is too far for walking guidance. Please choose a nearer place.`);
    }

    if (shouldOfferDestinationChoices(query, candidates, nearestRequested)) {
      showDestinationChoices(candidates, query, source);
      return;
    }

    const candidate = candidates[0];
    const mustConfirm = source === "voice" || confidence < SPEECH_CONFIRMATION_THRESHOLD;
    if (mustConfirm) {
      showConfirmation(candidate, candidate.optionLabel || query, source);
      return;
    }

    showConfirmation(candidate, candidate.optionLabel || query, source);
  } catch (error) {
    setRouteStatus("Search error", "high");
    setAssistantReply(error.message, { speak: source !== "typed", force: true });
  }
}

async function activateDestination(candidate) {
  const navigation = appState.navigation;
  let nextDestination = candidate;
  try {
    nextDestination = (await ensureCandidateDetails(candidate)) || candidate;
  } catch (error) {
    nextDestination = candidate;
  }

  navigation.destination = nextDestination;
  navigation.waypoints = [];
  navigation.route = null;
  navigation.arrived = false;
  navigation.lastOffRouteAt = 0;
  navigation.routeSearchCache = {};
  navigation.lastRouteSearch = null;
  hideConfirmation();
  renderNavigationOverview();
  setRouteStatus("Locating", "medium");
  setAssistantReply("Alright, I am setting the shortest walking route to " + (nextDestination.optionLabel || nextDestination.shortName) + ".", {
    speak: true,
    force: true,
  });

  try {
    await captureCurrentLocation(true);
    await fetchRoute("new_destination");
  } catch (error) {
    setAssistantReply(error.message, { speak: true, force: true });
  }
}

function describeProgress(route) {
  if (!route) {
    return "There is no active route yet.";
  }
  const stopText = buildRouteStopsSentence();
  return `From here, it is about ${formatDistance(route.distance)} and around ${formatDuration(route.duration)} to go.${stopText ? ` ${stopText}` : ""}`;
}

function announceRouteUpdate(reason, previousRoute = null) {
  const navigation = appState.navigation;
  const route = navigation.route;
  const nextStep = getPrimaryRouteStep();
  if (!route) {
    return;
  }

  let message = describeProgress(route);
  if (reason === "new_destination") {
    message = `All set. I am guiding you to ${navigation.destination.optionLabel || navigation.destination.shortName} on the shortest walking route. ${describeProgress(route)} ${nextStep ? `First, ${nextStep.instruction}` : ""}`.trim();
  } else if (reason === "off_route") {
    const extraDistance = previousRoute ? Math.max(0, route.distance - previousRoute.distance) : 0;
    message = `I noticed we moved away from the path, so I changed the route. ${describeProgress(route)}${extraDistance > 20 ? ` That adds about ${formatDistance(extraDistance)} more walking.` : ""} ${nextStep ? `Now, ${nextStep.instruction}` : ""}`.trim();
  } else if (reason === "shortest_correction") {
    message = `I corrected us back to the shortest walking route. ${describeProgress(route)} ${nextStep ? `Next, ${nextStep.instruction}` : ""}`.trim();
  } else if (reason === "manual_refresh") {
    message = `I refreshed the route. ${describeProgress(route)} ${nextStep ? `Next, ${nextStep.instruction}` : ""}`.trim();
  } else if (reason === "stop_added") {
    const latestStop = navigation.waypoints && navigation.waypoints.length
      ? getRouteStopLabel(navigation.waypoints[navigation.waypoints.length - 1])
      : "the extra stop";
    message = `I added ${latestStop} to the walking route. ${describeProgress(route)} ${nextStep ? `Next, ${nextStep.instruction}` : ""}`.trim();
  } else if (reason === "stop_removed") {
    message = `I updated the walking route after removing the extra stop. ${describeProgress(route)} ${nextStep ? `Next, ${nextStep.instruction}` : ""}`.trim();
  }

  elements.journeyMessage.textContent = message;
  if (reason !== "progress_refresh") {
    setAssistantReply(message, { speak: true, force: true });
  }
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
    legs: legs.map((leg) => ({
      distance: leg.distance ? Number(leg.distance.value || 0) : 0,
      duration: leg.duration ? Number(leg.duration.value || 0) : 0,
      endAddress: String(leg.end_address || "").trim(),
    })),
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

async function fetchRoute(reason = "manual_refresh") {
  const navigation = appState.navigation;
  if (navigation.isFetchingRoute || !navigation.destination) {
    return;
  }

  const previousRoute = navigation.route
    ? { distance: navigation.route.distance, duration: navigation.route.duration }
    : null;

  navigation.isFetchingRoute = true;
  setRouteStatus("Routing", "medium");

  try {
    await ensureGoogleServices();

    if (!navigation.currentPosition) {
      await captureCurrentLocation(true);
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
    navigation.lastRouteOrigin = { ...origin };
    setRouteStatus("Guiding", "low");
    renderNavigationOverview();
    announceRouteUpdate(reason, previousRoute);
  } catch (error) {
    setRouteStatus("Route error", "high");
    setAssistantReply(buildDirectionsErrorMessage(error), { speak: true, force: true });
  } finally {
    navigation.isFetchingRoute = false;
  }
}

function markArrived() {
  const navigation = appState.navigation;
  if (!navigation.destination || navigation.arrived) {
    return;
  }

  navigation.arrived = true;
  setRouteStatus("Arrived", "low");
  renderNavigationOverview();
  elements.routeStepList.innerHTML = "<li>You are close to the destination. Slow down and scan the area around you.</li>";
  setAssistantReply(`You are near ${navigation.destination.optionLabel || navigation.destination.shortName}. Slow down and scan around you carefully.`, {
    speak: true,
    force: true,
  });
}

function maybeHandleOffRoute() {
  const navigation = appState.navigation;
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
  fetchRoute("off_route");
}

function maybeRefreshRoute(previousPosition) {
  const navigation = appState.navigation;
  if (!navigation.destination || navigation.arrived || !navigation.currentPosition) {
    return;
  }

  const remainingDistance = haversineMeters(navigation.currentPosition, navigation.destination);
  if (remainingDistance <= ARRIVAL_DISTANCE_METERS) {
    markArrived();
    return;
  }

  if (!navigation.route) {
    fetchRoute("new_destination");
    return;
  }

  maybeHandleOffRoute();

  const movedDistance = previousPosition ? haversineMeters(previousPosition, navigation.currentPosition) : Infinity;
  const enoughTimePassed = Date.now() - navigation.lastRouteRefreshAt >= ROUTE_REFRESH_INTERVAL_MS;
  if (movedDistance >= ROUTE_REFRESH_MOVE_METERS && enoughTimePassed && !navigation.isFetchingRoute) {
    fetchRoute("progress_refresh");
  }
}

function handleLocationSuccess(position) {
  const previousPosition = appState.navigation.currentPosition
    ? { ...appState.navigation.currentPosition }
    : null;
  const coords = position.coords || position;

  appState.navigation.currentPosition = {
    lat: Number(coords.latitude !== undefined ? coords.latitude : coords.lat),
    lon: Number(coords.longitude !== undefined ? coords.longitude : coords.lon),
    accuracy: Number(coords.accuracy || 0),
    timestamp: Date.now(),
  };

  renderNavigationOverview();
  maybeRefreshRoute(previousPosition);
}

function handleLocationError(error) {
  const message = error && error.message ? error.message : "Location access failed.";
  setRouteStatus("Location error", "high");
  setAssistantReply(message, { speak: true, force: true });
}

function beginLocationWatch() {
  if (!("geolocation" in navigator) || appState.navigation.locationWatchId !== null) {
    return;
  }

  appState.navigation.locationWatchId = navigator.geolocation.watchPosition(
    handleLocationSuccess,
    handleLocationError,
    {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 10000,
    },
  );
}

function captureCurrentLocation(startWatch = true) {
  if (!("geolocation" in navigator)) {
    const error = new Error("Geolocation is not available in this browser.");
    handleLocationError(error);
    return Promise.reject(error);
  }

  setRouteStatus("Locating", "medium");

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        handleLocationSuccess(position);
        if (startWatch) {
          beginLocationWatch();
        }
        resolve(appState.navigation.currentPosition);
      },
      (error) => {
        handleLocationError(error);
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

function clearRoute() {
  appState.navigation.destination = null;
  appState.navigation.pendingDestination = null;
  appState.navigation.route = null;
  appState.navigation.waypoints = [];
  appState.navigation.arrived = false;
  appState.navigation.routeSearchCache = {};
  appState.navigation.lastRouteSearch = null;
  appState.navigation.lastRouteRefreshAt = 0;
  hideConfirmation();
  elements.destinationInput.value = "";
  setRouteStatus("Idle", "neutral");
  renderNavigationOverview();
  setAssistantReply("The outdoor route is cleared. Tell me a new destination whenever you are ready.", {
    speak: false,
  });
}

function describeSceneStatus() {
  const scene = appState.latestContextScene || appState.latestSafetyScene;
  if (!scene) {
    return "I am still waiting for the live scene feed.";
  }
  if (scene.path_clear) {
    return `${scene.scene_caption} ${scene.spoken_message}`.trim();
  }
  return `${scene.spoken_message} ${scene.scene_caption}`.trim();
}

function describeLocationStatus() {
  const location = appState.navigation.currentPosition;
  if (!location) {
    return "I do not have the current location yet. Please let me capture it first.";
  }
  const accuracyText = location.accuracy ? `with about ${Math.round(location.accuracy)} meters of accuracy` : "with the current GPS lock";
  return `I have the current location ${accuracyText}.`;
}

function handleConfirmationIntent(intent) {
  if (intent.type === "confirm_yes" && appState.navigation.pendingDestination) {
    activateDestination(appState.navigation.pendingDestination);
    return;
  }

  if (intent.type === "confirm_no") {
    hideConfirmation();
    setRouteStatus("Retry", "medium");
    setAssistantReply("Alright, tell me the destination again and I will confirm it before routing.", {
      speak: true,
      force: true,
    });
    queueAutoListen("destination");
    return;
  }

  setAssistantReply("Please answer with yes or no so I can continue.", {
    speak: true,
    force: true,
  });
  queueAutoListen("confirm");
}

async function handleConversationCommand(transcript, source = "voice", confidence = 1) {
  updateHeardTranscript(transcript);
  appendConversation("user", transcript);

  try {
    const intent = detectIntent(transcript);
    switch (intent.type) {
      case "confirm_yes":
      case "confirm_no":
      case "confirm_unclear":
        handleConfirmationIntent(intent);
        break;
      case "choose_option":
        selectPendingCandidate(intent.index, source);
        break;
      case "place_info":
        await handlePlaceInfoIntent(intent, source);
        break;
      case "place_info_needs_choice":
        setAssistantReply(buildPlaceInfoChoiceReply(intent.topic), {
          speak: source === "voice",
          force: true,
        });
        if (source === "voice") {
          queueAutoListen("confirm");
        }
        break;
      case "place_info_no_context":
        setAssistantReply(
          "Tell me the destination first, then I can answer whether it is open, where it is, its rating, budget, food style, phone number, or website.",
          {
            speak: source === "voice",
            force: true,
          },
        );
        break;
      case "route_search_missing_query":
        handleRouteSearchMissingQuery(source);
        break;
      case "route_place_search":
        await handleRouteAmenityIntent(intent, source);
        break;
      case "route_add_search":
        await handleRouteAddSearchIntent(intent, source);
        break;
      case "route_result_info":
        await handleRouteResultInfoIntent(intent, source);
        break;
      case "route_add_existing":
        await handleRouteAddExistingIntent(intent, source);
        break;
      case "route_stop_info":
        await handleRouteStopInfoIntent(intent, source);
        break;
      case "remove_stopover":
        await handleRemoveStopoverIntent(intent, source);
        break;
      case "route_result_choice_unclear":
        setAssistantReply(buildRouteResultChoiceReply(intent.mode, intent.topic), {
          speak: source === "voice",
          force: true,
        });
        if (source === "voice") {
          queueAutoListen("conversation");
        }
        break;
      case "choice_unclear": {
        const areaExamples = (appState.navigation.pendingCandidates || [])
          .map((candidate) => candidate.localityLabel || candidate.optionLabel)
          .filter(Boolean)
          .slice(0, 2)
          .join(" or ");
        const message = areaExamples
          ? "Please say option 1, option 2, or say the locality name like " + areaExamples + "."
          : "Please say option 1, option 2, option 3, or say the locality name so I can continue.";
        setAssistantReply(message, {
          speak: source === "voice",
          force: true,
        });
        if (source === "voice") {
          queueAutoListen("confirm");
        }
        break;
      }
      case "destination":
        await handleDestinationRequest(intent.query, source, confidence);
        break;
      case "shortest_route":
        if (!appState.navigation.destination) {
          setAssistantReply("Tell me where you want to go first, then I can correct the route if needed.", {
            speak: source === "voice",
            force: true,
          });
        } else {
          setAssistantReply("I am correcting us back to the shortest walking route now.", {
            speak: source === "voice",
            force: true,
          });
          fetchRoute("shortest_correction");
        }
        break;
      case "route_plan":
        setAssistantReply(buildRoutePlanReply(), {
          speak: source === "voice",
          force: true,
        });
        break;
      case "progress":
        setAssistantReply(describeProgress(appState.navigation.route), {
          speak: source === "voice",
          force: true,
        });
        break;
      case "repeat_step": {
        const step = getPrimaryRouteStep();
        const message = step
          ? "Next, " + step.instruction
          : "There is no active route step yet. Tell me the destination first.";
        setAssistantReply(message, { speak: source === "voice", force: true });
        break;
      }
      case "clear_route":
        clearRoute();
        if (source === "voice") {
          setAssistantReply("The route is cleared. Tell me the next place whenever you are ready.", {
            speak: true,
            force: true,
          });
        }
        break;
      case "refresh_route":
        if (!appState.navigation.destination) {
          setAssistantReply("There is no route to refresh yet.", { speak: source === "voice", force: true });
        } else {
          setAssistantReply("I am refreshing the current walking route.", { speak: source === "voice", force: true });
          fetchRoute("manual_refresh");
        }
        break;
      case "location_status":
        setAssistantReply(describeLocationStatus(), { speak: source === "voice", force: true });
        break;
      case "scene_status":
        setAssistantReply(describeSceneStatus(), { speak: source === "voice", force: true });
        break;
      case "capabilities":
        setAssistantReply(
          "I stay focused on navigation. You can ask me to guide you somewhere, reroute you, repeat the next step, summarize the route, tell you what is ahead, search almost any place type on your route, add a stop like an ATM, cafe, restroom, pharmacy, petrol pump, hotel, or brand name, remove a stop, or tell you about the destination or the selected stop such as its address, opening hours, rating, budget, food style, phone number, or website.",
          {
            speak: source === "voice",
            force: true,
          },
        );
        break;
      default:
        setAssistantReply(
          "I stay focused on route guidance, safety, route-side places, stopovers, and destination details only. Ask me about the route, what is ahead, what is available on the way, add a place to the route, remove a stop, or ask about the destination or a place I found on the route.",
          {
            speak: source === "voice",
            force: true,
          },
        );
        break;
    }
  } catch (error) {
    setAssistantReply(error && error.message ? error.message : "I could not complete that request right now.", {
      speak: source === "voice",
      force: true,
    });
  }
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    elements.voiceDestination.disabled = true;
    elements.voiceDestination.textContent = "Mic unavailable";
    elements.voiceConfirm.disabled = true;
    elements.voiceConfirm.textContent = "Mic unavailable";
    elements.talkToNavigator.disabled = true;
    elements.talkToNavigator.textContent = "Mic unavailable";
    return;
  }

  appState.recognition = new SpeechRecognition();
  appState.recognition.lang = "en-US";
  appState.recognition.interimResults = false;
  appState.recognition.maxAlternatives = 1;

  appState.recognition.onstart = () => {
    appState.recognitionActive = true;
    updateSpeechButtons(true);
  };

  appState.recognition.onend = () => {
    appState.recognitionActive = false;
    appState.activeSpeechMode = null;
    updateSpeechButtons(false);
    maybeStartQueuedAutoListen();
    flushPendingSafetyAlert();
  };

  appState.recognition.onresult = (event) => {
    const result = event.results[0][0];
    const transcript = result.transcript.trim();
    const confidence = Number(result.confidence || 0);
    const mode = appState.activeSpeechMode || "conversation";

    if (mode === "destination") {
      elements.destinationInput.value = transcript;
      handleDestinationRequest(transcript, "voice", confidence);
      return;
    }

    handleConversationCommand(transcript, "voice", confidence);
  };

  appState.recognition.onerror = () => {
    appState.recognitionActive = false;
    appState.activeSpeechMode = null;
    updateSpeechButtons(false);
    flushPendingSafetyAlert();
    setAssistantReply("I could not hear that clearly. You can speak again or use the buttons on the page.", {
      speak: false,
      force: true,
    });
  };
}

elements.voiceToggle.addEventListener("click", () => {
  appState.voiceEnabled = !appState.voiceEnabled;
  elements.voiceToggle.textContent = `Voice guidance: ${appState.voiceEnabled ? "On" : "Off"}`;
  if (!appState.voiceEnabled) {
    cancelSpeechPlayback();
    clearAutoListenQueue();
    appState.assistantSpeaking = false;
    appState.pendingSafetyAlert = null;
    appState.lastSpokenMessage = "";
    resetSafetySpeech();
    return;
  }

  speakLatestSafetyGuidance(true);
});

elements.talkToNavigator.addEventListener("click", () => {
  startSpeechCapture("conversation");
});

elements.repeatInstruction.addEventListener("click", () => {
  const step = getPrimaryRouteStep();
  const message = step ? `Next, ${step.instruction}` : elements.journeyMessage.textContent;
  speakAssistantMessage(message, { force: true });
});

elements.destinationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = elements.destinationInput.value;
  updateHeardTranscript(query);
  appendConversation("user", query);
  handleDestinationRequest(query, "typed", 1);
});

elements.voiceDestination.addEventListener("click", () => {
  startSpeechCapture("destination");
});

elements.useLocation.addEventListener("click", () => {
  captureCurrentLocation(true)
    .then(() => {
      setAssistantReply("Current location captured. You can now set the destination.", {
        speak: false,
      });
    })
    .catch(() => {});
});

elements.refreshRoute.addEventListener("click", () => {
  fetchRoute("manual_refresh");
});

elements.shortestRoute.addEventListener("click", () => {
  handleConversationCommand("Correct me to the shortest route.", "typed");
});

elements.clearRoute.addEventListener("click", () => {
  clearRoute();
});

elements.confirmDestination.addEventListener("click", () => {
  if (appState.navigation.pendingDestination) {
    activateDestination(appState.navigation.pendingDestination);
  }
});

elements.retryDestination.addEventListener("click", () => {
  hideConfirmation();
  setRouteStatus("Retry", "medium");
  setAssistantReply("Tell me the destination again and I will confirm it before routing.", {
    speak: false,
  });
});

elements.confirmationChoices.addEventListener("click", (event) => {
  const button = event.target.closest("[data-choice-index]");
  if (!button) {
    return;
  }

  selectPendingCandidate(Number(button.dataset.choiceIndex), "typed");
});

elements.voiceConfirm.addEventListener("click", () => {
  startSpeechCapture("confirm");
});

document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => {
    const command = button.dataset.command;
    handleConversationCommand(command, "typed", 1);
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
initializeGoogleMaps();
renderNavigationOverview();
setRouteStatus("Idle", "neutral");
setupCameraStreamStatus();
fetchSafetyScene();
fetchContextScene();
window.setInterval(fetchSafetyScene, SAFETY_REFRESH_MS);
window.setInterval(fetchContextScene, CONTEXT_REFRESH_MS);

window.AssistiveVisionPage = {
  page: "outdoor",
  askQuestion: async (question) => {
    await handleConversationCommand(question, "typed", 1);
    return elements.assistantReply.textContent || elements.journeyMessage.textContent;
  },
  getSafetyScene: () => appState.latestSafetyScene,
  getContextScene: () => appState.latestContextScene,
  getCurrentGuidance: () => {
    const nextStep = elements.nextRouteInstruction.textContent || "";
    const safety = elements.spokenMessage.textContent || "";
    return [nextStep, safety].filter(Boolean).join(" ");
  },
  getAssistantContext: () => ({
    guidance: elements.spokenMessage.textContent || "",
    assistantReply: elements.assistantReply.textContent || "",
    destinationLabel: elements.destinationLabel.textContent || "",
    nextInstruction: elements.nextRouteInstruction.textContent || "",
    routeStatus: elements.routeStatusBadge.textContent || "",
  }),
};




































