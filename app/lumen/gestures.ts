import type { CreatureEvent, CreatureSensation } from "./creature";
import type { HandSnapshot, Vec2 } from "./types";

export type GestureKind =
  | "approaching"
  | "gentle-touch"
  | "stroking"
  | "fast-movement"
  | "leaving";

export type GestureObservation = {
  kind: GestureKind;
  durationMs: number;
  intensity: number;
  observedAt: number;
};

export type GesturePromptContext = {
  kind: GestureKind;
  durationMs: number;
  intensity: number;
  ageMs: number;
};

export class GestureInterpreter {
  private handPresent = false;
  private handSeenAt = 0;
  private previousTip: Vec2 | null = null;
  private previousProximity = 0;
  private approachStartedAt = 0;
  private approachStartProximity = 0;
  private approachEmitted = false;
  private contactStartedAt = 0;
  private contactTravel = 0;
  private contactEmitted = false;
  private strokeEmitted = false;
  private travelAnchor: Vec2 | null = null;
  private movedFor = 0;
  private lastObservationAt = 0;

  observe(
    hand: HandSnapshot,
    sensation: CreatureSensation,
    creatureEvent: CreatureEvent,
    now: number,
  ): GestureObservation[] {
    const observations: GestureObservation[] = [];
    const elapsed = Math.min(100, Math.max(0, now - this.lastObservationAt));
    this.lastObservationAt = now;

    if (hand.present && !this.handPresent) {
      this.handSeenAt = now;
      this.approachStartedAt = now;
      this.approachStartProximity = sensation.proximity;
      this.approachEmitted = false;
      this.previousTip = hand.indexTip;
    }

    if (!hand.present && this.handPresent) {
      const visibleFor = Math.max(0, now - this.handSeenAt);
      if (visibleFor >= 700) {
        observations.push(observation("leaving", visibleFor, 0.35, now));
      }
      this.resetContact();
      this.previousTip = null;
    }

    if (creatureEvent === "scare") {
      observations.push(observation("fast-movement", 0, clamp01(hand.speed / 1.5), now));
    }

    if (hand.present) {
      const proximityGain = sensation.proximity - this.approachStartProximity;
      const approachDuration = now - this.approachStartedAt;
      if (
        !this.approachEmitted
        && approachDuration >= 520
        && proximityGain >= 0.2
        && hand.speed < 0.76
      ) {
        this.approachEmitted = true;
        observations.push(observation(
          "approaching",
          approachDuration,
          clamp01(proximityGain * 1.8),
          now,
        ));
      } else if (sensation.proximity + 0.04 < this.previousProximity) {
        this.approachStartedAt = now;
        this.approachStartProximity = sensation.proximity;
      }

      if (sensation.touching) {
        if (!this.contactStartedAt) {
          this.contactStartedAt = now;
          this.contactTravel = 0;
          this.contactEmitted = false;
          this.strokeEmitted = false;
          this.travelAnchor = hand.indexTip;
        }

        if (this.travelAnchor) {
          const segment = Math.hypot(
            hand.indexTip.x - this.travelAnchor.x,
            hand.indexTip.y - this.travelAnchor.y,
          );
          // Ignore sub-pixel landmark shimmer so a still fingertip is not
          // mistaken for a caress.
          if (segment >= 0.008) {
            this.contactTravel += Math.min(0.025, segment);
            this.travelAnchor = hand.indexTip;
            this.movedFor += elapsed;
          }
        }

        const contactDuration = now - this.contactStartedAt;
        if (
          !this.strokeEmitted
          && contactDuration >= 520
          && this.contactTravel >= 0.045
          && this.movedFor >= 100
          && hand.speed < 0.72
        ) {
          this.strokeEmitted = true;
          this.contactEmitted = true;
          observations.push(observation(
            "stroking",
            contactDuration,
            clamp01(0.45 + this.contactTravel * 4),
            now,
          ));
        } else if (!this.contactEmitted && contactDuration >= 820) {
          this.contactEmitted = true;
          observations.push(observation("gentle-touch", contactDuration, 0.5, now));
        }
      } else if (this.contactStartedAt) {
        const contactDuration = now - this.contactStartedAt;
        if (!this.contactEmitted && contactDuration >= 180) {
          observations.push(observation(
            "gentle-touch",
            contactDuration,
            clamp01(0.28 + contactDuration / 1800),
            now,
          ));
        }
        this.resetContact();
      }

      this.previousTip = hand.indexTip;
      this.previousProximity = sensation.proximity;
    } else {
      this.previousProximity = 0;
    }

    this.handPresent = hand.present;
    return observations;
  }

  reset() {
    this.handPresent = false;
    this.handSeenAt = 0;
    this.previousTip = null;
    this.previousProximity = 0;
    this.approachStartedAt = 0;
    this.approachStartProximity = 0;
    this.approachEmitted = false;
    this.resetContact();
  }

  private resetContact() {
    this.contactStartedAt = 0;
    this.contactTravel = 0;
    this.contactEmitted = false;
    this.strokeEmitted = false;
    this.travelAnchor = null;
    this.movedFor = 0;
  }
}

export function recentGestureContext(
  observations: GestureObservation[],
  now: number,
): GesturePromptContext[] {
  return observations
    .filter((item) => now - item.observedAt <= 30_000)
    .slice(-6)
    .map((item) => ({
      kind: item.kind,
      durationMs: Math.round(item.durationMs),
      intensity: Number(item.intensity.toFixed(2)),
      ageMs: Math.max(0, Math.round(now - item.observedAt)),
    }));
}

function observation(
  kind: GestureKind,
  durationMs: number,
  intensity: number,
  observedAt: number,
): GestureObservation {
  return {
    kind,
    durationMs: Math.max(0, Math.round(durationMs)),
    intensity: clamp01(intensity),
    observedAt,
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
