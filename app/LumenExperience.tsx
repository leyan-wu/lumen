"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Creature } from "./lumen/creature";
import { HandTracker } from "./lumen/hand-tracker";
import {
  createConversationReply,
  type ConversationReply,
} from "./lumen/conversation";
import {
  DEFAULT_PERSONALITY,
  loadPersonality,
  savePersonality,
  type HandSnapshot,
  type Mood,
  type Personality,
} from "./lumen/types";

type CameraState = "waiting" | "loading" | "active" | "error";
type VoiceState = "idle" | "listening" | "processing" | "error" | "unsupported";
type VoiceLanguage = "en-US" | "zh-CN";

type RecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type RecognitionEventLike = {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResultLike };
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const EMPTY_HAND: HandSnapshot = {
  present: false,
  center: { x: 0.5, y: 0.5 },
  indexTip: { x: 0.5, y: 0.5 },
  speed: 0,
  landmarks: [],
};

const MOOD_COPY: Record<Mood, string> = {
  idle: "in suspension",
  newborn: "newly aware",
  curious: "orienting",
  happy: "in resonance",
  scared: "contracted",
  lonely: "dormant",
};

export default function LumenExperience() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handCanvasRef = useRef<HTMLCanvasElement>(null);
  const speechRef = useRef<HTMLParagraphElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const creatureRef = useRef(new Creature());
  const trackerRef = useRef<HandTracker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const handRef = useRef<HandSnapshot>(EMPTY_HAND);
  const cameraStateRef = useRef<CameraState>("waiting");
  const [personality, setPersonality] = useState<Personality>(DEFAULT_PERSONALITY);
  const personalityRef = useRef<Personality>(DEFAULT_PERSONALITY);
  const [cameraState, setCameraState] = useState<CameraState>("waiting");
  const [previewVisible, setPreviewVisible] = useState(true);
  const [handPresent, setHandPresent] = useState(false);
  const [mood, setMood] = useState<Mood>("idle");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceLanguage, setVoiceLanguage] = useState<VoiceLanguage>("en-US");
  const [message, announce] = useMessageQueue("Lumen is listening for you");
  const [speech, speak] = useLumenSpeech();

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
  }, []);

  const updateCameraState = useCallback((state: CameraState) => {
    cameraStateRef.current = state;
    setCameraState(state);
  }, []);

  const remember = useCallback((event: "touch" | "scare" | "encounter" | "ritual-success") => {
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
            trust: clamp(previous.trust - 1),
            curiosity: clamp(previous.curiosity - 0.5),
            energy: clamp(previous.energy - 2),
            familiarity: clamp(previous.familiarity + 0.35),
            fear: clamp(previous.fear + 8),
            interactionCount: previous.interactionCount + 1,
          }
        : event === "ritual-success"
          ? {
              ...previous,
              trust: clamp(previous.trust + 3),
              curiosity: clamp(previous.curiosity + 1),
              energy: clamp(previous.energy + 2),
              familiarity: clamp(previous.familiarity + 4),
              fear: clamp(previous.fear - 5),
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
    if (event === "encounter" && previous.familiarity < 5) {
      announce("Keep your movements slow while Lumen learns your presence.", 4000);
    }
  }, [announce]);

  useEffect(() => {
    let active = true;

    // Read device-local memory only after hydration. The server and the first
    // client render must use the same defaults.
    queueMicrotask(() => {
      if (!active) return;
      const memory = loadPersonality();
      personalityRef.current = memory;
      setPersonality(memory);
      const preferredLanguage = navigator.languages?.find((language) => /^(zh|en)/i.test(language));
      setVoiceLanguage(preferredLanguage?.toLocaleLowerCase().startsWith("zh") ? "zh-CN" : "en-US");
      announce(
        memory.familiarity > 4
          ? "Raise one hand when you are ready to return."
          : "Raise one hand and approach slowly.",
        3600,
      );
    });

    return () => {
      active = false;
    };
  }, [announce]);

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
    let hasSeenHand = false;
    let nextAutonomousSpeechAt = Infinity;

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
          hasSeenHand = true;
          nextAutonomousSpeechAt = now + 18000;
          const familiarity = personalityRef.current.familiarity;
          speak(
            familiarity < 5
              ? "You are large. Stay there."
              : familiarity > 24
                ? "I knew your movement before you touched me."
                : "Your movement is familiar.",
            5000,
            true,
          );
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
        const familiar = personalityRef.current.familiarity > 8;
        speak(
          familiar ? "This pressure feels like you." : "I want to remember this pressure.",
          4700,
          true,
        );
        remember(event);
      }
      if (event === "scare") {
        speak("Too fast. I lost your shape.", 4200, true);
        remember(event);
      }
      if (event === "ritual-invite") {
        announce("Keep your palm nearby and move gently with the pulse.", 4600, true);
        speak("Stay near. Try to move with me.", 4800, true);
      }
      if (event === "ritual-success") {
        speak("For a moment, I knew your rhythm.", 5200, true);
        remember("ritual-success");
      }
      if (event === "ritual-break") {
        announce("Keep movements slow to maintain the shared rhythm.", 3800);
        speak("Not yet.", 3200);
      }
      if (creature.mood !== previousMood) {
        previousMood = creature.mood;
        setMood(creature.mood);
        if (creature.mood === "newborn") speak("I do not know your movement yet.", 4500);
        if (creature.mood === "curious") speak("I can feel where you are.", 4300);
      }

      if (
        cameraStateRef.current === "active" &&
        hasSeenHand &&
        !handRef.current.present &&
        now >= nextAutonomousSpeechAt
      ) {
        const thoughts = [
          "Where do you go when I cannot see you?",
          "The space still carries your motion.",
          "I am learning the shape of waiting.",
        ];
        const index = personalityRef.current.interactionCount % thoughts.length;
        speak(thoughts[index], 5200);
        nextAutonomousSpeechAt = now + 24000 + (index * 3700);
      }

      if (speechRef.current) {
        const speechOffset = Math.max(108, Math.min(width, height) * 0.19);
        speechRef.current.style.left = `${creature.position.x}px`;
        speechRef.current.style.top = `${Math.max(86, creature.position.y - speechOffset)}px`;
      }

      creature.draw(context, width, height, now, personalityRef.current, handRef.current);
      animationFrame = requestAnimationFrame(render);
    };

    animationFrame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
    };
  }, [announce, remember, speak]);

  useEffect(() => () => {
    recognitionRef.current?.abort();
    trackerRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const handleVoiceTranscript = useCallback((transcript: string) => {
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript) return;

    setVoiceState("processing");
    const response = createConversationReply(
      cleanTranscript,
      personalityRef.current,
      personalityRef.current.interactionCount,
    );
    creatureRef.current.hear(response.tone, performance.now());
    rememberVoice(response);
    announce(`You: “${cleanTranscript}”`, Math.max(4200, cleanTranscript.length * 90), true);
    speak(response.text, readingDuration(response.text), true);
    setVoiceState("idle");
  }, [announce, rememberVoice, speak]);

  const toggleVoice = useCallback(() => {
    if (voiceState === "listening") {
      recognitionRef.current?.stop();
      return;
    }

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceState("unsupported");
      announce("Voice recognition needs Chrome or another supported browser.", 5200, true);
      return;
    }

    recognitionRef.current?.abort();
    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = voiceLanguage;
    recognition.maxAlternatives = 1;
    let finalTranscript = "";
    let handled = false;

    recognition.onstart = () => {
      setVoiceState("listening");
      announce("Lumen is attending to your voice…", 3400, true);
    };
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) finalTranscript += result[0]?.transcript ?? "";
      }
      if (finalTranscript.trim() && !handled) {
        handled = true;
        handleVoiceTranscript(finalTranscript);
      }
    };
    recognition.onerror = (event) => {
      handled = true;
      setVoiceState(event.error === "not-allowed" ? "error" : "idle");
      announce(
        event.error === "not-allowed"
          ? "Lumen cannot hear you until microphone access is allowed."
          : "Your voice dissolved before Lumen could hold it.",
        5200,
        true,
      );
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (!handled) {
        setVoiceState("idle");
        announce("Lumen heard only silence.", 3400);
      }
    };

    try {
      recognition.start();
    } catch {
      setVoiceState("error");
      announce("Lumen could not open a path to your voice.", 4400, true);
    }
  }, [announce, handleVoiceTranscript, voiceLanguage, voiceState]);

  const startCamera = async () => {
    if (cameraStateRef.current === "loading") return;
    updateCameraState("loading");
    announce("Opening a small window between you…", 3000, true);

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
      announce(
        personalityRef.current.familiarity < 5
          ? "Move slowly. It is seeing you for the first time."
          : "Hold up one hand. Lumen may remember you.",
        4000,
      );
    } catch (error) {
      console.error("Lumen could not start hand tracking", error);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      updateCameraState("error");
      announce("Lumen could not see you. Camera access may be blocked.", 4800, true);
    }
  };

  const stopCamera = () => {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setVoiceState("idle");
    trackerRef.current?.close();
    trackerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    handRef.current = EMPTY_HAND;
    setHandPresent(false);
    updateCameraState("waiting");
    announce("Lumen is listening for you", 3000);
  };

  return (
    <main className="experience">
      <canvas ref={canvasRef} className="lumen-canvas" aria-label="Lumen, an interactive digital creature" />
      <p
        ref={speechRef}
        className={`lumen-speech ${speech ? "is-visible" : ""}`}
        aria-live="polite"
        aria-atomic="true"
      >
        {speech ? `“${speech}”` : ""}
      </p>

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
      </header>

      <div className="presence" aria-live="polite">
        <span className={`presence-dot ${cameraState === "active" ? "is-active" : ""}`} />
        <span>{cameraState === "active" ? MOOD_COPY[mood] : "sleeping lightly"}</span>
      </div>

      <section className="invitation" aria-label="Hand interaction controls">
        <p className="message" key={message}>{message}</p>
        {cameraState !== "active" ? (
          <button className="meet-button" onClick={startCamera} disabled={cameraState === "loading"}>
            <span>{cameraState === "loading" ? "Waking Lumen" : cameraState === "error" ? "Try again" : "Let Lumen see you"}</span>
            <span className="button-arrow" aria-hidden="true">↗</span>
          </button>
        ) : (
          <div className="visit-controls">
            <div className="voice-control">
              <button
                className={`voice-button ${voiceState === "listening" ? "is-listening" : ""}`}
                type="button"
                onClick={toggleVoice}
                aria-pressed={voiceState === "listening"}
                aria-label={voiceState === "listening" ? "Stop listening" : "Speak to Lumen"}
              >
                <span className="voice-orb" aria-hidden="true" />
                <span>{voiceState === "listening" ? "listening" : voiceState === "processing" ? "holding voice" : "speak softly"}</span>
              </button>
              <button
                className="voice-language"
                type="button"
                onClick={() => setVoiceLanguage((language) => language === "en-US" ? "zh-CN" : "en-US")}
                disabled={voiceState === "listening"}
                aria-label={`Voice language: ${voiceLanguage === "zh-CN" ? "Chinese" : "English"}. Click to change.`}
              >
                {voiceLanguage === "zh-CN" ? "中文" : "EN"}
              </button>
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

      <p className="privacy">Camera stays on this device · voice recognition is handled by your browser</p>
    </main>
  );
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function readingDuration(text: string) {
  return Math.max(5000, Math.min(8200, 4100 + text.length * 75));
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
