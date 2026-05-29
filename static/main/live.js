const body = document.body;
const sceneUrl = body.dataset.sceneUrl;
const askUrl = body.dataset.askUrl;

const GEOCODE_ENDPOINT = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=";
const ROUTE_ENDPOINT = "https://router.project-osrm.org/route/v1/foot";
const ARRIVAL_DISTANCE_METERS = 20;
const ROUTE_REFRESH_INTERVAL_MS = 12000;
const ROUTE_REFRESH_MOVE_METERS = 14;
const ROUTE_REPEAT_INTERVAL_MS = 18000;
const ROUTE_STEP_PREVIEW_COUNT = 5;
const SPEECH_CONFIRMATION_THRESHOLD = 0.78;
const SAME_ALERT_BURST_LIMIT = 3;
const SAME_ALERT_MIN_INTERVAL_MS = 1400;
const SAME_ALERT_COOLDOWN_MS = 3200;

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
  questionForm: document.getElementById("questionForm"),
  questionInput: document.getElementById("questionInput"),
  voiceQuestion: document.getElementById("voiceQuestion"),
  assistantAnswer: document.getElementById("assistantAnswer"),
  destinationForm: document.getElementById("destinationForm"),
  destinationInput: document.getElementById("destinationInput"),
  voiceDestination: document.getElementById("voiceDestination"),
  routeStatusBadge: document.getElementById("routeStatusBadge"),
  locationText: document.getElementById("locationText"),
  destinationLabel: document.getElementById("destinationLabel"),
  routeSummary: document.getElementById("routeSummary"),
  nextRouteInstruction: document.getElementById("nextRouteInstruction"),
  journeyMessage: document.getElementById("journeyMessage"),
  routeStepList: document.getElementById("routeStepList"),
  useLocation: document.getElementById("useLocation"),
  refreshRoute: document.getElementById("refreshRoute"),
  clearRoute: document.getElementById("clearRoute"),
  confirmationCard: document.getElementById("confirmationCard"),
  confirmationText: document.getElementById("confirmationText"),
  confirmDestination: document.getElementById("confirmDestination"),
  retryDestination: document.getElementById("retryDestination"),
};

const appState = {
  voiceEnabled: true,
  lastSpokenMessage: "",
  guidanceSpeech: {
    lastKey: "",
    lastText: "",
    repeatCount: 0,
    lastAt: 0,
  },
  polling: false,
  recognition: null,
  activeSpeechMode: null,
  latestScene: null,
  navigation: {
    currentPosition: null,
    locationWatchId: null,
    destination: null,
    pendingDestination: null,
    route: null,
    isFetchingRoute: false,
    arrived: false,
    lastRouteRefreshAt: 0,
    lastRouteOrigin: null,
    lastJourneyMessage: "",
    lastJourneyVoiceKey: "",
    lastRouteSpokenAt: 0,
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

function setBadgeClass(element, level) {
  element.className = `badge ${level || "neutral"}`;
}

function setRouteStatus(text, level = "neutral") {
  elements.routeStatusBadge.textContent = text;
  setBadgeClass(elements.routeStatusBadge, level);
}

function speak(text, force = false) {
  const message = String(text || "").trim();
  if (!appState.voiceEnabled || !("speechSynthesis" in window) || !message) {
    return false;
  }
  if (!force && message === appState.lastSpokenMessage) {
    return false;
  }
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
  }
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  window.speechSynthesis.speak(utterance);
  appState.lastSpokenMessage = message;
  return true;
}

function resetGuidanceSpeech() {
  appState.guidanceSpeech.lastKey = "";
  appState.guidanceSpeech.lastText = "";
  appState.guidanceSpeech.repeatCount = 0;
  appState.guidanceSpeech.lastAt = 0;
}

function speakGuidanceMessage(text, key, options = {}) {
  const message = String(text || "").trim();
  const speechKey = String(key || message).trim();
  const force = Boolean(options.force);
  const allowBurst = Boolean(options.allowBurst);

  if (!message || !speechKey || !appState.voiceEnabled || !("speechSynthesis" in window)) {
    return;
  }

  const now = Date.now();
  const guidanceSpeech = appState.guidanceSpeech;

  if (force || speechKey !== guidanceSpeech.lastKey) {
    if (speak(message, true)) {
      guidanceSpeech.lastKey = speechKey;
      guidanceSpeech.lastText = message;
      guidanceSpeech.repeatCount = 1;
      guidanceSpeech.lastAt = now;
    }
    return;
  }

  if (!allowBurst || (window.speechSynthesis.speaking || window.speechSynthesis.pending)) {
    return;
  }

  const pauseMs =
    guidanceSpeech.repeatCount >= SAME_ALERT_BURST_LIMIT
      ? SAME_ALERT_COOLDOWN_MS
      : SAME_ALERT_MIN_INTERVAL_MS;

  if (now - guidanceSpeech.lastAt < pauseMs) {
    return;
  }

  if (speak(message, true)) {
    guidanceSpeech.lastKey = speechKey;
    guidanceSpeech.lastText = message;
    guidanceSpeech.repeatCount =
      guidanceSpeech.repeatCount >= SAME_ALERT_BURST_LIMIT
        ? 1
        : guidanceSpeech.repeatCount + 1;
    guidanceSpeech.lastAt = now;
  }
}

function formatDistance(distanceMeters) {
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(distanceMeters)} m`;
}

function formatDuration(durationSeconds) {
  const minutes = Math.round(durationSeconds / 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) {
      return `${hours} hr`;
    }
    return `${hours} hr ${remainingMinutes} min`;
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

function normalizeDestinationQuery(rawInput) {
  let query = String(rawInput || "").trim().replace(/[?.!]+$/g, "");
  const phrases = [
    /^take me to\s+/i,
    /^guide me to\s+/i,
    /^navigate to\s+/i,
    /^go to\s+/i,
    /^route to\s+/i,
    /^lead me to\s+/i,
    /^find me\s+/i,
    /^find\s+/i,
  ];

  phrases.forEach((pattern) => {
    query = query.replace(pattern, "");
  });
  return query.trim();
}

function humanizeModifier(modifier) {
  const map = {
    straight: "straight",
    "slight right": "slightly right",
    "slight left": "slightly left",
    "sharp right": "sharply right",
    "sharp left": "sharply left",
    uturn: "back around",
  };
  return map[modifier] || modifier || "straight";
}

function ordinal(value) {
  const number = Number(value || 0);
  if (number === 1) {
    return "1st";
  }
  if (number === 2) {
    return "2nd";
  }
  if (number === 3) {
    return "3rd";
  }
  return `${number}th`;
}

function buildStepInstruction(step) {
  const maneuver = step.maneuver || {};
  const type = maneuver.type || "continue";
  const modifier = humanizeModifier(maneuver.modifier || "straight");
  const roadName = step.name ? ` on ${step.name}` : "";
  const distanceText = step.distance > 5 ? ` for ${formatDistance(step.distance)}` : "";

  switch (type) {
    case "depart":
      return `Start and walk ${modifier}${roadName}${distanceText}.`;
    case "turn":
      return `Turn ${modifier}${roadName}${distanceText}.`;
    case "continue":
      return `Continue ${modifier}${roadName}${distanceText}.`;
    case "new name":
      return `Continue onto ${step.name || "the next road"}${distanceText}.`;
    case "merge":
      return `Merge ${modifier}${roadName}${distanceText}.`;
    case "fork":
      return `Keep ${modifier}${roadName}${distanceText}.`;
    case "end of road":
      return `At the end of the road, turn ${modifier}${roadName}${distanceText}.`;
    case "roundabout":
    case "rotary": {
      const exitText = maneuver.exit ? ` and take the ${ordinal(maneuver.exit)} exit` : "";
      return `Enter the roundabout${exitText}${roadName}${distanceText}.`;
    }
    case "arrive":
      return "You have arrived near the destination.";
    default:
      return `Continue ${modifier}${roadName}${distanceText}.`;
  }
}

function parseRouteSteps(rawSteps) {
  return (rawSteps || [])
    .filter((step) => step.distance > 1 || (step.maneuver && step.maneuver.type === "arrive"))
    .map((step) => ({
      instruction: buildStepInstruction(step),
      distance: step.distance || 0,
      duration: step.duration || 0,
      type: step.maneuver ? step.maneuver.type : "continue",
    }));
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
function renderRouteSteps() {
  const navigation = appState.navigation;
  const route = navigation.route;
  if (!route || !route.steps || !route.steps.length) {
    elements.routeStepList.innerHTML = "<li>Capture location and set a destination to start outdoor guidance.</li>";
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

function renderNavigationOverview() {
  const navigation = appState.navigation;
  const location = navigation.currentPosition;

  if (location) {
    const accuracyText = location.accuracy ? ` (accuracy ${Math.round(location.accuracy)} m)` : "";
    elements.locationText.textContent = `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}${accuracyText}`;
  } else {
    elements.locationText.textContent = "Not captured yet";
  }

  if (navigation.destination) {
    elements.destinationLabel.textContent = navigation.destination.shortName;
  } else {
    elements.destinationLabel.textContent = "No destination selected";
  }

  if (navigation.arrived && navigation.destination) {
    elements.routeSummary.textContent = `Reached ${navigation.destination.shortName}`;
    elements.nextRouteInstruction.textContent = "You have arrived near the destination.";
  } else if (navigation.route) {
    elements.routeSummary.textContent = `${formatDistance(navigation.route.distance)} • about ${formatDuration(navigation.route.duration)}`;
    elements.nextRouteInstruction.textContent = getPrimaryRouteStep()
      ? getPrimaryRouteStep().instruction
      : "Continue toward the destination.";
  } else if (navigation.destination) {
    elements.routeSummary.textContent = location
      ? "Location ready. Route is waiting to be built."
      : "Destination saved. Waiting for your current location.";
    elements.nextRouteInstruction.textContent = "No active route yet.";
  } else {
    elements.routeSummary.textContent = "Waiting for route setup";
    elements.nextRouteInstruction.textContent = "No active route";
  }

  renderRouteSteps();
}

function hideConfirmation() {
  elements.confirmationCard.classList.add("hidden");
  appState.navigation.pendingDestination = null;
}

function showConfirmation(candidate, transcript) {
  appState.navigation.pendingDestination = candidate;
  elements.confirmationText.textContent = `I heard "${transcript}". Should I start navigation to ${candidate.name}?`;
  elements.confirmationCard.classList.remove("hidden");
  setRouteStatus("Confirm", "medium");
  speak(`I heard ${candidate.shortName}. Should I start navigation there?`, true);
}

function composeJourneyMessage(scene) {
  const navigation = appState.navigation;
  const routeStep = getPrimaryRouteStep();

  if (navigation.arrived && navigation.destination) {
    const arrivalText = `You are near ${navigation.destination.shortName}. Slow down and scan the surroundings.`;
    if (!scene) {
      return arrivalText;
    }
    return `${scene.spoken_message} ${arrivalText}`;
  }

  if (!navigation.destination || !routeStep) {
    return scene ? scene.spoken_message : "Waiting for live guidance.";
  }

  const routeText = routeStep.instruction;
  if (!scene) {
    return routeText;
  }

  if (scene.command === "STOP") {
    return `${scene.spoken_message} Resume the route after the path becomes safe. Next route step: ${routeText}`;
  }

  if (["MOVE_LEFT", "MOVE_RIGHT", "SLOW"].includes(scene.command)) {
    return `${scene.spoken_message} After that, ${routeText}`;
  }

  return `${routeText} ${scene.spoken_message}`;
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
  if (!urgent) {
    return {
      text: scene.spoken_message || "Path seems clear. Continue carefully.",
      key: scene.path_clear ? "clear:path" : `clear:${scene.safe_direction || "forward"}`,
      urgent: false,
    };
  }

  const primary = scene.primary_obstacle || {};
  return {
    text: scene.spoken_message || "Obstacle ahead.",
    key: `${scene.command}:${scene.safe_direction || "forward"}:${primary.class_name || "obstacle"}`,
    urgent: true,
  };
}

function refreshJourneyMessage(forceSpeak = false) {
  const navigation = appState.navigation;
  const scene = appState.latestScene;
  const message = scene ? scene.spoken_message : composeJourneyMessage(scene);
  const voiceGuidance = buildVoiceGuidance(scene);
  const voiceChanged = voiceGuidance.key !== navigation.lastJourneyVoiceKey;

  elements.journeyMessage.textContent = message;

  if (forceSpeak || voiceGuidance.urgent || voiceChanged) {
    speakGuidanceMessage(voiceGuidance.text, voiceGuidance.key, {
      force: forceSpeak || voiceChanged,
      allowBurst: voiceGuidance.urgent,
    });
  }

  navigation.lastJourneyMessage = message;
  navigation.lastJourneyVoiceKey = voiceGuidance.key;
}

function updateScene(scene) {
  appState.latestScene = scene;

  elements.commandValue.textContent = prettyLabel(scene.command);
  elements.spokenMessage.textContent = scene.spoken_message;
  elements.sceneSummary.textContent = `${scene.scene_caption} ${scene.summary}`.trim();
  elements.safeDirection.textContent = prettyLabel(scene.safe_direction);
  elements.clearSteps.textContent = scene.estimated_clear_steps;
  elements.objectCount.textContent = (scene.detections || []).length;

  elements.commandCard.className = `command-card urgency-${scene.urgency || "low"}`;
  elements.urgencyBadge.textContent = prettyLabel(scene.urgency);
  setBadgeClass(elements.urgencyBadge, scene.urgency || "neutral");
  renderSteps(scene.recommended_steps || []);
  renderObstacles(scene.detections || []);

  if (scene.timestamp) {
    const updatedAt = new Date(scene.timestamp * 1000);
    elements.lastUpdated.textContent = `Updated ${updatedAt.toLocaleTimeString()}`;
  } else {
    elements.lastUpdated.textContent = "Waiting for first processed frame";
  }

  if (scene.error) {
    elements.connectionBadge.textContent = "Camera issue";
    setBadgeClass(elements.connectionBadge, "high");
  } else {
    elements.connectionBadge.textContent = scene.running ? "Live" : "Idle";
    setBadgeClass(elements.connectionBadge, scene.running ? "low" : "neutral");
  }

  refreshJourneyMessage(false);
}

async function fetchScene() {
  if (appState.polling) {
    return;
  }

  appState.polling = true;
  try {
    const response = await fetch(sceneUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Scene request failed with ${response.status}`);
    }
    const payload = await response.json();
    if (payload.error) {
      throw new Error(payload.error);
    }
    updateScene(payload.scene);
  } catch (error) {
    elements.connectionBadge.textContent = "Offline";
    setBadgeClass(elements.connectionBadge, "high");
    elements.sceneSummary.textContent = error.message;
  } finally {
    appState.polling = false;
  }
}

async function askQuestion(question, speakAnswer = true) {
  const trimmedQuestion = String(question || "").trim();
  if (!trimmedQuestion) {
    elements.assistantAnswer.textContent = "Type or speak a question about the current scene.";
    return;
  }

  try {
    const url = `${askUrl}?q=${encodeURIComponent(trimmedQuestion)}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Assistant request failed with ${response.status}`);
    }
    const payload = await response.json();
    if (payload.error) {
      throw new Error(payload.error);
    }
    elements.assistantAnswer.textContent = payload.answer.answer;
    if (payload.scene) {
      updateScene(payload.scene);
    }
    if (speakAnswer) {
      speak(payload.answer.answer, true);
    }
  } catch (error) {
    elements.assistantAnswer.textContent = error.message;
  }
}

async function geocodeDestination(query) {
  const response = await fetch(`${GEOCODE_ENDPOINT}${encodeURIComponent(query)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Destination lookup failed with ${response.status}`);
  }
  const results = await response.json();
  return (results || []).map((result) => ({
    name: result.display_name,
    shortName: shortPlaceLabel(result.display_name),
    lat: Number(result.lat),
    lon: Number(result.lon),
  }));
}
async function fetchRoute() {
  const navigation = appState.navigation;
  if (navigation.isFetchingRoute || !navigation.destination) {
    return;
  }

  navigation.isFetchingRoute = true;
  setRouteStatus("Routing", "medium");
  elements.routeSummary.textContent = "Calculating walking route...";

  try {
    if (!navigation.currentPosition) {
      await captureCurrentLocation(true);
    }

    if (!navigation.currentPosition) {
      throw new Error("Current location is not available yet.");
    }

    const origin = navigation.currentPosition;
    const destination = navigation.destination;
    const url = `${ROUTE_ENDPOINT}/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=false&steps=true&alternatives=false&annotations=false`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Route request failed with ${response.status}`);
    }

    const payload = await response.json();
    const route = payload.routes && payload.routes[0];
    if (!route || !route.legs || !route.legs[0]) {
      throw new Error("No walking route could be found for that destination.");
    }

    navigation.route = {
      distance: route.distance,
      duration: route.duration,
      steps: parseRouteSteps(route.legs[0].steps),
    };
    navigation.arrived = false;
    navigation.lastRouteRefreshAt = Date.now();
    navigation.lastRouteOrigin = { ...origin };

    setRouteStatus("Guiding", "low");
    renderNavigationOverview();
    refreshJourneyMessage(true);
  } catch (error) {
    setRouteStatus("Route error", "high");
    elements.routeSummary.textContent = error.message;
    elements.nextRouteInstruction.textContent = "Try refreshing the route or using another destination.";
    elements.journeyMessage.textContent = error.message;
    speak(error.message, true);
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
  elements.routeStepList.innerHTML = "<li>You have arrived near the destination. Slow down and scan the area around you.</li>";
  refreshJourneyMessage(true);
}

function maybeRefreshRoute(previousPosition) {
  const navigation = appState.navigation;
  if (!navigation.destination || navigation.arrived) {
    return;
  }

  if (!navigation.currentPosition) {
    return;
  }

  const remainingDistance = haversineMeters(navigation.currentPosition, navigation.destination);
  if (remainingDistance <= ARRIVAL_DISTANCE_METERS) {
    markArrived();
    return;
  }

  if (!navigation.route) {
    fetchRoute();
    return;
  }

  const movedDistance = previousPosition ? haversineMeters(previousPosition, navigation.currentPosition) : Infinity;
  const enoughTimePassed = Date.now() - navigation.lastRouteRefreshAt >= ROUTE_REFRESH_INTERVAL_MS;
  if (movedDistance >= ROUTE_REFRESH_MOVE_METERS && enoughTimePassed) {
    fetchRoute();
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
  elements.routeSummary.textContent = message;
  elements.journeyMessage.textContent = message;
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
        if (!appState.navigation.route && appState.navigation.destination) {
          setRouteStatus("Location ready", "medium");
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

async function activateDestination(candidate) {
  appState.navigation.destination = candidate;
  appState.navigation.route = null;
  appState.navigation.arrived = false;
  hideConfirmation();
  renderNavigationOverview();
  elements.routeSummary.textContent = `Destination set to ${candidate.shortName}. Capturing current location...`;
  setRouteStatus("Destination set", "medium");

  try {
    await captureCurrentLocation(true);
    await fetchRoute();
  } catch (error) {
    elements.routeSummary.textContent = error.message;
  }
}

async function submitDestination(rawValue, source = "typed", confidence = 1) {
  const query = normalizeDestinationQuery(rawValue);
  if (!query) {
    elements.routeSummary.textContent = "Please provide a destination to start guidance.";
    return;
  }

  setRouteStatus("Searching", "medium");
  elements.routeSummary.textContent = `Looking for ${query}...`;

  try {
    const candidates = await geocodeDestination(query);
    if (!candidates.length) {
      throw new Error("I could not find that destination. Please try another wording.");
    }

    const candidate = candidates[0];
    const requireConfirmation = source === "voice" && (confidence < SPEECH_CONFIRMATION_THRESHOLD || candidates.length > 1);

    if (requireConfirmation) {
      showConfirmation(candidate, query);
      return;
    }

    await activateDestination(candidate);
  } catch (error) {
    setRouteStatus("Search error", "high");
    elements.routeSummary.textContent = error.message;
    elements.journeyMessage.textContent = error.message;
    speak(error.message, true);
  }
}

function clearRoute() {
  appState.navigation.destination = null;
  appState.navigation.pendingDestination = null;
  appState.navigation.route = null;
  appState.navigation.arrived = false;
  appState.navigation.lastRouteRefreshAt = 0;
  appState.navigation.lastJourneyMessage = "";
  appState.navigation.lastJourneyVoiceKey = "";
  resetGuidanceSpeech();
  hideConfirmation();
  elements.destinationInput.value = "";
  setRouteStatus("Idle", "neutral");
  renderNavigationOverview();
  refreshJourneyMessage(false);
}
function updateVoiceButtons(listening = false) {
  elements.voiceDestination.textContent =
    listening && appState.activeSpeechMode === "destination" ? "Listening..." : "Speak destination";
  elements.voiceQuestion.textContent =
    listening && appState.activeSpeechMode === "question" ? "Listening..." : "Use mic";
}

function startSpeechCapture(mode) {
  if (!appState.recognition) {
    const message = "Speech recognition is not available in this browser.";
    elements.journeyMessage.textContent = message;
    return;
  }

  appState.activeSpeechMode = mode;
  updateVoiceButtons(true);
  try {
    appState.recognition.start();
  } catch (error) {
    updateVoiceButtons(false);
  }
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    elements.voiceQuestion.disabled = true;
    elements.voiceQuestion.textContent = "Mic unavailable";
    elements.voiceDestination.disabled = true;
    elements.voiceDestination.textContent = "Mic unavailable";
    return;
  }

  appState.recognition = new SpeechRecognition();
  appState.recognition.lang = "en-US";
  appState.recognition.interimResults = false;
  appState.recognition.maxAlternatives = 1;

  appState.recognition.onstart = () => {
    updateVoiceButtons(true);
  };

  appState.recognition.onend = () => {
    updateVoiceButtons(false);
  };

  appState.recognition.onresult = (event) => {
    const result = event.results[0][0];
    const transcript = result.transcript.trim();
    const confidence = Number(result.confidence || 0);

    if (appState.activeSpeechMode === "destination") {
      elements.destinationInput.value = transcript;
      submitDestination(transcript, "voice", confidence);
    } else {
      elements.questionInput.value = transcript;
      askQuestion(transcript);
    }
  };

  appState.recognition.onerror = () => {
    updateVoiceButtons(false);
    const message = "Microphone recognition failed. You can still type the command.";
    if (appState.activeSpeechMode === "destination") {
      elements.routeSummary.textContent = message;
    } else {
      elements.assistantAnswer.textContent = message;
    }
  };
}

elements.voiceToggle.addEventListener("click", () => {
  appState.voiceEnabled = !appState.voiceEnabled;
  elements.voiceToggle.textContent = `Voice guidance: ${appState.voiceEnabled ? "On" : "Off"}`;
  if (!appState.voiceEnabled && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    appState.lastSpokenMessage = "";
    resetGuidanceSpeech();
  }
});

elements.speakNow.addEventListener("click", () => {
  const message = composeJourneyMessage(appState.latestScene);
  speak(message, true);
});

elements.questionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  askQuestion(elements.questionInput.value);
});

elements.destinationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitDestination(elements.destinationInput.value, "typed", 1);
});

elements.voiceDestination.addEventListener("click", () => {
  startSpeechCapture("destination");
});

elements.voiceQuestion.addEventListener("click", () => {
  startSpeechCapture("question");
});

elements.useLocation.addEventListener("click", () => {
  captureCurrentLocation(true).then(() => {
    if (appState.navigation.destination) {
      fetchRoute();
    }
  }).catch(() => {});
});

elements.refreshRoute.addEventListener("click", () => {
  fetchRoute();
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
  elements.destinationInput.focus();
  elements.routeSummary.textContent = "Please say or type the destination again.";
  setRouteStatus("Retry", "medium");
});

document.querySelectorAll("[data-question]").forEach((button) => {
  button.addEventListener("click", () => {
    const question = button.dataset.question;
    elements.questionInput.value = question;
    askQuestion(question, false);
  });
});

renderNavigationOverview();
setRouteStatus("Idle", "neutral");
setupSpeechRecognition();
fetchScene();
window.setInterval(fetchScene, 1000);




