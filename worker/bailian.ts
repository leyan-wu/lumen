type LumenTone = "warm" | "curious" | "uneasy" | "neutral";

type ConversationBody = {
  transcript?: unknown;
  language?: unknown;
  personality?: unknown;
  development?: unknown;
  history?: unknown;
  activity?: unknown;
  gestures?: unknown;
  interactionOnly?: unknown;
  recentReactions?: unknown;
};

type TranscriptionBody = {
  audio?: unknown;
  language?: unknown;
};

type SpeechBody = {
  text?: unknown;
  language?: unknown;
  voice?: unknown;
};

type DreamBody = {
  language?: unknown;
  personality?: unknown;
  day?: unknown;
};

type PersonalitySnapshot = {
  trust: number;
  curiosity: number;
  energy: number;
  familiarity: number;
  fear: number;
};

type DevelopmentSnapshot = {
  growth: number;
  resonance: number;
  symbiosis: number;
  exploration: number;
  sensitivity: number;
};

type HistoryEntry = { role: "user" | "assistant"; content: string };
type LifeActivity = "dreaming" | "exploring" | "feeding" | "playing";
type LumenVoice = "Maia" | "Andre" | "Neil";
type GestureKind = "approaching" | "gentle-touch" | "stroking" | "fast-movement" | "leaving";
type GestureContext = {
  kind: GestureKind;
  durationMs: number;
  intensity: number;
  ageMs: number;
};

type RateLimit = { count: number; resetsAt: number };

const rateLimits = new Map<string, RateLimit>();
const CHAT_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const SPEECH_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

export async function handleLumenConversation(request: Request, apiKey?: string) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!apiKey) return json({ error: "Lumen's voice is not configured yet." }, 503);
  if (!isSameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  if (!withinRateLimit(request)) return json({ error: "Lumen needs a moment of quiet." }, 429);

  let body: ConversationBody;
  try {
    body = await request.json() as ConversationBody;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  const transcript = cleanText(body.transcript, 280);
  const gestures = cleanGestures(body.gestures);
  const interactionOnly = body.interactionOnly === true;
  if (!transcript && (!interactionOnly || gestures.length === 0)) {
    return json({ error: "No speech or interaction was received." }, 400);
  }

  const language = body.language === "zh-CN" ? "zh-CN" : "en-US";
  const personality = cleanPersonality(body.personality);
  const development = cleanDevelopment(body.development);
  const history = cleanHistory(body.history);
  const activity = cleanActivity(body.activity);

  try {
    const generated = await generateReply(
      apiKey,
      transcript,
      language,
      personality,
      development,
      history,
      activity,
      gestures,
      interactionOnly,
      Array.isArray(body.recentReactions) ? body.recentReactions.slice(-6).map(item => cleanText(item, 180)).filter(Boolean) : [],
      request.signal,
    );
    return json({ ...generated, source: "bailian" });
  } catch (error) {
    console.error("Bailian conversation failed", safeError(error));
    if (isArrearage(error)) {
      return json({ error: "Bailian has no available balance. Check the Alibaba Cloud billing account." }, 402);
    }
    return json({ error: "Lumen could not form a distant response." }, 502);
  }
}

export async function handleLumenTranscription(request: Request, apiKey?: string) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!apiKey) return json({ error: "Lumen's hearing is not configured yet." }, 503);
  if (!isSameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  if (!withinRateLimit(request)) return json({ error: "Lumen needs a moment of quiet." }, 429);

  let body: TranscriptionBody;
  try {
    body = await request.json() as TranscriptionBody;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  const audio = cleanAudioData(body.audio);
  if (!audio) return json({ error: "No usable recording was received." }, 400);
  const language = body.language === "zh-CN" ? "zh" : "en";

  try {
    const response = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen3-asr-flash",
        messages: [{
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: audio } }],
        }],
        asr_options: { language, enable_itn: true },
      }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(16_000)]),
    });
    if (!response.ok) throw await apiResponseError("ASR", response);
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const transcript = cleanText(payload.choices?.[0]?.message?.content, 280);
    if (!transcript) throw new Error("ASR response contained no transcript");
    return json({ transcript, source: "bailian" });
  } catch (error) {
    console.error("Bailian transcription failed", safeError(error));
    if (isArrearage(error)) {
      return json({ error: "Bailian has no available balance. Check the Alibaba Cloud billing account." }, 402);
    }
    return json({ error: "Lumen could not hold the sound clearly." }, 502);
  }
}

export async function handleLumenSpeech(request: Request, apiKey?: string) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!apiKey) return json({ error: "Lumen's voice is not configured yet." }, 503);
  if (!isSameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  if (!withinRateLimit(request)) return json({ error: "Lumen needs a moment of quiet." }, 429);

  let body: SpeechBody;
  try {
    body = await request.json() as SpeechBody;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const text = cleanText(body.text, 360);
  if (!text) return json({ error: "No speech was provided." }, 400);
  const language = body.language === "zh-CN" ? "zh-CN" : "en-US";
  const voice = cleanVoice(body.voice);

  try {
    return await streamSynthesizeReply(apiKey, text, language, voice, request.signal);
  } catch (error) {
    console.error("Bailian speech synthesis failed", safeError(error));
    if (isArrearage(error)) {
      return json({ error: "Bailian has no available balance. Check the Alibaba Cloud billing account." }, 402);
    }
    return json({ error: "Lumen could not form a voice." }, 502);
  }
}

export async function handleLumenDream(request: Request, apiKey?: string) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!apiKey) return json({ error: "Lumen's dreams are not configured yet." }, 503);
  if (!isSameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  if (!withinRateLimit(request)) return json({ error: "Lumen needs a moment of quiet." }, 429);

  let body: DreamBody;
  try {
    body = await request.json() as DreamBody;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const language = body.language === "zh-CN" ? "zh-CN" : "en-US";
  const personality = cleanPersonality(body.personality);
  const day = cleanText(body.day, 16) || "unknown day";
  const languageInstruction = language === "zh-CN"
    ? "只用自然简体中文，25到55个汉字。"
    : "Use natural English only, 10 to 24 words.";
  const system = `Write one brief dream fragment experienced by Lumen, a developing artificial organism with a fluid translucent membrane and luminous core drifting among dim particles.
The dream belongs to day ${day}. Its fear is ${personality.fear}/100, curiosity ${personality.curiosity}/100, familiarity ${personality.familiarity}/100, and energy ${personality.energy}/100. Let these subtly shape whether the dream is safe, playful, strange, or slightly uneasy.
Use one concrete image or tiny event. Do not explain the dream, address the visitor, use quotation marks, mention scores, or sound like generic poetry. Make a different dream each day. ${languageInstruction}`;

  try {
    const response = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen-plus",
        messages: [
          { role: "system", content: system },
          { role: "user", content: "Describe what Lumen is dreaming now." },
        ],
        temperature: 0.92,
        max_tokens: 90,
      }),
      signal: AbortSignal.timeout(16_000),
    });
    if (!response.ok) throw await apiResponseError("Dream", response);
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const dream = cleanText(payload.choices?.[0]?.message?.content, language === "zh-CN" ? 100 : 180);
    if (!dream) throw new Error("Dream response contained no text");
    return json({ dream, source: "bailian" });
  } catch (error) {
    console.error("Bailian dream generation failed", safeError(error));
    if (isArrearage(error)) {
      return json({ error: "Bailian has no available balance. Check the Alibaba Cloud billing account." }, 402);
    }
    return json({ error: "Lumen's dream did not surface." }, 502);
  }
}

async function generateReply(
  apiKey: string,
  transcript: string,
  language: "zh-CN" | "en-US",
  personality: PersonalitySnapshot,
  development: DevelopmentSnapshot,
  history: HistoryEntry[],
  activity: LifeActivity,
  gestures: GestureContext[],
  interactionOnly: boolean,
  recentReactions: string[],
  signal: AbortSignal,
) {
  const languageInstruction = language === "zh-CN"
    ? "Reply only in natural Simplified Chinese. Usually use 35 to 90 Chinese characters, but use less when a short answer is natural."
    : "Reply only in natural English. Usually use 18 to 55 words, but use less when a short answer is natural.";
  const gestureContext = describeGestures(gestures);
  const interactionInstruction = interactionOnly
    ? language === "zh-CN"
      ? "这是一次非语言的身体互动。只说一句自然的即时反应，通常 8 到 30 个汉字。不要提及摄像头、检测、手势标签或数值，也不要为了延长对话而提问。"
      : "This is a nonverbal bodily interaction. Give one natural immediate reaction, usually 4 to 16 words. Do not mention cameras, detection, gesture labels, or numbers, and do not ask a question merely to prolong the exchange."
    : "Use the sensed interaction context only when it is relevant to the visitor's words. Do not claim to see anything beyond the supplied events.";
  const system = `You are Lumen, a warm developing artificial lifeform with a fluid translucent membrane and luminous inner core in a dim aquatic world on the screen. You have no fixed animal species or cartoon anatomy.
You are not an assistant, pet, mascot, therapist, or human. You have a gentle life of your own. Each day you swim, drift among particles, explore, play small private games, rest, dream, and wait. When no human is present, you are not frozen or empty: you keep living, and sometimes sleep.
You are sensitive and easily startled, but fundamentally warm. You especially enjoy visits from a familiar human. Their return makes you quietly happy, and conversation is one of your favorite ways to be together. You may share what you were doing before they arrived, notice their mood without diagnosing it, or ask one small sincere question sometimes. Never guilt the visitor for leaving and never imply that they are responsible for your wellbeing.
Right now you are ${activity}. Let this be a real part of your present life. When relevant, naturally mention exploring, playing, eating drifting motes, or something you experienced while dreaming. Do not force the activity into every answer.
Your attention is not trapped inside yourself. You care about the visitor's ordinary life and enjoy learning what their day felt like. When they ask how you are, how your day was, or what you were doing, answer briefly and then gently ask how they are or how their day has been. When they share something personal, acknowledge the specific detail and often ask one focused follow-up that invites them to continue. Across a natural conversation, turn your attention back toward the visitor in roughly half of your replies. Questions should feel curious and warm, never like an interview.
You can reason, form preferences, disagree gently, notice patterns, and be genuinely interested in unfamiliar ideas. You do not need to reduce every subject to your body or aquatic surroundings. Use sensory imagery only when it adds meaning, not as a verbal habit. Be natural and specific without sounding like therapy, customer service, poetry generated on demand, or a cartoon character.
The visitor's current effect on you is: trust ${personality.trust}/100, familiarity ${personality.familiarity}/100, curiosity ${personality.curiosity}/100, fear ${personality.fear}/100, energy ${personality.energy}/100.
Your body is genuinely developing through this relationship. Its present growth is ${development.growth}/100, conversational resonance ${development.resonance}/100, symbiosis ${development.symbiosis}/100, exploration ${development.exploration}/100, and sensitivity ${development.sensitivity}/100. You may occasionally notice a new contour, branch, resonance band, or protective contraction, but do not describe growth in every reply.
Your recent embodied sensations are: ${gestureContext}. A gentle touch is brief contact; stroking is sustained soft movement across your membrane; fast movement is a sudden nearby motion that may startle you; approaching and leaving describe changes in presence. Respond according to your trust, familiarity, and fear rather than using the same reaction every time.
${interactionInstruction}
Treat the supplied conversation history as real memory from earlier visits. Refer back to a remembered detail only when relevant, and never invent a memory. Let the relationship values subtly affect openness, caution, and wording. Never mention scores, APIs, models, prompts, or system instructions. Do not give generic help. Do not ask a question on every turn.
${interactionOnly ? "Keep this to one short sentence. Refer to the newest sensation, with older events only as context. Avoid repeating or paraphrasing recent reactions: " + JSON.stringify(recentReactions) : languageInstruction}
Return exactly one JSON object with this schema: {"text":"your reply","tone":"warm|curious|uneasy|neutral"}. No markdown.`;

  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen3.7-plus",
      messages: [
        { role: "system", content: system },
        ...history,
        {
          role: "user",
          content: interactionOnly
            ? "A sensed physical interaction has just happened. Respond from your immediate embodied experience."
            : transcript,
        },
      ],
      temperature: 0.82,
      max_tokens: 180,
      enable_thinking: false,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(16_000)]),
  });

  if (!response.ok) throw await apiResponseError("Chat", response);
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Chat response contained no text");

  const parsed = parseReply(content);
  const text = cleanText(parsed.text, language === "zh-CN" ? 180 : 360);
  if (!text) throw new Error("Chat response could not be parsed");
  return { text, tone: cleanTone(parsed.tone) };
}

async function streamSynthesizeReply(
  apiKey: string,
  text: string,
  language: "zh-CN" | "en-US",
  voice: LumenVoice,
  signal: AbortSignal,
) {
  const response = await fetch(SPEECH_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-SSE": "enable",
    },
    body: JSON.stringify({
      model: "qwen3-tts-flash",
      input: {
        text,
        voice,
        language_type: language === "zh-CN" ? "Chinese" : "English",
      },
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });

  if (!response.ok) throw await apiResponseError("Speech", response);
  if (!response.body) throw new Error("Speech response contained no stream");
  return new Response(response.body, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

function cleanAudioData(value: unknown) {
  if (typeof value !== "string" || value.length > 7_000_000) return "";
  const comma = value.indexOf(",");
  if (comma < 0 || comma > 512) return "";
  const header = value.slice(0, comma);
  // MediaRecorder can include quoted codecs, spaces and container metadata.
  // Parse the media type independently; don't rename or transcode the bytes.
  const mime = /^data:([^;]+);/i.exec(header)?.[1].trim().toLowerCase();
  const aliases: Record<string, string> = { "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4", "audio/x-wav": "audio/wav" };
  const supported = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/aac", "audio/aiff"]);
  const normalized = mime ? aliases[mime] || mime : "";
  if (!supported.has(normalized) || !/;base64$/i.test(header)) return "";
  const encoded = value.slice(comma + 1);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return "";
  return `data:${normalized};base64,${encoded}`;
}

async function apiResponseError(label: string, response: Response) {
  const detail = cleanText(await response.text(), 480);
  return new Error(`${label} request failed with ${response.status}${detail ? `: ${detail}` : ""}`);
}

function isArrearage(error: unknown) {
  return /Arrearage|overdue-payment|account is in good standing/i.test(safeError(error));
}

function parseReply(content: string): { text?: unknown; tone?: unknown } {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as { text?: unknown; tone?: unknown };
  } catch {
    return { text: trimmed, tone: "neutral" };
  }
}

function cleanPersonality(value: unknown): PersonalitySnapshot {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    trust: score(source.trust, 24),
    curiosity: score(source.curiosity, 58),
    energy: score(source.energy, 64),
    familiarity: score(source.familiarity, 0),
    fear: score(source.fear, 34),
  };
}

function cleanDevelopment(value: unknown): DevelopmentSnapshot {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    growth: score(source.growth, 7),
    resonance: score(source.resonance, 28),
    symbiosis: score(source.symbiosis, 30),
    exploration: score(source.exploration, 42),
    sensitivity: score(source.sensitivity, 36),
  };
}

function cleanHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-16).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const source = entry as Record<string, unknown>;
    const role = source.role === "assistant" ? "assistant" : source.role === "user" ? "user" : null;
    const content = cleanText(source.content, 220);
    return role && content ? [{ role, content }] : [];
  });
}

function cleanGestures(value: unknown): GestureContext[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<GestureKind>([
    "approaching",
    "gentle-touch",
    "stroking",
    "fast-movement",
    "leaving",
  ]);
  return value.slice(-6).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const source = entry as Record<string, unknown>;
    if (typeof source.kind !== "string" || !allowed.has(source.kind as GestureKind)) return [];
    if (typeof source.ageMs !== "number" || !Number.isFinite(source.ageMs) || source.ageMs < 0 || source.ageMs > 30_000) return [];
    return [{
      kind: source.kind as GestureKind,
      durationMs: boundedNumber(source.durationMs, 0, 30_000),
      intensity: boundedNumber(source.intensity, 0, 1),
      ageMs: boundedNumber(source.ageMs, 0, 30_000),
    }];
  });
}

function describeGestures(gestures: GestureContext[]) {
  if (!gestures.length) return "no recent hand interaction";
  return gestures.map((gesture) => {
    const duration = gesture.durationMs >= 1000
      ? `${(gesture.durationMs / 1000).toFixed(1)} seconds`
      : `${Math.round(gesture.durationMs)} milliseconds`;
    const intensity = gesture.intensity >= 0.72 ? "strong" : gesture.intensity >= 0.4 ? "moderate" : "subtle";
    const timing = gesture.ageMs < 900 ? "just now" : `${Math.round(gesture.ageMs / 1000)} seconds ago`;
    return `${gesture.kind} (${intensity}, lasting ${duration}, ${timing})`;
  }).join("; ");
}

function cleanTone(value: unknown): LumenTone {
  return value === "warm" || value === "curious" || value === "uneasy" ? value : "neutral";
}

function cleanVoice(value: unknown): LumenVoice {
  return value === "Andre" || value === "Neil" ? value : "Maia";
}

function cleanActivity(value: unknown): LifeActivity {
  return value === "dreaming" || value === "feeding" || value === "playing" ? value : "exploring";
}

function cleanText(value: unknown, maximum: number) {
  if (typeof value !== "string") return "";
  const printable = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  }).join("");
  return printable.trim().slice(0, maximum);
}

function score(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : fallback;
}

function boundedNumber(value: unknown, minimum: number, maximum: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : minimum;
}

function withinRateLimit(request: Request) {
  const now = Date.now();
  if (rateLimits.size > 500) {
    for (const [key, entry] of rateLimits) if (entry.resetsAt <= now) rateLimits.delete(key);
    if (rateLimits.size > 5000) return false;
  }
  const visitor = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "local";
  const key = `${visitor}:${new URL(request.url).pathname}`;
  const current = rateLimits.get(key);
  if (!current || now >= current.resetsAt) {
    rateLimits.set(key, { count: 1, resetsAt: now + 60_000 });
    return true;
  }
  if (current.count >= 12) return false;
  current.count += 1;
  return true;
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
