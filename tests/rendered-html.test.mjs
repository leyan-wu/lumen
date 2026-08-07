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
  assert.match(html, /Camera stays on this device/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("bundles hand tracking, voice conversation, and hydration-safe memory", async () => {
  const [tracker, types, experience, conversation, model] = await Promise.all([
    readFile(new URL("../app/lumen/hand-tracker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lumen/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/LumenExperience.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lumen/conversation.ts", import.meta.url), "utf8"),
    stat(new URL("../public/mediapipe/models/hand_landmarker.task", import.meta.url)),
  ]);

  assert.match(tracker, /HandLandmarker/);
  assert.match(tracker, /\/mediapipe\/wasm/);
  assert.match(tracker, /hand_landmarker\.task/);
  assert.match(types, /localStorage/);
  assert.match(types, /lumen-memory-v1/);
  assert.match(experience, /useState<Personality>\(DEFAULT_PERSONALITY\)/);
  assert.doesNotMatch(experience, /useState<Personality>\(\(\) => loadPersonality\(\)\)/);
  assert.match(experience, /webkitSpeechRecognition/);
  assert.match(experience, /speak softly/);
  assert.match(conversation, /createConversationReply/);
  assert.ok(model.size > 1_000_000);
});
