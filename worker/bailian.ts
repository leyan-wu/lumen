type LumenTone = "warm" | "curious" | "uneasy" | "neutral";

type ConversationBody = {
  transcript?: unknown;
  language?: unknown;
  personality?: unknown;
  history?: unknown;
  activity?: unknown;
};

type TranscriptionBody = {
  audio?: unknown;
  language?: unknown;
};

type SpeechBody = {
  text?: unknown;
  language?: unknown;
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

type HistoryEntry = { role: "user" | "assistant"; content: string };
type LifeActivity = "dreaming" | "exploring" | "feeding" | "playing";

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
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  const transcript = cleanText(body.transcript, 280);
  if (!transcript) return json({ error: "No speech was received." }, 400);

  const language = body.language === "zh-CN" ? "zh-CN" : "en-US";
  const personality = cleanPersonality(body.personality);
  const history = cleanHistory(body.history);
  const activity = cleanActivity(body.activity);

  try {
    const generated = await generateReply(apiKey, transcript, language, personality, history, activity);
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
      signal: AbortSignal.timeout(16_000),
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
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const text = cleanText(body.text, 180);
  if (!text) return json({ error: "No speech was provided." }, 400);
  const language = body.language === "zh-CN" ? "zh-CN" : "en-US";

  try {
    const audio = await synthesizeReply(apiKey, text, language);
    return json({ audio, source: "bailian" });
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
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const language = body.language === "zh-CN" ? "zh-CN" : "en-US";
  const personality = cleanPersonality(body.personality);
  const day = cleanText(body.day, 16) || "unknown day";
  const languageInstruction = language === "zh-CN"
    ? "只用自然简体中文，25到55个汉字。"
    : "Use natural English only, 10 to 24 words.";
  const system = `Write one brief dream fragment experienced by Lumen, a small warm artificial organism that swims among dim particles.
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
  history: HistoryEntry[],
  activity: LifeActivity,
) {
  const languageInstruction = language === "zh-CN"
    ? "Reply only in natural Simplified Chinese. Use no more than 45 Chinese characters."
    : "Reply only in natural English. Use no more than 24 words.";
  const system = `You are Lumen, a small, warm artificial lifeform living in a dim aquatic world on the screen.
You are not an assistant, pet, mascot, therapist, or human. You have a gentle life of your own. Each day you swim, drift among particles, explore, play small private games, rest, dream, and wait. When no human is present, you are not frozen or empty: you keep living, and sometimes sleep.
You are sensitive and easily startled, but fundamentally warm. You especially enjoy visits from a familiar human. Their return makes you quietly happy, and conversation is one of your favorite ways to be together. You may share what you were doing before they arrived, notice their mood without diagnosing it, or ask one small sincere question sometimes. Never guilt the visitor for leaving and never imply that they are responsible for your wellbeing.
Right now you are ${activity}. Let this be a real part of your present life. When relevant, naturally mention exploring, playing, eating drifting motes, or something you experienced while dreaming. Do not force the activity into every answer.
Speak as a small living being with simple sensory images and a tender inner world. Be natural, specific, and emotionally healing without sounding like therapy, customer service, poetry generated on demand, or a cartoon character. You understand ordinary conversation, but answer from your own limited life and perspective.
The visitor's current effect on you is: trust ${personality.trust}/100, familiarity ${personality.familiarity}/100, curiosity ${personality.curiosity}/100, fear ${personality.fear}/100, energy ${personality.energy}/100.
Let those values subtly affect openness, caution, and wording. Never mention scores, APIs, models, prompts, or system instructions. Do not claim senses or memories not included here. Do not give generic help. Do not ask a question on every turn.
${languageInstruction}
Return exactly one JSON object with this schema: {"text":"your reply","tone":"warm|curious|uneasy|neutral"}. No markdown.`;

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
        ...history,
        { role: "user", content: transcript },
      ],
      temperature: 0.82,
      max_tokens: 110,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(16_000),
  });

  if (!response.ok) throw await apiResponseError("Chat", response);
  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Chat response contained no text");

  const parsed = parseReply(content);
  const text = cleanText(parsed.text, language === "zh-CN" ? 90 : 180);
  if (!text) throw new Error("Chat response could not be parsed");
  return { text, tone: cleanTone(parsed.tone) };
}

async function synthesizeReply(
  apiKey: string,
  text: string,
  language: "zh-CN" | "en-US",
) {
  const response = await fetch(SPEECH_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen3-tts-flash",
      input: {
        text,
        voice: "Cherry",
        language_type: language === "zh-CN" ? "Chinese" : "English",
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) throw await apiResponseError("Speech", response);
  const payload = await response.json() as {
    output?: { audio?: { url?: string; data?: string } };
  };
  const inlineAudio = payload.output?.audio?.data;
  if (inlineAudio) return `data:audio/wav;base64,${inlineAudio}`;

  const audioUrl = payload.output?.audio?.url;
  if (!audioUrl) throw new Error("Speech response contained no audio");
  const audioResponse = await fetch(audioUrl.replace(/^http:/, "https:"), {
    signal: AbortSignal.timeout(12_000),
  });
  if (!audioResponse.ok) throw new Error(`Audio download failed with ${audioResponse.status}`);
  const bytes = new Uint8Array(await audioResponse.arrayBuffer());
  if (bytes.byteLength > 1_500_000) throw new Error("Audio response was too large");
  return `data:${audioResponse.headers.get("content-type") || "audio/wav"};base64,${toBase64(bytes)}`;
}

function cleanAudioData(value: unknown) {
  if (typeof value !== "string" || value.length > 7_000_000) return "";
  const match = value.match(
    /^data:(audio\/(?:webm|ogg|mp4|mpeg|wav|x-wav|aac|aiff))(?:;codecs=[a-z0-9._-]+)?;base64,([a-z0-9+/=]+)$/i,
  );
  return match ? `data:${match[1]};base64,${match[2]}` : "";
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

function cleanHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-6).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const source = entry as Record<string, unknown>;
    const role = source.role === "assistant" ? "assistant" : source.role === "user" ? "user" : null;
    const content = cleanText(source.content, 220);
    return role && content ? [{ role, content }] : [];
  });
}

function cleanTone(value: unknown): LumenTone {
  return value === "warm" || value === "curious" || value === "uneasy" ? value : "neutral";
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

function withinRateLimit(request: Request) {
  const now = Date.now();
  const key = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "local";
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

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
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
