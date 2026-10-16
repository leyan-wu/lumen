"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Creature } from "./lumen/creature";
import {
  GestureInterpreter,
  recentGestureContext,
  type GestureObservation,
} from "./lumen/gestures";
import { readMemory, writeMemory } from "./lumen/storage";
import { CloudVoicePlayer } from "./lumen/voice-player";
import { requestJson, requestErrorMessage, LumenRequestError } from "./lumen/requests";
import { HandTracker } from "./lumen/hand-tracker";
import {
  createConversationReply,
  type ConversationReply,
  type VoiceTone,
} from "./lumen/conversation";
import {
  beginDevelopmentVisit,
  DEFAULT_DEVELOPMENT,
  develop,
  developmentStage,
  loadDevelopment,
  saveDevelopment,
  type Development,
  type DevelopmentEvent,
} from "./lumen/development";
import {
  DEFAULT_PERSONALITY,
  loadPersonality,
  savePersonality,
  type HandSnapshot,
  type LifeActivity,
  type Mood,
  type Personality,
} from "./lumen/types";

type CameraState = "waiting" | "loading" | "active" | "error";
type VoiceState = "idle" | "listening" | "recording" | "transcribing" | "processing" | "speaking" | "error" | "unsupported";
type VoiceLanguage = "en-US" | "zh-CN";
type LumenVoice = "Maia" | "Andre" | "Neil";
type AudioInput = { deviceId: string; label: string };
type ConversationHistoryEntry = { role: "user" | "assistant"; content: string };
type BailianConversationResponse = {
  text?: string;
  tone?: VoiceTone;
  source?: string;
};
type BailianTranscriptionResponse = { transcript?: string };
type BailianDreamResponse = { dream?: string };

const EMPTY_HAND: HandSnapshot = {
  present: false,
  center: { x: 0.5, y: 0.5 },
  indexTip: { x: 0.5, y: 0.5 },
  speed: 0,
  landmarks: [],
};

const MICROPHONE_STORAGE_KEY = "lumen-microphone-v1";
const VOICE_STORAGE_KEY = "lumen-voice-v1";
const CONVERSATION_STORAGE_KEY = "lumen-conversation-memory-v1";
const MAX_RECORDING_BYTES = 3_500_000;
const MAX_RECORDING_MS = 12_000;
const VOICE_START_LEVEL = 0.026;
const VOICE_END_LEVEL = 0.018;
const VOICE_END_SILENCE_MS = 1000;
const VOICE_MIN_TURN_MS = 420;

const MOOD_COPY: Record<Mood, string> = {
  idle: "in suspension",
  newborn: "newly aware",
  curious: "orienting",
  happy: "in resonance",
  scared: "contracted",
  lonely: "dormant",
};

const ACTIVITY_COPY: Record<LifeActivity, string> = {
  dreaming: "dreaming",
  exploring: "wandering",
  feeding: "feeding",
  playing: "playing",
};

const DEVELOPMENT_COPY = {
  seeded: "seeded",
  unfolding: "unfolding",
  branching: "branching",
  mature: "mature",
} as const;

const VOICE_STATE_COPY: Record<VoiceState, string> = {
  idle: "conversation closed",
  listening: "listening for your voice",
  recording: "hearing you",
  transcribing: "understanding",
  processing: "forming a thought",
  speaking: "speaking",
  error: "waiting to try again",
  unsupported: "voice unavailable",
};

export default function LumenExperience() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handCanvasRef = useRef<HTMLCanvasElement>(null);
  const speechRef = useRef<HTMLParagraphElement>(null);
  const activityRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const creatureRef = useRef(new Creature());
  const gestureInterpreterRef = useRef(new GestureInterpreter());
  const gestureHistoryRef = useRef<GestureObservation[]>([]);
  const gestureReactionBusyRef = useRef(false);
  const lastGestureReactionAtRef = useRef(-Infinity);
  const trackerRef = useRef<HandTracker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);
  const vadFrameRef = useRef<number | null>(null);
  const vadSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const vadAnalyserRef = useRef<AnalyserNode | null>(null);
  const playerRef = useRef(new CloudVoicePlayer());
  const turnRef = useRef<AbortController | null>(null);
  const cameraAttemptRef = useRef(0);
  const microphoneAttemptRef = useRef(0);
  const lastUserSoundRef = useRef(-Infinity);
  const gestureRepliesRef = useRef<string[]>([]);
  const gestureHandlerRef = useRef<(gesture: GestureObservation) => void>(() => {});
  const lastTouchBondRef = useRef(-Infinity);
  const lastEncounterRef = useRef(-Infinity);
  const conversationActiveRef = useRef(false);
  const voiceStateRef = useRef<VoiceState>("idle");
  const greetedRef = useRef(false);
  const conversationVoiceRef = useRef<LumenVoice>("Maia");
  const conversationHistoryRef = useRef<ConversationHistoryEntry[]>([]);
  const handRef = useRef<HandSnapshot>(EMPTY_HAND);
  const cameraStateRef = useRef<CameraState>("waiting");
  const [personality, setPersonality] = useState<Personality>(DEFAULT_PERSONALITY);
  const personalityRef = useRef<Personality>(DEFAULT_PERSONALITY);
  const [development, setDevelopment] = useState<Development>(DEFAULT_DEVELOPMENT);
  const developmentRef = useRef<Development>(DEFAULT_DEVELOPMENT);
  const [cameraState, setCameraState] = useState<CameraState>("waiting");
  const [previewVisible, setPreviewVisible] = useState(true);
  const [handPresent, setHandPresent] = useState(false);
  const [mood, setMood] = useState<Mood>("idle");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [conversationActive, setConversationActive] = useState(false);
  const [voiceLanguage, setVoiceLanguage] = useState<VoiceLanguage>("en-US");
  const [selectedVoice, setSelectedVoice] = useState<LumenVoice>("Maia");
  const [gestureVoiceEnabled, setGestureVoiceEnabled] = useState(false);
  const gestureVoiceEnabledRef = useRef(false);
  const [memoryReady, setMemoryReady] = useState(false);
  const guideRef = useRef<HTMLDialogElement>(null);
  const [activity, setActivity] = useState<LifeActivity>("exploring");
  const [audioInputs, setAudioInputs] = useState<AudioInput[]>([]);
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState("");
  const [lastTranscript, setLastTranscript] = useState("");
  const [dreamText, setDreamText] = useState("");
  const [dreamOpen, setDreamOpen] = useState(false);
  const [dreamDay, setDreamDay] = useState("");
  const [dreamError, setDreamError] = useState(false);
  const [dreamLoading, setDreamLoading] = useState(false);
  const [today, setToday] = useState("");
  const [guideOpen, setGuideOpen] = useState(true);
  const [message, announce] = useMessageQueue("Lumen is listening for you");
  const [speech, speak, clearSpeech] = useLumenSpeech();

  const closeGuide = useCallback(() => {
    writeMemory("lumen-guide-seen", "true");
    setGuideOpen(false);
  }, []);

  const cancelTurn = useCallback(() => {
    turnRef.current?.abort();
    turnRef.current = null;
    playerRef.current.stop();
    gestureReactionBusyRef.current = false;
    clearSpeech();
  }, [clearSpeech]);

  const beginTurnRequest = useCallback(() => {
    turnRef.current?.abort();
    playerRef.current.stop();
    const turn = new AbortController();
    turnRef.current = turn;
    return turn;
  }, []);

  const rememberDevelopment = useCallback((event: DevelopmentEvent) => {
    const next = develop(developmentRef.current, event);
    developmentRef.current = next;
    setDevelopment(next);
    saveDevelopment(next);
  }, []);

  const rememberVoice = useCallback((response: ConversationReply) => {
    const previous = personalityRef.current;
    const next: Personality = {
      ...previous,
      trust: clamp(previous.trust + response.trustDelta),
      curiosity: clamp(previous.curiosity + response.curiosityDelta),
      energy: clamp(previous.energy + response.energyDelta),
      familiarity: clamp(previous.familiarity + response.familiarityDelta),
      fear: clamp(previous.fear + response.fearDelta),
      interactionCount: previous.interactionCount + 1,
    };
    personalityRef.current = next;
    setPersonality(next);
    savePersonality(next);
    rememberDevelopment("conversation");
  }, [rememberDevelopment]);

  const updateCameraState = useCallback((state: CameraState) => {
    cameraStateRef.current = state;
    setCameraState(state);
  }, []);

  const updateVoiceState = useCallback((state: VoiceState) => {
    voiceStateRef.current = state;
    setVoiceState(state);
  }, []);

  const refreshMicrophones = useCallback(async (preferMacBook = false) => {
    try {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === "audioinput")
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${index + 1}`,
      }));
    setAudioInputs(devices);
    setSelectedMicrophoneId((current) => {
      const saved = readMemory(MICROPHONE_STORAGE_KEY) ?? "";
      if (saved && devices.some((device) => device.deviceId === saved)) return saved;
      const macBook = devices.find((device) => /macbook/i.test(device.label));
      if (preferMacBook && macBook) return macBook.deviceId;
      if (current && devices.some((device) => device.deviceId === current)) return current;
      return macBook?.deviceId ?? "";
    });
    } catch { /* Enumeration is optional before permission is granted. */ }
  }, []);

  const remember = useCallback((event: "touch" | "scare" | "encounter" | "presence-bond") => {
    const now = performance.now();
    if (event === "touch") {
      if (now - lastTouchBondRef.current < 6000) return;
      lastTouchBondRef.current = now;
    }
    const previous = personalityRef.current;
    const next: Personality = event === "touch"
      ? {
          ...previous,
          trust: clamp(previous.trust + 2),
          curiosity: clamp(previous.curiosity + 0.7),
          energy: clamp(previous.energy + 1),
          familiarity: clamp(previous.familiarity + 2),
          fear: clamp(previous.fear - 4),
          interactionCount: previous.interactionCount + 1,
        }
        : event === "scare"
        ? {
            ...previous,
            curiosity: clamp(previous.curiosity - 0.3),
            energy: clamp(previous.energy - 1),
            familiarity: clamp(previous.familiarity + 0.2),
            fear: clamp(previous.fear + 5),
            interactionCount: previous.interactionCount + 1,
          }
        : event === "presence-bond"
          ? {
              ...previous,
              trust: clamp(previous.trust + 0.25),
              curiosity: clamp(previous.curiosity + 0.2),
              energy: clamp(previous.energy + 0.15),
              familiarity: clamp(previous.familiarity + 0.45),
              fear: clamp(previous.fear - 0.8),
              interactionCount: previous.interactionCount + 1,
            }
          : {
            ...previous,
            curiosity: clamp(previous.curiosity + 0.2),
            familiarity: clamp(previous.familiarity + 0.7),
            fear: clamp(previous.fear - 0.4),
            interactionCount: previous.interactionCount + 1,
          };

    personalityRef.current = next;
    setPersonality(next);
    savePersonality(next);
    rememberDevelopment(
      event === "touch" ? "touch" : event === "presence-bond" ? "presence" : event === "scare" ? "scare" : "visit",
    );
  }, [rememberDevelopment]);

  const handleGestureReaction = useCallback(async (gesture: GestureObservation) => {
    if (!gestureVoiceEnabledRef.current || cameraStateRef.current !== "active" || guideOpen) return;
    if (gesture.kind === "approaching" || gesture.kind === "leaving") return;
    if (gestureReactionBusyRef.current || !["idle", "listening"].includes(voiceStateRef.current)) return;
    const now = performance.now();
    // Leave space for spoken turns and don't narrate every touch.
    if (now - lastGestureReactionAtRef.current < 24_000 || now - lastUserSoundRef.current < 2000) return;
    gestureReactionBusyRef.current = true;
    lastGestureReactionAtRef.current = now;
    const turn = beginTurnRequest();
    const startedAt = now;
    updateVoiceState("processing");
    try {
      const result = await requestJson<BailianConversationResponse>("/api/lumen/converse", {
        transcript: "",
        interactionOnly: true,
        gestures: recentGestureContext(gestureHistoryRef.current, now),
        recentReactions: gestureRepliesRef.current,
        language: voiceLanguage,
        personality: personalityRef.current,
        development: developmentRef.current,
        activity: creatureRef.current.activity,
        history: conversationHistoryRef.current,
      }, turn.signal);
      turn.signal.throwIfAborted();
      const text = result.text?.trim();
      if (!text || !handRef.current.present || performance.now() - startedAt > 10_000) return;
      const normalize = (value: string) => value.toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
      if (gestureRepliesRef.current.some(previous => normalize(previous) === normalize(text))) return;
      gestureRepliesRef.current = [...gestureRepliesRef.current, text].slice(-6);
      creatureRef.current.hear(isVoiceTone(result.tone) ? result.tone : "neutral", performance.now());
      speak(text);
      updateVoiceState("speaking");
      const spoken = await playerRef.current.speak(text, voiceLanguage,
        conversationActiveRef.current ? conversationVoiceRef.current : selectedVoice, turn.signal);
      turn.signal.throwIfAborted();
      if (!spoken) announce("The voice connection paused. Lumen’s words are still here.", 5000, true);
    } catch (error) {
      // A failed gesture remains a physical response, not a canned sentence.
      if (!turn.signal.aborted) {
        console.warn("Gesture response unavailable", error);
        announce(voiceLanguage === "zh-CN" ? "语音暂时没有接通，Lumen 仍能感受到你的手。" : "Voice is unavailable; Lumen still responds to your hand.", 5000, true);
      }
    } finally {
      if (turnRef.current === turn) {
        turnRef.current = null;
        gestureReactionBusyRef.current = false;
        lastGestureReactionAtRef.current = performance.now();
        lastUserSoundRef.current = performance.now();
        updateVoiceState(conversationActiveRef.current ? "listening" : "idle");
      }
    }
  }, [announce, beginTurnRequest, guideOpen, selectedVoice, speak, updateVoiceState, voiceLanguage]);

  useEffect(() => { gestureHandlerRef.current = gesture => { void handleGestureReaction(gesture); }; }, [handleGestureReaction]);

  useEffect(() => {
    let active = true;

    // Read device-local memory only after hydration. The server and the first
    // client render must use the same defaults.
    queueMicrotask(() => {
      if (!active) return;
      const memory = loadPersonality();
      personalityRef.current = memory;
      setPersonality(memory);
      const rememberedDevelopment = beginDevelopmentVisit(loadDevelopment(memory), new Date());
      developmentRef.current = rememberedDevelopment;
      setDevelopment(rememberedDevelopment);
      saveDevelopment(rememberedDevelopment);
      setToday(localDayKey(new Date()));
      const currentActivity = lifeActivityFor(new Date());
      creatureRef.current.setActivity(currentActivity);
      setActivity(currentActivity);
      const rememberedVoice = readMemory(VOICE_STORAGE_KEY);
      if (rememberedVoice === "Andre" || rememberedVoice === "Neil" || rememberedVoice === "Maia") {
        setSelectedVoice(rememberedVoice);
      }
      conversationHistoryRef.current = loadConversationHistory();
      setGuideOpen(readMemory("lumen-guide-seen") !== "true");
      setMemoryReady(true);
      void refreshMicrophones();
      announce("Open the camera for touch, or begin a conversation.", 5500);
    });

    return () => {
      active = false;
    };
  }, [announce, refreshMicrophones]);

  useEffect(() => {
    const updateActivity = () => {
      const scheduled = lifeActivityFor(new Date());
      const next = scheduled === "dreaming" && (conversationActiveRef.current || handRef.current.present) ? "exploring" : scheduled;
      creatureRef.current.setActivity(next);
      setActivity(next);
      setDreamDay(localDayKey(new Date()));
    };
    updateActivity();
    const timer = window.setInterval(updateActivity, 30_000);
    return () => window.clearInterval(timer);
  }, [handPresent, conversationActive]);

  useEffect(() => {
    if (!memoryReady) return;
    const day = today || localDayKey(new Date());
    const cacheKey = `lumen-dream-v1:${day}:${voiceLanguage}`;
    const lastKey = `lumen-last-dream:${voiceLanguage}`;
    const cached = readMemory(cacheKey);
    let last: { text: string; day: string } | null = null;
    try {
      const stored = JSON.parse(readMemory(lastKey) || "null");
      if (typeof stored?.text === "string" && typeof stored?.day === "string") last = stored;
    } catch { /* Ignore damaged dream memory. */ }
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setDreamText(cached || last?.text || "");
      setDreamDay(cached ? day : last?.day || "");
      setDreamError(false);
      setDreamLoading(!cached && activity === "dreaming");
    });
    if (cached || activity !== "dreaming") return () => controller.abort();
    void (async () => {
      try {
        const result = await requestJson<BailianDreamResponse>("/api/lumen/dream", {
          language: voiceLanguage, personality: personalityRef.current, day,
        }, controller.signal);
        controller.signal.throwIfAborted();
        if (!result.dream?.trim()) throw new Error("Empty dream");
        const dream = result.dream.trim();
        writeMemory(cacheKey, dream);
        writeMemory(lastKey, JSON.stringify({ text: dream, day }));
        setDreamText(dream);
        setDreamDay(day);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("Dream unavailable", error);
          setDreamError(true);
        }
      } finally {
        if (!controller.signal.aborted) setDreamLoading(false);
      }
    })();
    return () => controller.abort();
  }, [voiceLanguage, memoryReady, dreamOpen, activity, today]);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => void refreshMicrophones();
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [refreshMicrophones]);

  useEffect(() => {
    const dialog = guideRef.current;
    if (guideOpen && memoryReady && dialog) {
      dialog.showModal();
      dialog.focus({ preventScroll: true });
      dialog.scrollTop = 0;
    } else dialog?.close();
  }, [guideOpen, memoryReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let animationFrame = 0;
    let previousTime = performance.now();
    let previousMood: Mood = "idle";
    let previousHandPresence = false;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const render = (now: number) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const delta = Math.min(0.034, Math.max(0.001, (now - previousTime) / 1000));
      previousTime = now;

      const video = videoRef.current;
      const tracker = trackerRef.current;
      try {
        handRef.current = cameraStateRef.current === "active" && video && tracker && !document.hidden
          ? tracker.update(video, now)
          : EMPTY_HAND;
      } catch {
        handRef.current = EMPTY_HAND;
        trackerRef.current?.close();
        trackerRef.current = null;
        streamRef.current?.getTracks().forEach(track => track.stop());
        updateCameraState("error");
        announce("Hand tracking paused. Reopen the camera to try again.", 6000, true);
      }
      if (handRef.current.present !== previousHandPresence) {
        previousHandPresence = handRef.current.present;
        setHandPresent(previousHandPresence);
        if (previousHandPresence && now - lastEncounterRef.current > 30_000) {
          lastEncounterRef.current = now;
          remember("encounter");
        }
      }
      if (handCanvasRef.current) drawHandPreview(handCanvasRef.current, handRef.current);

      const creature = creatureRef.current;
      const event = creature.step(
        handRef.current,
        personalityRef.current,
        width,
        height,
        now,
        delta,
        (controlsRef.current?.offsetTop ?? height) - 32,
      );
      const gestureObservations = gestureInterpreterRef.current.observe(
        handRef.current,
        creature.sense(),
        event,
        now,
      );
      for (const observation of gestureObservations) {
        gestureHistoryRef.current = [...gestureHistoryRef.current, observation]
          .filter((item) => now - item.observedAt <= 30_000)
          .slice(-8);
        gestureHandlerRef.current(observation);
      }
      if (event === "touch") {
        remember(event);
      }
      if (event === "scare") {
        remember(event);
      }
      if (event === "presence-bond") {
        remember(event);
      }
      if (creature.mood !== previousMood) {
        previousMood = creature.mood;
        setMood(creature.mood);
      }

      if (speechRef.current) {
        const speechOffset = Math.max(108, Math.min(width, height) * 0.19);
        const halfWidth = speechRef.current.offsetWidth / 2 + 16;
        speechRef.current.style.left = `${Math.max(halfWidth, Math.min(width - halfWidth, creature.position.x))}px`;
        speechRef.current.style.top = `${Math.max(96, Math.min(height * 0.48, creature.position.y - speechOffset))}px`;
      }
      if (activityRef.current) {
        activityRef.current.style.left = `${creature.position.x}px`;
        activityRef.current.style.top = `${Math.min((controlsRef.current?.offsetTop ?? height) - 20, creature.position.y + Math.min(width, height) * 0.18)}px`;
      }

      creature.draw(
        context,
        width,
        height,
        now,
        personalityRef.current,
        developmentRef.current,
        handRef.current,
      );
      if (handRef.current.present) {
        const tip = handRef.current.indexTip;
        context.save();
        context.strokeStyle = creature.sense().touching ? "#d8ffc0" : "rgba(184, 241, 219, .65)";
        context.lineWidth = 1.4;
        context.beginPath();
        context.arc(tip.x * width, tip.y * height, creature.sense().touching ? 10 : 6, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
      animationFrame = requestAnimationFrame(render);
    };

    animationFrame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
    };
  }, [announce, remember, updateCameraState]);

  useEffect(() => () => {
    if (recordingTimeoutRef.current !== null) window.clearTimeout(recordingTimeoutRef.current);
    if (vadFrameRef.current !== null) window.cancelAnimationFrame(vadFrameRef.current);
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    vadSourceRef.current?.disconnect();
    vadAnalyserRef.current?.disconnect();
    turnRef.current?.abort();
    cameraAttemptRef.current++;
    microphoneAttemptRef.current++;
    playerRef.current.close();
    trackerRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const handleVoiceTranscript = useCallback(async (transcript: string, turn: AbortController) => {
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript || turn.signal.aborted) return;
    updateVoiceState("processing");
    setLastTranscript(cleanTranscript);
    clearSpeech();
    const result = await requestJson<BailianConversationResponse>("/api/lumen/converse", {
      transcript: cleanTranscript,
      language: voiceLanguage,
      personality: personalityRef.current,
      development: developmentRef.current,
      activity: creatureRef.current.activity,
      history: conversationHistoryRef.current,
      gestures: recentGestureContext(gestureHistoryRef.current, performance.now()),
    }, turn.signal);
    turn.signal.throwIfAborted();
    if (!result.text?.trim()) throw new Error("Empty response");
    const response = {
      ...createConversationReply(cleanTranscript, personalityRef.current, personalityRef.current.interactionCount),
      text: result.text.trim(),
      tone: isVoiceTone(result.tone) ? result.tone : "neutral" as VoiceTone,
    };
    conversationHistoryRef.current = [
      ...conversationHistoryRef.current,
      { role: "user" as const, content: cleanTranscript },
      { role: "assistant" as const, content: response.text },
    ].slice(-16);
    saveConversationHistory(conversationHistoryRef.current);
    creatureRef.current.hear(response.tone, performance.now());
    rememberVoice(response);
    speak(response.text);
    updateVoiceState("speaking");
    const spoken = await playerRef.current.speak(response.text, voiceLanguage, conversationVoiceRef.current, turn.signal);
    turn.signal.throwIfAborted();
    if (!spoken) announce(voiceLanguage === "zh-CN" ? "语音连接暂停了，你可以继续阅读这段回复。" : "The voice connection paused. You can still read the reply.", 5000, true);
  }, [announce, clearSpeech, rememberVoice, speak, updateVoiceState, voiceLanguage]);

  const transcribeRecording = useCallback(async (blob: Blob) => {
    if (!conversationActiveRef.current) return;
    if (blob.size < 400) { updateVoiceState("listening"); return; }
    const turn = beginTurnRequest();
    try {
      if (blob.size > MAX_RECORDING_BYTES) throw new Error("Recording too large");
      updateVoiceState("transcribing");
      const audio = await blobToDataUrl(blob);
      turn.signal.throwIfAborted();
      const result = await requestJson<BailianTranscriptionResponse>("/api/lumen/transcribe", {
        audio, language: voiceLanguage,
      }, turn.signal);
      turn.signal.throwIfAborted();
      if (!result.transcript?.trim()) throw new Error("No transcript");
      await handleVoiceTranscript(result.transcript, turn);
    } catch (error) {
      if (turn.signal.aborted) return;
      console.warn("Voice turn failed", { error, mimeType: blob.type, bytes: blob.size });
      announce(requestErrorMessage(error, voiceLanguage === "zh-CN"), 6500, true);
      if (error instanceof LumenRequestError && [402, 503].includes(error.status)) {
        conversationActiveRef.current = false;
        setConversationActive(false);
        microphoneStreamRef.current?.getTracks().forEach(track => track.stop());
        microphoneStreamRef.current = null;
        if (vadFrameRef.current !== null) cancelAnimationFrame(vadFrameRef.current);
        vadSourceRef.current?.disconnect();
        vadAnalyserRef.current?.disconnect();
      }
    } finally {
      if (turnRef.current === turn) {
        // Let the speaker's final tail fade before listening again.
        recordingTimeoutRef.current = window.setTimeout(() => {
          if (turnRef.current !== turn || turn.signal.aborted) return;
          turnRef.current = null;
          updateVoiceState(conversationActiveRef.current ? "listening" : "idle");
        }, 700);
      }
    }
  }, [announce, beginTurnRequest, handleVoiceTranscript, updateVoiceState, voiceLanguage]);

  const stopConversation = useCallback((showStatus = true) => {
    microphoneAttemptRef.current++;
    conversationActiveRef.current = false;
    setConversationActive(false);
    cancelTurn();
    if (vadFrameRef.current !== null) window.cancelAnimationFrame(vadFrameRef.current);
    vadFrameRef.current = null;
    if (recordingTimeoutRef.current !== null) window.clearTimeout(recordingTimeoutRef.current);
    recordingTimeoutRef.current = null;
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    recorderRef.current = null;
    microphoneStreamRef.current?.getTracks().forEach(track => track.stop());
    microphoneStreamRef.current = null;
    vadSourceRef.current?.disconnect();
    vadSourceRef.current = null;
    vadAnalyserRef.current?.disconnect();
    vadAnalyserRef.current = null;
    updateVoiceState("idle");
    if (showStatus) announce("Conversation closed.", 3200, true);
  }, [announce, cancelTurn, updateVoiceState]);

  useEffect(() => {
    const pause = () => {
      if (document.hidden) {
        stopConversation(false);
        gestureVoiceEnabledRef.current = false;
        setGestureVoiceEnabled(false);
      }
    };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, [stopConversation]);

  const startConversation = useCallback(async () => {
    if (!("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) {
      updateVoiceState("unsupported");
      announce("This browser cannot open a path to your voice.", 5200, true);
      return;
    }

    const attempt = ++microphoneAttemptRef.current;
    const turn = beginTurnRequest();
    conversationActiveRef.current = true;
    setConversationActive(true);
    try {
      // Lock one cloud timbre for the full conversation. The selector remains
      // disabled until the visit closes, so retries cannot drift to a new voice.
      conversationVoiceRef.current = selectedVoice;
      updateVoiceState("processing");
      const audioContext = await playerRef.current.unlock();
      turn.signal.throwIfAborted();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(selectedMicrophoneId ? { deviceId: { exact: selectedMicrophoneId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });
      if (attempt !== microphoneAttemptRef.current || turn.signal.aborted) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      microphoneStreamRef.current = stream;
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (attempt !== microphoneAttemptRef.current) return;
        stopConversation(false);
        announce("Microphone disconnected. Choose a microphone and reconnect.", 6000, true);
      }, { once: true });
      void refreshMicrophones();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.18;
      source.connect(analyser);
      vadSourceRef.current = source;
      vadAnalyserRef.current = analyser;
      conversationActiveRef.current = true;
      setConversationActive(true);

      const samples = new Uint8Array(analyser.fftSize);
      let speechFrames = 0;
      let recordingStartedAt = 0;
      let lastVoiceAt = 0;
      let noiseFloor = 0.006;

      const beginTurn = (now: number) => {
        try {
        const mimeType = preferredRecordingMimeType();
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        const chunks: Blob[] = [];
        recorderRef.current = recorder;
        recordingStartedAt = now;
        lastVoiceAt = now;
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };
        recorder.onstop = () => {
          recorderRef.current = null;
          if (attempt !== microphoneAttemptRef.current || !conversationActiveRef.current) return;
          const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "audio/webm" });
          void transcribeRecording(blob);
        };
        recorder.onerror = () => {
          if (attempt !== microphoneAttemptRef.current) return;
          stopConversation(false);
          announce("Recording stopped. Please reconnect your microphone.", 6000, true);
        };
        recorder.start();
        clearSpeech();
        updateVoiceState("recording");
        } catch {
          stopConversation(false);
          announce("This microphone could not start recording. Try another input.", 6000, true);
        }
      };

      const monitorVoice = (now: number) => {
        if (!conversationActiveRef.current || attempt !== microphoneAttemptRef.current) return;
        const state = voiceStateRef.current;
        if (state === "listening" || state === "recording") {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) {
            const normalized = (sample - 128) / 128;
            sum += normalized * normalized;
          }
          const level = Math.sqrt(sum / samples.length);
          if (state === "listening" && level < VOICE_START_LEVEL) noiseFloor += (level - noiseFloor) * 0.04;
          const startLevel = Math.max(0.015, Math.min(VOICE_START_LEVEL, noiseFloor * 2.8));
          const endLevel = Math.max(0.009, Math.min(VOICE_END_LEVEL, noiseFloor * 1.8));
          if (level >= startLevel) lastUserSoundRef.current = now;
          const recorder = recorderRef.current;
          if (recorder?.state === "recording") {
            if (level >= endLevel) lastVoiceAt = now;
            const longEnough = now - recordingStartedAt > VOICE_MIN_TURN_MS;
            const finished = longEnough && now - lastVoiceAt > VOICE_END_SILENCE_MS;
            if (finished || now - recordingStartedAt >= MAX_RECORDING_MS) {
              updateVoiceState("transcribing");
              recorder.stop();
            }
          } else if (state === "listening") {
            speechFrames = level >= startLevel ? speechFrames + 1 : 0;
            if (speechFrames >= 3) {
              speechFrames = 0;
              beginTurn(now);
            }
          }
        }
        if (conversationActiveRef.current) vadFrameRef.current = window.requestAnimationFrame(monitorVoice);
      };
      vadFrameRef.current = window.requestAnimationFrame(monitorVoice);

      if (!greetedRef.current) {
        greetedRef.current = true;
        const returning = conversationHistoryRef.current.length > 0 || personalityRef.current.familiarity >= 5;
        const greeting = voiceLanguage === "zh-CN"
          ? returning ? "嘿，你回来了。" : "你好。我是 Lumen。"
          : returning ? "Hey, you're back." : "Hello. I’m Lumen.";
        speak(greeting);
        creatureRef.current.hear("warm", performance.now());
        updateVoiceState("speaking");
        const spoken = await playerRef.current.speak(greeting, voiceLanguage, conversationVoiceRef.current, turn.signal);
        turn.signal.throwIfAborted();
        if (!spoken) announce("The cloud voice could not surface this turn.", 4200, true);
      }
      if (turn.signal.aborted || attempt !== microphoneAttemptRef.current) return;
      turnRef.current = null;
      if (conversationActiveRef.current) updateVoiceState("listening");
      announce("Conversation open · speak naturally.", 3400, true);
    } catch (error) {
      if (turn.signal.aborted || attempt !== microphoneAttemptRef.current) return;
      console.warn("Lumen could not start recording", error);
      stopConversation(false);
      updateVoiceState("error");
      announce("Choose a microphone and allow Lumen to hear it.", 4400, true);
    }
  }, [announce, beginTurnRequest, clearSpeech, refreshMicrophones, selectedMicrophoneId, selectedVoice, speak, stopConversation, transcribeRecording, updateVoiceState, voiceLanguage]);

  const toggleConversation = useCallback(() => {
    if (conversationActiveRef.current) stopConversation();
    else void startConversation();
  }, [startConversation, stopConversation]);

  const startCamera = async () => {
    if (cameraStateRef.current === "loading") return;
    updateCameraState("loading");
    announce("Opening camera…", 2400, true);

    const attempt = ++cameraAttemptRef.current;
    let pendingTracker: HandTracker | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 960 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (attempt !== cameraAttemptRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error("Video element unavailable");
      video.srcObject = stream;
      await video.play();

      const tracker = new HandTracker();
      pendingTracker = tracker;
      await tracker.initialize();
      if (attempt !== cameraAttemptRef.current) { tracker.close(); return; }
      trackerRef.current = tracker;
      updateCameraState("active");
      void refreshMicrophones(true);
      announce("Choose a microphone, then begin conversation.", 3600);
    } catch (error) {
      pendingTracker?.close();
      if (attempt !== cameraAttemptRef.current) return;
      console.error("Lumen could not start hand tracking", error);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      updateCameraState("error");
      announce("Lumen could not see you. Camera access may be blocked.", 4800, true);
    }
  };

  const stopCamera = () => {
    cameraAttemptRef.current++;
    stopConversation(false);
    gestureVoiceEnabledRef.current = false;
    setGestureVoiceEnabled(false);
    trackerRef.current?.close();
    trackerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    handRef.current = EMPTY_HAND;
    gestureInterpreterRef.current.reset();
    gestureHistoryRef.current = [];
    gestureReactionBusyRef.current = false;
    setHandPresent(false);
    greetedRef.current = false;
    setLastTranscript("");
    updateCameraState("waiting");
    announce("Visit ended.", 2600);
  };

  return (
    <main className="experience">
      <canvas ref={canvasRef} className="lumen-canvas" aria-label="Lumen, a developing cell-like digital lifeform" />
      <p
        ref={speechRef}
        className={`lumen-speech ${speech ? "is-visible" : ""}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {speech ? `“${speech}”` : ""}
      </p>
      <div ref={activityRef} className={`life-activity is-${activity}`} aria-label={`Lumen is ${ACTIVITY_COPY[activity]}`}>
        <span aria-hidden="true">{activity === "dreaming" ? "z · z" : activity === "feeding" ? "· ◦ ·" : activity === "playing" ? "↝" : "⌁"}</span>
        <small>{ACTIVITY_COPY[activity]}</small>
      </div>

      <aside
        className={`hand-preview ${cameraState === "active" ? "is-visible" : ""} ${previewVisible ? "" : "is-collapsed"}`}
        aria-label="Live hand tracking preview"
        aria-hidden={cameraState !== "active"}
        inert={cameraState !== "active"}
      >
        <button
          className="preview-toggle"
          type="button"
          onClick={() => setPreviewVisible((visible) => !visible)}
          aria-label={previewVisible ? "Hide hand preview" : "Show hand preview"}
        >
          {previewVisible ? "hide" : "hand view"}
        </button>
        <div className="preview-frame">
          <video ref={videoRef} className="tracking-video" muted playsInline aria-hidden="true" />
          <canvas ref={handCanvasRef} className="tracking-overlay" aria-hidden="true" />
          <div className="preview-caption">
            <span className={`preview-signal ${handPresent ? "has-hand" : ""}`} />
            <span>{handPresent ? "hand visible" : "show one hand"}</span>
          </div>
        </div>
      </aside>

      <header className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>Lumen</span>
        <button className="help-button" type="button" onClick={() => setGuideOpen(true)} aria-label="How to interact with Lumen">?</button>
      </header>

      <div className="presence" aria-live="polite">
        <span className={`presence-dot ${cameraState === "active" ? "is-active" : ""}`} />
        <span>
          {DEVELOPMENT_COPY[developmentStage(development.growth)]} · {cameraState === "active"
            ? `${ACTIVITY_COPY[activity]} · ${MOOD_COPY[mood]}`
            : ACTIVITY_COPY[activity]}
        </span>
      </div>

      <section ref={controlsRef} className="invitation" aria-label="Hand interaction controls">
        <p className="message" key={message}>{message}</p>
        <p className={`conversation-transcript ${lastTranscript ? "is-visible" : ""}`} aria-live="polite">
          <span>you</span>{lastTranscript}
        </p>
        <div className="visit-controls">
          <div className="voice-control">
            <button
              className={`voice-button ${conversationActive ? "is-listening" : ""}`}
              type="button"
              onClick={toggleConversation}
              aria-pressed={conversationActive}
              disabled={!conversationActive && (voiceState === "transcribing" || voiceState === "processing" || voiceState === "speaking")}
              aria-label={conversationActive ? "End continuous conversation" : "Begin continuous conversation"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6" /></svg>
              <span>{conversationActive ? "End conversation" : "Talk to Lumen"}</span>
              <span className="voice-orb" aria-hidden="true" />
            </button>
            <button
              className={`touch-button ${cameraState === "active" ? "is-active" : ""}`}
              type="button"
              onClick={cameraState === "active" || cameraState === "loading" ? stopCamera : startCamera}
              aria-label={cameraState === "active" || cameraState === "loading" ? "Turn off camera" : "Let Lumen see you"}
              aria-pressed={cameraState === "active"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="3" /><path d="m16 10 5-3v10l-5-3" /></svg>
              <span>{cameraState === "loading" ? "Cancel camera" : cameraState === "active" ? "Camera on" : cameraState === "error" ? "Retry camera" : "Enable touch"}</span>
            </button>
            <button className="settings-toggle" type="button" popoverTarget="interaction-settings" aria-label="Interaction settings" title="Interaction settings">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none" /><circle cx="15" cy="17" r="3" fill="currentColor" stroke="none" /></svg>
            </button>
          </div>
          <p className={`voice-status ${conversationActive ? "is-active" : ""}`} aria-live="polite">
            {voiceState === "idle" ? "A little company. A conversation, or a gentle touch." : VOICE_STATE_COPY[voiceState]}
          </p>
        </div>
        <div className="interaction-settings" id="interaction-settings" popover="auto" aria-labelledby="settings-title">
          <div className="settings-heading">
            <div><span className="settings-kicker">YOUR SPACE</span><h2 id="settings-title">Interaction settings</h2></div>
            <button type="button" className="settings-close" popoverTarget="interaction-settings" popoverTargetAction="hide" aria-label="Close settings">×</button>
          </div>
          <p className="settings-note">{conversationActive ? "End the conversation to change your voice or microphone." : "Choose what feels comfortable. Your camera is optional."}</p>
          <div className="settings-field">
            <label htmlFor="microphone-input">Microphone</label>
              <select
                id="microphone-input"
                className="microphone-select"
                value={selectedMicrophoneId}
                onChange={(event) => {
                  const deviceId = event.target.value;
                  setSelectedMicrophoneId(deviceId);
                  writeMemory(MICROPHONE_STORAGE_KEY, deviceId);
                }}
                disabled={conversationActive || (voiceState !== "idle" && voiceState !== "error")}
                aria-label="Microphone used to speak to Lumen"
                title="Microphone used to speak to Lumen"
              >
                <option value="">system microphone</option>
                {audioInputs.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                ))}
              </select>
          </div>
          <div className="settings-field">
            <label htmlFor="lumen-voice-input">Lumen’s voice</label>
              <select
                id="lumen-voice-input"
                className="lumen-voice-select"
                value={selectedVoice}
                onChange={(event) => {
                  const voice = event.target.value as LumenVoice;
                  setSelectedVoice(voice);
                  writeMemory(VOICE_STORAGE_KEY, voice);
                }}
                disabled={conversationActive || voiceState === "processing" || voiceState === "speaking"}
                aria-label="Lumen voice"
                title="Lumen voice"
              >
                <option value="Maia">Maia · quiet</option>
                <option value="Andre">Andre · steady</option>
                <option value="Neil">Neil · precise</option>
              </select>
          </div>
          <div className="settings-field">
            <span id="language-label">Conversation language</span>
            <button className="voice-language" type="button"
              onClick={() => setVoiceLanguage((language) => language === "en-US" ? "zh-CN" : "en-US")}
              disabled={conversationActive || voiceState === "processing" || voiceState === "speaking"}
              aria-label={`Voice language: ${voiceLanguage === "zh-CN" ? "Chinese" : "English"}. Click to change.`}
            >{voiceLanguage === "zh-CN" ? "中文 ⇄" : "English ⇄"}</button>
          </div>
          <div className="settings-field settings-gesture">
            <div><span id="gesture-label">Respond to touch</span><small>{cameraState === "active" ? "Occasional spoken reactions to your hand" : "Enable the camera to hear touch reactions"}</small></div>
              <button
                type="button"
                className="gesture-voice-button"
                aria-labelledby="gesture-label"
                disabled={cameraState !== "active"}
                aria-pressed={gestureVoiceEnabled}
                onClick={async () => {
                  if (gestureVoiceEnabledRef.current) {
                    gestureVoiceEnabledRef.current = false;
                    setGestureVoiceEnabled(false);
                    if (gestureReactionBusyRef.current) { cancelTurn(); updateVoiceState(conversationActiveRef.current ? "listening" : "idle"); }
                    return;
                  }
                  try {
                    await playerRef.current.unlock();
                    gestureVoiceEnabledRef.current = true;
                    setGestureVoiceEnabled(true);
                  } catch { announce("Sound could not start. Please try again.", 4000, true); }
                }}
              ><span aria-hidden="true" />{gestureVoiceEnabled ? "On" : "Off"}</button>
          </div>
        </div>
      </section>

      <aside className="memory" title="Bond grows through calm contact and conversation; memory is saved in this browser.">
        <span>bond</span>
        <span className="memory-line"><i style={{ width: `${personality.trust}%` }} /></span>
      </aside>

      <aside className={`dream-journal ${dreamOpen ? "is-open" : ""}`} aria-label="Lumen's dream journal">
        <button
          type="button"
          className="dream-toggle"
          onClick={() => setDreamOpen((open) => !open)}
          aria-expanded={dreamOpen}
        >
          <span>{activity === "dreaming" ? "dreaming now" : "last dream"}</span>
          <i aria-hidden="true" />
        </button>
        <div className="dream-entry" aria-hidden={!dreamOpen}>
          <time>{dreamDay}</time>
          <p>{dreamText || (dreamError ? "The dream could not surface. Close and reopen the journal while Lumen sleeps to try again." : dreamLoading ? "A dream is taking shape…" : "No dream here yet. Lumen leaves one after sleeping in this space.")}</p>
        </div>
      </aside>

      <p className="privacy">Camera stays on this device · voice clips &amp; gesture summaries go to Bailian</p>

      <dialog ref={guideRef} tabIndex={-1} className="guide-backdrop" aria-labelledby="guide-title" onCancel={closeGuide}>
          <section className="guide-card">
            <p className="guide-kicker">a life forming in digital water</p>
            <h1 id="guide-title">Meet Lumen</h1>
            <p className="guide-intro">
              Lumen is a fluid artificial organism rather than a cartoon animal. Its membrane and inner light change as you spend time together. Memory belongs to this browser.
            </p>
            <div className="guide-grid">
              <article>
                <span>01 · talk</span>
                <p>Choose Talk to Lumen, speak naturally, then pause for a reply. Microphone, language and voice options are in settings. The camera is optional for talking.</p>
              </article>
              <article>
                <span>02 · reach</span>
                <p>Move one hand slowly. Its membrane notices your approach. Bring your fingertip to its membrane and move gently. Enable touch to open the camera. For occasional spoken reactions, turn on Respond to touch in settings.</p>
              </article>
              <article>
                <span>03 · return</span>
                <p>Conversation, calm contact, and visits on different days slowly grow Lumen. Different relationships produce different bodies.</p>
              </article>
            </div>
            <p className="guide-note">Its latest dream stays here after it wakes. Camera images stay on this device; voice clips and gesture summaries go to Bailian.</p>
            <button className="guide-enter" type="button" onClick={closeGuide}>enter Lumen’s world</button>
          </section>
      </dialog>
    </main>
  );
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function lifeActivityFor(date: Date): LifeActivity {
  const hour = date.getHours();
  if (hour < 7 || hour >= 23 || hour === 13) return "dreaming";

  // Keep sleep tied to local time, but cycle awake behavior quickly enough for
  // a short prototype visit to reveal more than one part of Lumen's life.
  const awakeCycle: LifeActivity[] = ["exploring", "feeding", "exploring", "playing"];
  const twoMinuteSlot = date.getHours() * 30 + Math.floor(date.getMinutes() / 2);
  return awakeCycle[twoMinuteSlot % awakeCycle.length];
}

function localDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function loadConversationHistory(): ConversationHistoryEntry[] {
  try {
    const stored = JSON.parse(readMemory(CONVERSATION_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored.slice(-16).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const source = entry as Record<string, unknown>;
      const role = source.role === "user" || source.role === "assistant" ? source.role : null;
      const content = typeof source.content === "string" ? source.content.trim().slice(0, 220) : "";
      return role && content ? [{ role, content }] : [];
    });
  } catch {
    return [];
  }
}

function saveConversationHistory(history: ConversationHistoryEntry[]) {
  writeMemory(CONVERSATION_STORAGE_KEY, JSON.stringify(history.slice(-16)));
}

function isVoiceTone(value: unknown): value is VoiceTone {
  return value === "warm" || value === "curious" || value === "uneasy" || value === "neutral";
}

function preferredRecordingMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("Recording could not be encoded"));
    reader.onerror = () => reject(reader.error ?? new Error("Recording could not be read"));
    reader.readAsDataURL(blob);
  });
}

function useMessageQueue(initial: string) {
  const [message, setMessage] = useState(initial);
  const timer = useRef<number | null>(null);
  const announce = useCallback((text: string, duration = 5000, _priority = false) => {
    void _priority;
    if (timer.current !== null) clearTimeout(timer.current);
    setMessage(text);
    timer.current = window.setTimeout(() => { setMessage(""); timer.current = null; }, Math.max(4500, duration));
  }, []);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  return [message, announce] as const;
}

function useLumenSpeech() {
  const [speech, setSpeech] = useState<string | null>(null);
  const speak = useCallback((text: string) => setSpeech(text), []);
  const clearSpeech = useCallback(() => setSpeech(null), []);
  return [speech, speak, clearSpeech] as const;
}

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [17, 0],
] as const;

function drawHandPreview(canvas: HTMLCanvasElement, hand: HandSnapshot) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;

  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const targetWidth = Math.round(width * ratio);
  const targetHeight = Math.round(height * ratio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!hand.present || hand.landmarks.length < 21) return;

  const point = (index: number) => ({
    x: hand.landmarks[index].x * width,
    y: hand.landmarks[index].y * height,
  });

  context.save();
  context.globalCompositeOperation = "screen";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 1.15;
  context.strokeStyle = "rgba(165, 248, 221, .72)";
  context.shadowColor = "rgba(99, 239, 199, .55)";
  context.shadowBlur = 5;
  context.beginPath();
  for (const [from, to] of HAND_CONNECTIONS) {
    const start = point(from);
    const end = point(to);
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
  }
  context.stroke();

  context.shadowBlur = 7;
  for (let index = 0; index < hand.landmarks.length; index += 1) {
    const landmark = point(index);
    const isTip = index === 8;
    context.fillStyle = isTip ? "rgba(231, 255, 184, .96)" : "rgba(150, 239, 211, .72)";
    context.beginPath();
    context.arc(landmark.x, landmark.y, isTip ? 3.6 : 1.45, 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = "rgba(225, 255, 197, .76)";
  context.beginPath();
  context.arc(hand.center.x * width, hand.center.y * height, 2.5, 0, Math.PI * 2);
  context.fill();
  context.restore();
}
