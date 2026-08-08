type LumenTone = "warm" | "curious" | "uneasy" | "neutral";

type ConversationBody = {
  transcript?: unknown;
  language?: unknown;
  personality?: unknown;
  history?: unknown;
};

type PersonalitySnapshot = {
  trust: number;
  curiosity: number;
  energy: number;
  familiarity: number;
  fear: number;
};

type HistoryEntry = { role: "user" | "assistant"; content: string };

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

  try {
    const generated = await generateReply(apiKey, transcript, language, personality, history);
    let audio: string | null = null;
    try {
      audio = await synthesizeReply(apiKey, generated.text, language, generated.tone);
    } catch (error) {
      console.error("Bailian speech synthesis failed", safeError(error));
    }

    return json({ ...generated, audio, source: "bailian" });
  } catch (error) {
    console.error("Bailian conversation failed", safeError(error));
    return json({ error: "Lumen could not form a distant response." }, 502);
  }
}

async function generateReply(
  apiKey: string,
  transcript: string,
  language: "zh-CN" | "en-US",
  personality: PersonalitySnapshot,
  history: HistoryEntry[],
) {
  const languageInstruction = language === "zh-CN"
    ? "Reply only in natural Simplified Chinese. Use no more than 45 Chinese characters."
    : "Reply only in natural English. Use no more than 24 words.";
  const system = `You are Lumen, a small artificial organism learning one visitor over repeated encounters.
You are not an assistant, pet, mascot, or human. Speak like an unfamiliar biological intelligence: observant, restrained, intimate, and slightly mysterious.
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

  if (!response.ok) throw new Error(`Chat request failed with ${response.status}`);
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
  tone: LumenTone,
) {
  const toneDirection: Record<LumenTone, string> = {
    warm: "温和而亲近，气息柔软，但仍然保持非人类生命体的陌生感。",
    curious: "带克制的好奇，像一个刚学会语言的生命体在观察新现象。",
    uneasy: "谨慎、收缩、稍有不安，音量较轻，不要戏剧化。",
    neutral: "平静、低声、内省，像从水下或薄膜后传来的声音。",
  };
  const instructions = language === "zh-CN"
    ? `声音低沉轻柔，接近耳语，语速稍慢，有自然停顿。${toneDirection[tone]}不要模仿任何人物。`
    : `Use a soft low voice, close to a whisper, with a slow pace and natural pauses. Sound ${tone === "uneasy" ? "cautious and slightly contracted" : tone === "warm" ? "gentle and quietly open" : tone === "curious" ? "restrained and curious" : "calm and introspective"}, like a nonhuman organism learning speech. Do not imitate any person.`;

  const response = await fetch(SPEECH_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen3-tts-instruct-flash",
      input: {
        text,
        voice: "Cherry",
        language_type: language === "zh-CN" ? "Chinese" : "English",
        instructions,
        optimize_instructions: true,
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) throw new Error(`Speech request failed with ${response.status}`);
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
