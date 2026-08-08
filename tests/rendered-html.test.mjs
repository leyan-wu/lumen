import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Lumen experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Lumen — a digital lifeform<\/title>/i);
  assert.match(html, /Let Lumen see you/);
  assert.match(html, /Meet Lumen/);
  assert.match(html, /last dream/);
  assert.match(html, /Camera stays on this device/);
  assert.match(html, /short voice clips go to Bailian/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("bundles hand tracking, voice conversation, growth, and hydration-safe memory", async () => {
  const [tracker, types, development, creature, experience, conversation, bailian, model] = await Promise.all([
    readFile(new URL("../app/lumen/hand-tracker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lumen/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lumen/development.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lumen/creature.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/LumenExperience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lumen/conversation.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/bailian.ts", import.meta.url), "utf8"),
    stat(new URL("../public/mediapipe/models/hand_landmarker.task", import.meta.url)),
  ]);

  assert.match(tracker, /HandLandmarker/);
  assert.match(tracker, /\/mediapipe\/wasm/);
  assert.match(tracker, /hand_landmarker\.task/);
  assert.match(types, /localStorage/);
  assert.match(types, /lumen-memory-v1/);
  assert.match(development, /lumen-development-v1/);
  assert.match(development, /DAILY_GROWTH_LIMIT/);
  assert.match(development, /morphology|DevelopmentStage/);
  assert.match(creature, /drawMembranes/);
  assert.match(creature, /fluidPath/);
  assert.match(creature, /drawInternalLife/);
  assert.match(creature, /drawFilaments/);
  assert.doesNotMatch(creature, /drawTentacles|drawSensoryNodes|ensureTentacle/);
  assert.match(creature, /releaseInk/);
  assert.match(experience, /useState<Personality>\(DEFAULT_PERSONALITY\)/);
  assert.doesNotMatch(experience, /useState<Personality>\(\(\) => loadPersonality\(\)\)/);
  assert.match(experience, /MediaRecorder/);
  assert.match(experience, /enumerateDevices/);
  assert.match(experience, /begin conversation/);
  assert.match(experience, /VOICE_START_LEVEL/);
  assert.match(experience, /VOICE_END_SILENCE_MS/);
  assert.match(experience, /AudioContext/);
  assert.match(experience, /\/api\/lumen\/transcribe/);
  assert.match(experience, /\/api\/lumen\/converse/);
  assert.match(experience, /\/api\/lumen\/speak/);
  assert.match(experience, /\/api\/lumen\/dream/);
  assert.match(experience, /dream-journal/);
  assert.match(experience, /guide-card/);
  assert.match(conversation, /createConversationReply/);
  assert.match(bailian, /;codecs=/);
  assert.match(bailian, /handleLumenDream/);
  assert.match(bailian, /How has your day felt|roughly half of your replies/);
  assert.match(bailian, /model: "qwen3\.7-plus"/);
  assert.match(bailian, /model: "qwen3-tts-flash"/);
  assert.match(bailian, /X-DashScope-SSE/);
  assert.match(experience, /playBailianSpeechStream/);
  assert.match(experience, /decodePcm16/);
  assert.match(experience, /linearRampToValueAtTime/);
  assert.match(experience, /binary\.slice\(0, 4\) === "RIFF"/);
  assert.doesNotMatch(experience, /speakWithBrowserVoice|SpeechSynthesisUtterance/);
  assert.match(experience, /lumen-conversation-memory-v1/);
  assert.match(experience, /Maia · quiet/);
  assert.match(bailian, /enable_thinking: false/);
  assert.ok(model.size > 1_000_000);
});

test("keeps the Bailian credential server-side", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("api-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/lumen/converse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: "你好", language: "zh-CN" }),
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /sk-/i);
});
