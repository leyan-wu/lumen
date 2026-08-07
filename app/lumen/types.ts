export type Vec2 = { x: number; y: number };

export type Mood = "idle" | "newborn" | "curious" | "happy" | "scared" | "lonely";

export type Personality = {
  trust: number;
  curiosity: number;
  energy: number;
  familiarity: number;
  fear: number;
  interactionCount: number;
};

export type HandSnapshot = {
  present: boolean;
  center: Vec2;
  indexTip: Vec2;
  speed: number;
  landmarks: Vec2[];
};

export const DEFAULT_PERSONALITY: Personality = {
  trust: 24,
  curiosity: 58,
  energy: 64,
  familiarity: 0,
  fear: 34,
  interactionCount: 0,
};

const STORAGE_KEY = "lumen-memory-v1";

export function loadPersonality(): Personality {
  if (typeof window === "undefined") return DEFAULT_PERSONALITY;

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!saved || typeof saved !== "object") return DEFAULT_PERSONALITY;

    const interactionCount = Math.max(0, Number(saved.interactionCount) || 0);
    return {
      trust: clampNumber(saved.trust, DEFAULT_PERSONALITY.trust),
      curiosity: clampNumber(saved.curiosity, DEFAULT_PERSONALITY.curiosity),
      energy: clampNumber(saved.energy, DEFAULT_PERSONALITY.energy),
      familiarity: clampNumber(saved.familiarity, Math.min(70, interactionCount * 2)),
      fear: clampNumber(saved.fear, DEFAULT_PERSONALITY.fear),
      interactionCount,
    };
  } catch {
    return DEFAULT_PERSONALITY;
  }
}

export function savePersonality(personality: Personality) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(personality));
}

function clampNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}
