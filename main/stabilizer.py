"""
stabilizer.py – Temporal scene stabilizer for alert anti-flicker.

Each raw scene produced by build_scene_guidance() is fed through
SceneStabilizer.update().  The stabilizer keeps a short-term sliding
window of recent frames and enforces two simple rules:

  1. ESCALATION is instant  – if the new frame is more urgent / severe
     than the current stable level, the new level is adopted immediately
     (safety first).

  2. DE-ESCALATION is gated – the stable level only drops after
     DEESCALATE_HOLD consecutive frames all report a lower urgency.  Any
     single frame that jumps back up resets the counter, so a momentary
     STOP caused by a single bad detection will not flicker away instantly.

The stabilized scene is a copy of the last scene that was actually adopted
(so summary, spoken_message, obstacles etc. stay coherent), updated with
the stabilized command / urgency / palette and a few diagnostic fields.
"""

from __future__ import annotations

from collections import deque

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------

#: Number of recent raw scenes kept in the sliding-window history.
STABILIZER_WINDOW: int = 30

#: Consecutive lower-urgency frames required before de-escalating.
DEESCALATE_HOLD: int = 15

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

URGENCY_RANK: dict[str, int] = {
    "low": 0,
    "medium": 1,
    "high": 2,
    "critical": 3,
}

#: Inverse mapping so we can resolve a rank back to a label.
_RANK_TO_URGENCY: dict[int, str] = {v: k for k, v in URGENCY_RANK.items()}

COMMAND_PRIORITY: dict[str, int] = {
    "CLEAR": 0,
    "SLOW": 1,
    "MOVE_LEFT": 2,
    "MOVE_RIGHT": 2,
    "STOP": 3,
}


# ---------------------------------------------------------------------------
# SceneStabilizer
# ---------------------------------------------------------------------------


class SceneStabilizer:
    """Short-term frame-memory that prevents alert flickering.

    Parameters
    ----------
    window:
        Size of the sliding-window history (number of frames remembered).
    hold:
        How many consecutive frames must report a lower urgency before the
        stable level is allowed to de-escalate.
    """

    def __init__(
        self,
        window: int = STABILIZER_WINDOW,
        hold: int = DEESCALATE_HOLD,
    ) -> None:
        self._window = window
        self._hold = hold

        # Circular buffer of recent raw scenes.
        self._history: deque[dict] = deque(maxlen=window)

        # Current stable state.
        self._stable_command: str = "CLEAR"
        self._stable_urgency: str = "low"
        self._stable_scene: dict | None = None

        # Counter: how many consecutive frames have been at a LOWER level
        # than _stable_urgency.  Resets to 0 whenever a frame arrives at
        # the same or higher level.
        self._lower_count: int = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def reset(self) -> None:
        """Clear all history.  Call this whenever the camera is (re)started."""
        self._history.clear()
        self._stable_command = "CLEAR"
        self._stable_urgency = "low"
        self._stable_scene = None
        self._lower_count = 0

    def update(self, raw_scene: dict) -> dict:
        """Feed one raw per-frame scene; return the temporally-stabilized scene.

        Parameters
        ----------
        raw_scene:
            The dict returned by ``build_scene_guidance()`` for the current
            frame.

        Returns
        -------
        dict
            A copy of the most-recently *adopted* scene (so summaries,
            spoken messages, and obstacle lists remain coherent) with the
            following fields overwritten to the stabilized values:

            * ``command``
            * ``urgency``
            * ``palette``

            Plus diagnostic read-only fields (prefixed ``_stab_``):

            * ``_stab_lower_count``  – current de-escalation countdown value
            * ``_stab_hold_frames`` – configured hold threshold
            * ``_stab_raw_command`` – the command from the raw (un-stabilized) scene
            * ``_stab_raw_urgency`` – the urgency from the raw (un-stabilized) scene
        """
        self._history.append(raw_scene)

        raw_command = raw_scene.get("command", "CLEAR")
        raw_urgency = raw_scene.get("urgency", "low")
        new_rank = URGENCY_RANK.get(raw_urgency, 0)
        stable_rank = URGENCY_RANK.get(self._stable_urgency, 0)

        if new_rank >= stable_rank:
            # --- ESCALATE or hold at the same level ---
            is_hardware_alert = raw_scene.get("camera_obstructed", False)
            
            if self._stable_scene is not None and raw_command == self._stable_command and not is_hardware_alert:
                old_primary = self._stable_scene.get("primary_obstacle") or {}
                new_primary = raw_scene.get("primary_obstacle") or {}
                
                # Only latch the spoken string if it's the same actual obstacle class (e.g. both 'person')
                if old_primary.get("class_name") == new_primary.get("class_name"):
                    raw_scene["spoken_message"] = self._stable_scene.get("spoken_message", raw_scene.get("spoken_message"))
                    raw_scene["speech_key"] = self._stable_scene.get("speech_key", raw_scene.get("speech_key"))

            # Adopt the new scene immediately; clear the de-escalation counter.
            self._stable_command = raw_command
            self._stable_urgency = raw_urgency
            self._stable_scene = raw_scene
            self._lower_count = 0
        else:
            # --- Candidate de-escalation ---
            self._lower_count += 1
            if self._lower_count >= self._hold:
                # Enough sustained frames at the lower level → actually drop.
                self._stable_command = raw_command
                self._stable_urgency = raw_urgency
                self._stable_scene = raw_scene
                self._lower_count = 0
            # else: silently suppress the lower reading; keep current state.

        return self._build_output(raw_command, raw_urgency)

    @property
    def stable_command(self) -> str:
        return self._stable_command

    @property
    def stable_urgency(self) -> str:
        return self._stable_urgency

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_output(self, raw_command: str, raw_urgency: str) -> dict:
        # Base is the last *adopted* scene (keeps summary, spoken_message,
        # obstacles, region_risk etc. coherent with the command being shown).
        base = dict(self._stable_scene or {})

        # Overwrite the alert-level fields with the stabilized values.
        base["command"] = self._stable_command
        base["urgency"] = self._stable_urgency

        # Re-resolve palette from the stabilized urgency.
        try:
            from .planner import URGENCY_COLORS  # local import avoids circularity
        except ImportError:
            URGENCY_COLORS = {
                "low": "#2d7a52",
                "medium": "#bf7b1d",
                "high": "#b04831",
                "critical": "#8e2a22",
            }
        base["palette"] = {"urgency": URGENCY_COLORS.get(self._stable_urgency, "#2d7a52")}

        # Diagnostic fields (prefixed so they are easy to strip in tests).
        base["_stab_lower_count"] = self._lower_count
        base["_stab_hold_frames"] = self._hold
        base["_stab_raw_command"] = raw_command
        base["_stab_raw_urgency"] = raw_urgency

        return base


# ---------------------------------------------------------------------------
# Module-level singleton helpers (mirrors tracker.py pattern)
# ---------------------------------------------------------------------------

_stabilizer = SceneStabilizer()


def reset_stabilizer() -> None:
    """Reset the module-level stabilizer singleton."""
    _stabilizer.reset()


def stabilize_scene(raw_scene: dict) -> dict:
    """Feed *raw_scene* through the module-level stabilizer and return the
    stabilized scene.  Thread-safe only when the caller already holds the
    detector lock (same pattern as ``update_tracker``).
    """
    return _stabilizer.update(raw_scene)
