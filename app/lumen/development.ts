import { readMemory, writeMemory } from "./storage";
import type { Personality } from "./types";

export type Development = {
  growth: number;
  visitedDays: number;
  seed: number;
  resonance: number;
  symbiosis: number;
  exploration: number;
  sensitivity: number;
  lastVisitDay: string;
  growthDay: string;
  growthToday: number;
};

export type DevelopmentEvent = "visit" | "conversation" | "touch" | "presence" | "scare";
export type DevelopmentStage = "seeded" | "unfolding" | "branching" | "mature";

export const DEFAULT_DEVELOPMENT: Development = {
  growth: 7,
  visitedDays: 0,
  seed: 0.37,
  resonance: 28,
  symbiosis: 30,
  exploration: 42,
  sensitivity: 36,
  lastVisitDay: "",
  growthDay: "",
  growthToday: 0,
};

const STORAGE_KEY = "lumen-development-v1";
const DAILY_GROWTH_LIMIT = 4.5;

export function loadDevelopment(personality: Personality): Development {
  try {
    const saved = JSON.parse(readMemory(STORAGE_KEY) ?? "null");
    if (saved && typeof saved === "object") return cleanDevelopment(saved, personality);
  } catch {
    // A damaged local memory should result in a new viable organism.
  }

  const seed = randomSeed();
  const inheritedGrowth = clamp(7 + personality.interactionCount * 0.12 + personality.familiarity * 0.08, 7, 38);
  return {
    ...DEFAULT_DEVELOPMENT,
    growth: inheritedGrowth,
    seed,
    resonance: clamp(24 + personality.familiarity * 0.18 + seededVariation(seed, 1) * 8, 12, 58),
    symbiosis: clamp(25 + personality.trust * 0.2 + seededVariation(seed, 2) * 8, 14, 62),
    exploration: clamp(30 + personality.curiosity * 0.24 + seededVariation(seed, 3) * 10, 16, 70),
    sensitivity: clamp(24 + personality.fear * 0.24 + seededVariation(seed, 4) * 8, 14, 68),
  };
}

export function beginDevelopmentVisit(development: Development, date: Date): Development {
  const day = localDayKey(date);
  const current = resetDailyGrowth(development, day);
  if (current.lastVisitDay === day) return current;

  return applyGrowth({
    ...current,
    visitedDays: current.visitedDays + 1,
    lastVisitDay: day,
    exploration: clamp(current.exploration + 0.35),
  }, 1.05);
}

export function develop(
  development: Development,
  event: DevelopmentEvent,
  date = new Date(),
): Development {
  const current = resetDailyGrowth(development, localDayKey(date));
  if (event === "visit") return beginDevelopmentVisit(current, date);

  if (event === "conversation") {
    return applyGrowth({
      ...current,
      resonance: clamp(current.resonance + 0.8),
      exploration: clamp(current.exploration + 0.18),
      sensitivity: clamp(current.sensitivity - 0.08),
    }, 0.28);
  }

  if (event === "touch") {
    return applyGrowth({
      ...current,
      symbiosis: clamp(current.symbiosis + 0.75),
      sensitivity: clamp(current.sensitivity - 0.22),
    }, 0.2);
  }

  if (event === "presence") {
    return applyGrowth({
      ...current,
      symbiosis: clamp(current.symbiosis + 0.2),
      sensitivity: clamp(current.sensitivity - 0.08),
    }, 0.06);
  }

  return applyGrowth({
    ...current,
    sensitivity: clamp(current.sensitivity + 0.9),
    symbiosis: clamp(current.symbiosis - 0.08),
  }, 0.04);
}

export function saveDevelopment(development: Development) {
  writeMemory(STORAGE_KEY, JSON.stringify(development));
}

export function developmentStage(growth: number): DevelopmentStage {
  if (growth < 18) return "seeded";
  if (growth < 42) return "unfolding";
  if (growth < 72) return "branching";
  return "mature";
}

function applyGrowth(development: Development, requestedGrowth: number) {
  const available = Math.max(0, DAILY_GROWTH_LIMIT - development.growthToday);
  const gained = Math.min(requestedGrowth, available);
  return {
    ...development,
    growth: clamp(development.growth + gained),
    growthToday: development.growthToday + gained,
  };
}

function resetDailyGrowth(development: Development, day: string) {
  if (development.growthDay === day) return development;
  return { ...development, growthDay: day, growthToday: 0 };
}

function cleanDevelopment(value: Record<string, unknown>, personality: Personality): Development {
  return {
    growth: clampNumber(value.growth, 7 + personality.familiarity * 0.08),
    visitedDays: Math.max(0, Math.floor(Number(value.visitedDays) || 0)),
    seed: clampNumber(value.seed, randomSeed(), 0, 1),
    resonance: clampNumber(value.resonance, DEFAULT_DEVELOPMENT.resonance),
    symbiosis: clampNumber(value.symbiosis, DEFAULT_DEVELOPMENT.symbiosis),
    exploration: clampNumber(value.exploration, DEFAULT_DEVELOPMENT.exploration),
    sensitivity: clampNumber(value.sensitivity, DEFAULT_DEVELOPMENT.sensitivity),
    lastVisitDay: typeof value.lastVisitDay === "string" ? value.lastVisitDay.slice(0, 10) : "",
    growthDay: typeof value.growthDay === "string" ? value.growthDay.slice(0, 10) : "",
    growthToday: clampNumber(value.growthToday, 0, 0, DAILY_GROWTH_LIMIT),
  };
}

function randomSeed() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0] / 0xffffffff;
  }
  return 0.37;
}

function seededVariation(seed: number, offset: number) {
  const value = Math.sin((seed + offset * 0.731) * 12983.17) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function localDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clampNumber(value: unknown, fallback: number, minimum = 0, maximum = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, minimum, maximum) : clamp(fallback, minimum, maximum);
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}
