"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Creature } from "./lumen/creature";
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
type ReplySource = "none" | "bailian" | "local";
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
const VOICE_END_SILENCE_MS = 620;
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const creatureRef = useRef(new Creature());
  const trackerRef = useRef<HandTracker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const recordingTimeoutRef = useRef<number | null>(null);
  const vadFrameRef = useRef<number | null>(null);
  const vadSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const vadAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const conversationActiveRef = useRef(false);
  const voiceStateRef = useRef<VoiceState>("idle");
  const greetedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
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
  const [replySource, setReplySource] = useState<ReplySource>("none");
  const [activity, setActivity] = useState<LifeActivity>("exploring");
  const [audioInputs, setAudioInputs] = useState<AudioInput[]>([]);
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState("");
  const [lastTranscript, setLastTranscript] = useState("");
  const [dreamText, setDreamText] = useState("");
  const [dreamOpen, setDreamOpen] = useState(false);
  const [dreamDay, setDreamDay] = useState("");
  const [guideOpen, setGuideOpen] = useState(true);
  const [message, announce] = useMessageQueue("Lumen is listening for you");
  const [speech, speak] = useLumenSpeech();

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
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === "audioinput")
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${index + 1}`,
      }));
    setAudioInputs(devices);
    setSelectedMicrophoneId((current) => {
      const saved = window.localStorage.getItem(MICROPHONE_STORAGE_KEY) ?? "";
      if (saved && devices.some((device) => device.deviceId === saved)) return saved;
      const macBook = devices.find((device) => /macbook/i.test(device.label));
      if (preferMacBook && macBook) return macBook.deviceId;
      if (current && devices.some((device) => device.deviceId === current)) return current;
      return macBook?.deviceId ?? devices[0]?.deviceId ?? "";
    });
  }, []);

  const remember = useCallback((event: "touch" | "scare" | "encounter" | "presence-bond") => {
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
      const currentActivity = lifeActivityFor(new Date());
      creatureRef.current.setActivity(currentActivity);
      setActivity(currentActivity);
      const preferredLanguage = navigator.languages?.find((language) => /^(zh|en)/i.test(language));
      setVoiceLanguage(preferredLanguage?.toLocaleLowerCase().startsWith("zh") ? "zh-CN" : "en-US");
      const rememberedVoice = window.localStorage.getItem(VOICE_STORAGE_KEY);
      if (rememberedVoice === "Andre" || rememberedVoice === "Neil" || rememberedVoice === "Maia") {
        setSelectedVoice(rememberedVoice);
      }
      conversationHistoryRef.current = loadConversationHistory();
      void refreshMicrophones();
      announce("Open the camera, then begin a conversation.", 3600);
    });

    return () => {
      active = false;
    };
  }, [announce, refreshMicrophones]);

  useEffect(() => {
    const updateActivity = () => {
      const next = lifeActivityFor(new Date());
      creatureRef.current.setActivity(next);
      setActivity(next);
    };
    const timer = window.setInterval(updateActivity, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const day = localDayKey(new Date());
    queueMicrotask(() => setDreamDay(day));
    const cacheKey = `lumen-dream-v1:${day}:${voiceLanguage}`;
    const cached = window.localStorage.getItem(cacheKey);
    if (cached) {
      queueMicrotask(() => setDreamText(cached));
      return;
    }

    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/lumen/dream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            language: voiceLanguage,
            personality: personalityRef.current,
            day,
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Dream generation unavailable");
        const result = await response.json() as BailianDreamResponse;
        if (!result.dream?.trim()) throw new Error("Dream contained no text");
        const dream = result.dream.trim();
        window.localStorage.setItem(cacheKey, dream);
        setDreamText(dream);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn("Lumen kept its dream below the surface", error);
        setDreamText(voiceLanguage === "zh-CN"
          ? "一颗发亮的种子追着自己的影子，游过一片没有尽头的水。"
          : "A bright seed chased its own shadow through water without an edge.");
      }
    })();
    return () => controller.abort();
  }, [voiceLanguage]);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => void refreshMicrophones();
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [refreshMicrophones]);

  useEffect(() => {
    if (!guideOpen) return;
    const closeGuide = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGuideOpen(false);
    };
    window.addEventListener("keydown", closeGuide);
    return () => window.removeEventListener("keydown", closeGuide);
  }, [guideOpen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let animationFrame = 0;
    let previousTime = performance.now();
    let previousMood: Mood = "idle";
    let previousHandPresence = false;
    let lastEncounterAt = -Infinity;

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
      handRef.current = cameraStateRef.current === "active" && video && tracker
        ? tracker.update(video, now)
        : EMPTY_HAND;
      if (handRef.current.present !== previousHandPresence) {
        previousHandPresence = handRef.current.present;
        setHandPresent(previousHandPresence);
        if (previousHandPresence && now - lastEncounterAt > 5000) {
          lastEncounterAt = now;
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
      );
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
        speechRef.current.style.left = `${creature.position.x}px`;
        speechRef.current.style.top = `${Math.max(86, creature.position.y - speechOffset)}px`;
      }
      if (activityRef.current) {
        activityRef.current.style.left = `${creature.position.x}px`;
        activityRef.current.style.top = `${creature.position.y + Math.min(width, height) * 0.18}px`;
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
      animationFrame = requestAnimationFrame(render);
    };

    animationFrame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
    };
  }, [remember]);

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
    stopAudioSource(audioSourceRef);
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    void audioContextRef.current?.close();
    trackerRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const handleVoiceTranscript = useCallback(async (transcript: string) => {
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript) return;

    updateVoiceState("processing");
    const fallback = createConversationReply(
      cleanTranscript,
      personalityRef.current,
      personalityRef.current.interactionCount,
    );
    setLastTranscript(cleanTranscript);
    announce("Lumen is thinking…", 2600, true);
    let response: ConversationReply = fallback;
    let source: ReplySource = "local";

    try {
      const apiResponse = await fetch("/api/lumen/converse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: cleanTranscript,
          language: voiceLanguage,
          personality: personalityRef.current,
          development: developmentRef.current,
          activity,
          history: conversationHistoryRef.current,
        }),
      });
      if (!apiResponse.ok) throw new Error("Bailian response unavailable");
      const result = await apiResponse.json() as BailianConversationResponse;
      if (!result.text?.trim()) throw new Error("Bailian returned no reply");
      response = {
        ...fallback,
        text: result.text.trim(),
        tone: isVoiceTone(result.tone) ? result.tone : fallback.tone,
      };
      source = "bailian";
    } catch (error) {
      console.warn("Lumen used its local voice memory", error);
    }

    conversationHistoryRef.current = [
      ...conversationHistoryRef.current,
      { role: "user", content: cleanTranscript },
      { role: "assistant", content: response.text },
    ].slice(-16);
    saveConversationHistory(conversationHistoryRef.current);
    setReplySource(source);
    creatureRef.current.hear(response.tone, performance.now());
    rememberVoice(response);
    speak(response.text, readingDuration(response.text), true);
    updateVoiceState("speaking");
    const spoken = await requestLumenVoice(
      audioRef,
      audioContextRef,
      audioSourceRef,
      response.text,
      voiceLanguage,
      conversationVoiceRef.current,
    );
    if (!spoken) announce("The cloud voice could not surface this turn.", 4200, true);
    if (conversationActiveRef.current) {
      window.setTimeout(() => {
        if (conversationActiveRef.current) updateVoiceState("listening");
      }, 420);
    } else {
      updateVoiceState("idle");
    }
  }, [activity, announce, rememberVoice, speak, updateVoiceState, voiceLanguage]);

  const transcribeRecording = useCallback(async (blob: Blob) => {
    if (blob.size < 400) {
      updateVoiceState(conversationActiveRef.current ? "listening" : "idle");
      return;
    }
    if (blob.size > MAX_RECORDING_BYTES) {
      updateVoiceState("error");
      announce("That sound was too long for Lumen to hold.", 4200, true);
      return;
    }

    updateVoiceState("transcribing");
    announce("Lumen is holding the shape of your voice…", 3400, true);
    try {
      const audio = await blobToDataUrl(blob);
      const response = await fetch("/api/lumen/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio, language: voiceLanguage }),
      });
      const result = await response.json() as BailianTranscriptionResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || `Bailian transcription failed (${response.status})`);
      if (!result.transcript?.trim()) throw new Error("Bailian returned no transcript");
      await handleVoiceTranscript(result.transcript);
    } catch (error) {
      console.warn("Lumen could not transcribe the recording", {
        error,
        mimeType: blob.type,
        bytes: blob.size,
      });
      updateVoiceState("error");
      announce(
        error instanceof Error && /no available balance/i.test(error.message)
          ? voiceLanguage === "zh-CN"
            ? "百炼账户目前没有可用额度，请检查阿里云的费用与成本。"
            : "Bailian has no available balance. Check the Alibaba Cloud billing account."
          : error instanceof Error && /No usable recording/i.test(error.message)
            ? "Lumen received the recording, but could not read its audio format."
            : "Lumen received your voice, but could not recognize it this time.",
        5200,
        true,
      );
      if (conversationActiveRef.current) {
        window.setTimeout(() => {
          if (conversationActiveRef.current) updateVoiceState("listening");
        }, 900);
      }
    }
  }, [announce, handleVoiceTranscript, updateVoiceState, voiceLanguage]);

  const stopConversation = useCallback((showStatus = true) => {
    conversationActiveRef.current = false;
    setConversationActive(false);
    if (vadFrameRef.current !== null) window.cancelAnimationFrame(vadFrameRef.current);
    vadFrameRef.current = null;
    if (recordingTimeoutRef.current !== null) window.clearTimeout(recordingTimeoutRef.current);
    recordingTimeoutRef.current = null;
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneStreamRef.current = null;
    vadSourceRef.current?.disconnect();
    vadSourceRef.current = null;
    vadAnalyserRef.current?.disconnect();
    vadAnalyserRef.current = null;
    stopAudioSource(audioSourceRef);
    updateVoiceState("idle");
    if (showStatus) announce("Conversation closed.", 2600, true);
  }, [announce, updateVoiceState]);

  const startConversation = useCallback(async () => {
    if (!("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) {
      updateVoiceState("unsupported");
      announce("This browser cannot open a path to your voice.", 5200, true);
      return;
    }

    try {
      // Lock one cloud timbre for the full conversation. The selector remains
      // disabled until the visit closes, so retries cannot drift to a new voice.
      conversationVoiceRef.current = selectedVoice;
      updateVoiceState("processing");
      const audioContext = audioContextRef.current ?? new AudioContext();
      audioContextRef.current = audioContext;
      if (audioContext.state !== "running") await audioContext.resume();
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
      microphoneStreamRef.current = stream;
      await refreshMicrophones();
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

      const beginTurn = (now: number) => {
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
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          void transcribeRecording(blob);
        };
        recorder.start(200);
        updateVoiceState("recording");
      };

      const monitorVoice = (now: number) => {
        if (!conversationActiveRef.current) return;
        const state = voiceStateRef.current;
        if (state === "listening" || state === "recording") {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) {
            const normalized = (sample - 128) / 128;
            sum += normalized * normalized;
          }
          const level = Math.sqrt(sum / samples.length);
          const recorder = recorderRef.current;
          if (recorder?.state === "recording") {
            if (level >= VOICE_END_LEVEL) lastVoiceAt = now;
            const longEnough = now - recordingStartedAt > VOICE_MIN_TURN_MS;
            const finished = longEnough && now - lastVoiceAt > VOICE_END_SILENCE_MS;
            if (finished || now - recordingStartedAt >= MAX_RECORDING_MS) recorder.stop();
          } else if (state === "listening") {
            speechFrames = level >= VOICE_START_LEVEL ? speechFrames + 1 : 0;
            if (speechFrames >= 3) {
              speechFrames = 0;
              beginTurn(now);
            }
          }
        }
        vadFrameRef.current = window.requestAnimationFrame(monitorVoice);
      };
      vadFrameRef.current = window.requestAnimationFrame(monitorVoice);

      if (!greetedRef.current) {
        greetedRef.current = true;
        const returning = personalityRef.current.familiarity >= 5;
        const greeting = voiceLanguage === "zh-CN"
          ? returning ? "嘿，你回来了。" : "这是我第一次见到你。你好。"
          : returning ? "Hey, you're back." : "This is the first time I have seen you. Hello.";
        speak(greeting, readingDuration(greeting), true);
        creatureRef.current.hear("warm", performance.now());
        updateVoiceState("speaking");
        const spoken = await requestLumenVoice(
          audioRef,
          audioContextRef,
          audioSourceRef,
          greeting,
          voiceLanguage,
          conversationVoiceRef.current,
        );
        if (!spoken) announce("The cloud voice could not surface this turn.", 4200, true);
      }
      if (conversationActiveRef.current) updateVoiceState("listening");
      announce("Conversation open · speak naturally.", 3400, true);
    } catch (error) {
      console.warn("Lumen could not start recording", error);
      stopConversation(false);
      updateVoiceState("error");
      announce("Choose a microphone and allow Lumen to hear it.", 4400, true);
    }
  }, [announce, refreshMicrophones, selectedMicrophoneId, selectedVoice, speak, stopConversation, transcribeRecording, updateVoiceState, voiceLanguage]);

  const toggleConversation = useCallback(() => {
    if (conversationActiveRef.current) stopConversation();
    else void startConversation();
  }, [startConversation, stopConversation]);

  const startCamera = async () => {
    if (cameraStateRef.current === "loading") return;
    updateCameraState("loading");
    announce("Opening camera…", 2400, true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 960 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) throw new Error("Video element unavailable");
      video.srcObject = stream;
      await video.play();

      const tracker = new HandTracker();
      await tracker.initialize();
      trackerRef.current = tracker;
      updateCameraState("active");
      await refreshMicrophones(true);
      announce("Choose a microphone, then begin conversation.", 3600);
    } catch (error) {
      console.error("Lumen could not start hand tracking", error);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      updateCameraState("error");
      announce("Lumen could not see you. Camera access may be blocked.", 4800, true);
    }
  };

  const stopCamera = () => {
    stopConversation(false);
    audioRef.current?.pause();
    audioRef.current = null;
    stopAudioSource(audioSourceRef);
    window.speechSynthesis?.cancel();
    trackerRef.current?.close();
    trackerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    handRef.current = EMPTY_HAND;
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
            <span>{handPresent ? "hand acquired" : "seeking hand"}</span>
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

      <section className="invitation" aria-label="Hand interaction controls">
        <p className="message" key={message}>{message}</p>
        <p className={`conversation-transcript ${lastTranscript ? "is-visible" : ""}`} aria-live="polite">
          <span>you</span>{lastTranscript}
        </p>
        {cameraState !== "active" ? (
          <button className="meet-button" onClick={startCamera} disabled={cameraState === "loading"}>
            <span>{cameraState === "loading" ? "Waking Lumen" : cameraState === "error" ? "Try again" : "Let Lumen see you"}</span>
            <span className="button-arrow" aria-hidden="true">↗</span>
          </button>
        ) : (
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
                <span className="voice-orb" aria-hidden="true" />
                <span>{conversationActive ? "end conversation" : "begin conversation"}</span>
              </button>
              <span className="voice-status" aria-live="polite">
                {replySource === "local" && voiceState === "speaking"
                  ? "local response"
                  : VOICE_STATE_COPY[voiceState]}
              </span>
              <button
                className="voice-language"
                type="button"
                onClick={() => setVoiceLanguage((language) => language === "en-US" ? "zh-CN" : "en-US")}
                disabled={conversationActive || voiceState === "processing" || voiceState === "speaking"}
                aria-label={`Voice language: ${voiceLanguage === "zh-CN" ? "Chinese" : "English"}. Click to change.`}
              >
                {voiceLanguage === "zh-CN" ? "中文" : "EN"}
              </button>
              <select
                className="microphone-select"
                value={selectedMicrophoneId}
                onChange={(event) => {
                  const deviceId = event.target.value;
                  setSelectedMicrophoneId(deviceId);
                  window.localStorage.setItem(MICROPHONE_STORAGE_KEY, deviceId);
                }}
                disabled={conversationActive || (voiceState !== "idle" && voiceState !== "error")}
                aria-label="Microphone used to speak to Lumen"
                title="Microphone used to speak to Lumen"
              >
                {audioInputs.length === 0 ? <option value="">system microphone</option> : null}
                {audioInputs.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                ))}
              </select>
              <select
                className="lumen-voice-select"
                value={selectedVoice}
                onChange={(event) => {
                  const voice = event.target.value as LumenVoice;
                  setSelectedVoice(voice);
                  window.localStorage.setItem(VOICE_STORAGE_KEY, voice);
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
            <button className="quiet-button" onClick={stopCamera} aria-label="Turn off camera">
              end visit
            </button>
          </div>
        )}
      </section>

      <aside className="memory" title="Lumen’s memory of you">
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
          <p>{dreamText || "The dream has not surfaced yet."}</p>
        </div>
      </aside>

      <p className="privacy">Camera stays on this device · short voice clips go to Bailian</p>

      {guideOpen ? (
        <div className="guide-backdrop" role="presentation">
          <section className="guide-card" role="dialog" aria-modal="true" aria-labelledby="guide-title">
            <p className="guide-kicker">a life forming in digital water</p>
            <h1 id="guide-title">Meet Lumen</h1>
            <p className="guide-intro">
              Lumen is a fluid artificial organism rather than a cartoon animal. Its membrane and inner light remember how you spend time together.
            </p>
            <div className="guide-grid">
              <article>
                <span>01 · talk</span>
                <p>Open the camera, choose a microphone, and begin conversation once. Speak naturally; pauses become turns.</p>
              </article>
              <article>
                <span>02 · reach</span>
                <p>Move one hand slowly. Its membrane notices your approach. Gentle contact creates a local wave; sudden movement makes it contract.</p>
              </article>
              <article>
                <span>03 · return</span>
                <p>Conversation, calm contact, and visits on different days slowly grow Lumen. Different relationships produce different bodies.</p>
              </article>
            </div>
            <p className="guide-note">Its latest dream remains in the dream journal, even after it wakes.</p>
            <button className="guide-enter" type="button" onClick={() => setGuideOpen(false)}>enter Lumen’s world</button>
          </section>
        </div>
      ) : null}
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
    const stored = JSON.parse(window.localStorage.getItem(CONVERSATION_STORAGE_KEY) ?? "[]");
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
  window.localStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(history.slice(-16)));
}

function readingDuration(text: string) {
  return Math.max(5000, Math.min(8200, 4100 + text.length * 75));
}

function isVoiceTone(value: unknown): value is VoiceTone {
  return value === "warm" || value === "curious" || value === "uneasy" || value === "neutral";
}

async function requestLumenVoice(
  audioRef: React.MutableRefObject<HTMLAudioElement | null>,
  audioContextRef: React.MutableRefObject<AudioContext | null>,
  audioSourceRef: React.MutableRefObject<AudioBufferSourceNode | null>,
  text: string,
  language: VoiceLanguage,
  voice: LumenVoice,
) {
  audioRef.current?.pause();
  window.speechSynthesis?.cancel();
  const audioContext = audioContextRef.current;
  if (!audioContext) return false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let beganPlaying = false;
    try {
      const response = await fetch("/api/lumen/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language, voice }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error("Bailian speech unavailable");
      await playBailianSpeechStream(response, audioContext, audioSourceRef, () => {
        beganPlaying = true;
      });
      return true;
    } catch (error) {
      console.warn(`Lumen cloud speech attempt ${attempt + 1} failed`, error);
      // Never replay the beginning of a sentence after a partial stream.
      if (beganPlaying) return false;
    }
  }
  return false;
}

async function playBailianSpeechStream(
  response: Response,
  audioContext: AudioContext,
  audioSourceRef: React.MutableRefObject<AudioBufferSourceNode | null>,
  onPlaybackStart: () => void,
) {
  if (!response.body) throw new Error("Bailian returned no speech stream");
  if (audioContext.state !== "running") await audioContext.resume();
  stopAudioSource(audioSourceRef);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let nextStartAt = audioContext.currentTime + 0.045;
  let chunksPlayed = 0;
  let lastPlayback: Promise<void> = Promise.resolve();

  const consumeEvent = (event: string) => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("");
    if (!data || data === "[DONE]") return;
    const payload = JSON.parse(data) as {
      code?: string;
      message?: string;
      output?: { audio?: { data?: string } };
    };
    if (payload.code) throw new Error(payload.message || payload.code);
    const encoded = payload.output?.audio?.data;
    if (!encoded) return;

    const pcm = decodePcm16(encoded);
    if (!pcm.length) return;
    const buffer = audioContext.createBuffer(1, pcm.length, 24_000);
    buffer.copyToChannel(pcm, 0);
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(audioContext.destination);
    const startAt = Math.max(nextStartAt, audioContext.currentTime + 0.025);
    nextStartAt = startAt + buffer.duration;
    const isFirstChunk = chunksPlayed === 0;
    if (isFirstChunk) {
      // Streaming PCM can begin on a non-zero waveform sample. Jumping from
      // digital silence directly to that value creates the audible click.
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(0.78, startAt + Math.min(0.018, buffer.duration * 0.35));
    } else {
      gain.gain.setValueAtTime(0.78, startAt);
    }
    audioSourceRef.current = source;
    chunksPlayed += 1;
    if (chunksPlayed === 1) onPlaybackStart();
    lastPlayback = new Promise<void>((resolve) => {
      source.onended = () => {
        if (audioSourceRef.current === source) audioSourceRef.current = null;
        resolve();
      };
    });
    source.start(startAt);
  };

  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const events = pending.split(/\r?\n\r?\n/);
    pending = events.pop() ?? "";
    for (const event of events) consumeEvent(event);
    if (done) break;
  }
  if (pending.trim()) consumeEvent(pending);
  if (!chunksPlayed) throw new Error("Bailian returned no playable speech chunks");
  await lastPlayback;
}

function decodePcm16(encoded: string) {
  const binary = window.atob(encoded);
  let byteOffset = 0;
  // Bailian documents streamed chunks as raw PCM. If a compatible endpoint
  // ever prefixes the first chunk with a WAV container, skip its header rather
  // than interpreting the ASCII RIFF bytes as a burst of audio.
  if (binary.slice(0, 4) === "RIFF") {
    const dataMarker = binary.indexOf("data", 12);
    if (dataMarker >= 0) byteOffset = dataMarker + 8;
  }
  const sampleCount = Math.floor((binary.length - byteOffset) / 2);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const low = binary.charCodeAt(byteOffset + index * 2);
    const high = binary.charCodeAt(byteOffset + index * 2 + 1);
    const signed = (high << 8 | low) << 16 >> 16;
    samples[index] = signed / 32768;
  }
  return samples;
}

function stopAudioSource(audioSourceRef: React.MutableRefObject<AudioBufferSourceNode | null>) {
  try {
    audioSourceRef.current?.stop();
  } catch {
    // A source that has already ended cannot be stopped twice.
  }
  audioSourceRef.current = null;
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

type MessageEntry = { text: string; duration: number };

function useMessageQueue(initialMessage: string) {
  const [message, setMessage] = useState(initialMessage);
  const engineRef = useRef<{
    current: string;
    queue: MessageEntry[];
    timer: number | null;
    initialHold: boolean;
  }>({
    current: initialMessage,
    queue: [],
    timer: null,
    initialHold: true,
  });

  const announce = useCallback((text: string, duration = 3200, priority = false) => {
    const engine = engineRef.current;
    if (engine.current === text || engine.queue.some((entry) => entry.text === text)) return;

    const entry = { text, duration };
    if (priority) engine.queue.unshift(entry);
    else if (engine.queue.length < 5) engine.queue.push(entry);
    if (engine.queue.length > 5) engine.queue.length = 5;

    const playNext = () => {
      const next = engine.queue.shift();
      if (!next) {
        engine.current = "";
        engine.timer = null;
        return;
      }
      engine.current = next.text;
      setMessage(next.text);
      engine.timer = window.setTimeout(() => {
        engine.timer = null;
        playNext();
      }, next.duration);
    };

    if (engine.initialHold) {
      engine.initialHold = false;
      engine.timer = window.setTimeout(() => {
        engine.timer = null;
        playNext();
      }, 2600);
    } else if (engine.timer === null) {
      playNext();
    }
  }, []);

  useEffect(() => () => {
    if (engineRef.current.timer !== null) window.clearTimeout(engineRef.current.timer);
  }, []);

  return [message, announce] as const;
}

function useLumenSpeech() {
  const [speech, setSpeech] = useState<string | null>(null);
  const engineRef = useRef<{
    current: string | null;
    queue: MessageEntry[];
    recent: string[];
    timer: number | null;
  }>({ current: null, queue: [], recent: [], timer: null });

  const speak = useCallback((text: string, duration = 4600, priority = false) => {
    const engine = engineRef.current;
    if (
      engine.current === text ||
      engine.queue.some((entry) => entry.text === text) ||
      engine.recent.includes(text)
    ) return;

    const entry = { text, duration };
    if (priority) engine.queue.unshift(entry);
    else engine.queue.push(entry);
    if (engine.queue.length > 3) engine.queue.length = 3;

    const playNext = () => {
      const next = engine.queue.shift();
      if (!next) {
        engine.current = null;
        engine.timer = null;
        return;
      }

      engine.current = next.text;
      engine.recent.push(next.text);
      if (engine.recent.length > 6) engine.recent.shift();
      setSpeech(next.text);
      engine.timer = window.setTimeout(() => {
        setSpeech(null);
        engine.current = null;
        engine.timer = window.setTimeout(() => {
          engine.timer = null;
          playNext();
        }, 900);
      }, next.duration);
    };

    if (engine.timer === null && engine.current === null) playNext();
  }, []);

  useEffect(() => () => {
    if (engineRef.current.timer !== null) window.clearTimeout(engineRef.current.timer);
  }, []);

  return [speech, speak] as const;
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
