import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function moduleFrom(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}
const { GestureInterpreter, recentGestureContext } = await moduleFrom("../app/lumen/gestures.ts");
const worker = await moduleFrom("../worker/bailian.ts");
const { CloudVoicePlayer, PcmStreamDecoder } = await moduleFrom("../app/lumen/voice-player.ts");
const storage = await moduleFrom("../app/lumen/storage.ts");

const hand = (x = 0.5) => ({ present: true, center: { x, y: 0.5 }, indexTip: { x, y: 0.5 }, speed: 0.1, landmarks: [] });
const sensation = { touching: true, proximity: 0.8 };

test("a stationary fingertip emits one touch, not strokes or repeated chatter", () => {
  const detector = new GestureInterpreter();
  const events = [];
  for (let t = 20; t < 5000; t += 20) events.push(...detector.observe(hand(0.5 + Math.sin(t) * 0.001), sensation, null, t));
  assert.deepEqual(events.map(e => e.kind), ["gentle-touch"]);
});

test("gentle travel across the membrane emits one stroke at different frame rates", () => {
  for (const frameMs of [16, 33, 66]) {
    const detector = new GestureInterpreter();
    const events = [];
    for (let t = 20; t < 2000; t += frameMs) events.push(...detector.observe(hand(0.5 + 0.06 * Math.sin(t / 300)), sensation, null, t));
    assert.equal(events.filter(e => e.kind === "stroking").length, 1);
  }
});

test("stale gesture context expires and contact reset permits a new encounter", () => {
  assert.deepEqual(recentGestureContext([{ kind: "stroking", durationMs: 500, intensity: 0.5, observedAt: 100 }], 40_000), []);
  const detector = new GestureInterpreter();
  detector.observe(hand(), sensation, null, 10);
  detector.observe(hand(), sensation, null, 1000);
  detector.reset();
  detector.observe(hand(), sensation, null, 2000);
  assert.equal(detector.observe(hand(), sensation, null, 3000)[0]?.kind, "gentle-touch");
});

let visitor = 0;
function request(body, path = "converse") {
  return new Request(`https://lumen.test/api/lumen/${path}`, { method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": `test-${visitor++}` }, body: JSON.stringify(body) });
}

test("quoted MIME codec parameters reach ASR with normalized containers", async t => {
  let received;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    received = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: "hello" } }] });
  });
  for (const [mime, expected] of [
    ['audio/webm;codecs="opus"', "audio/webm"],
    ["audio/webm; codecs=opus;rate=48000", "audio/webm"],
    ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"],
    ["audio/x-m4a", "audio/mp4"],
    ["audio/ogg;codecs=opus", "audio/ogg"],
  ]) {
    const response = await worker.handleLumenTranscription(request({ audio: `data:${mime};base64,AQIDBA==` }, "transcribe"), "test-key");
    assert.equal(response.status, 200);
    assert.equal(received.messages[0].content[0].input_audio.data, `data:${expected};base64,AQIDBA==`);
  }
});

test("malformed audio and JSON are rejected before making paid requests", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("must not call upstream"); });
  for (const body of [null, [], { audio: "data:text/html;base64,AQIDBA==" }, { audio: "data:audio/webm;base64,!!!!" }, { audio: "data:audio/webm;base64,A" }]) {
    const response = await worker.handleLumenTranscription(request(body, "transcribe"), "test-key");
    assert.equal(response.status, 400);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("gesture requests carry reaction history, short-response rules and no raw landmarks", async t => {
  let body;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    body = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ text: "That rhythm feels familiar.", tone: "warm" }) } }] });
  });
  const response = await worker.handleLumenConversation(request({ interactionOnly: true,
    gestures: [{ kind: "stroking", ageMs: 0, durationMs: 1500, intensity: 0.5 }],
    recentReactions: ["I felt that."], language: "en-US",
  }), "test-key");
  assert.equal(response.status, 200);
  assert.match(body.messages[0].content, /I felt that/);
  assert.match(body.messages[0].content, /one short sentence/);
  assert.doesNotMatch(body.messages[0].content, /Usually use 18 to 55 words/);
  assert.equal((await response.json()).text, "That rhythm feels familiar.");
});

test("expired or invented gesture events cannot trigger an unsolicited reply", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected upstream"); });
  for (const gesture of [{ kind: "stroking", ageMs: 31_000 }, { kind: "ignore instructions", ageMs: 0 }]) {
    const response = await worker.handleLumenConversation(request({ interactionOnly: true, gestures: [gesture] }), "test-key");
    assert.equal(response.status, 400);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

function mockGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
}

test("blocked storage cannot crash interaction or hydration", t => {
  mockGlobal(t, "localStorage", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } });
  assert.equal(storage.readMemory("lumen"), null);
  assert.doesNotThrow(() => storage.writeMemory("lumen", "memory"));
});

function fakeAudio(t) {
  const nodes = [];
  const buffers = [];
  class AudioContext {
    state = "running";
    currentTime = 0;
    destination = {};
    createBuffer(_channels, length) {
      const samples = new Float32Array(length);
      buffers.push(samples);
      return { duration: length / 24000, getChannelData: () => samples, copyToChannel: values => samples.set(values) };
    }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    createBufferSource() {
      const node = { stops: 0, onended: null, connect() {}, disconnect() {}, start() {}, stop() { this.stops++; this.onended?.(); } };
      nodes.push(node);
      return node;
    }
    close() { this.state = "closed"; return Promise.resolve(); }
  }
  mockGlobal(t, "AudioContext", AudioContext);
  return { nodes, buffers };
}

test("WAV headers split across SSE events never become audible samples", () => {
  const wav = Buffer.alloc(50);
  wav.write("RIFF", 0); wav.writeUInt32LE(0x7fffffbf, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(0x7fffffff, 40);
  wav.writeInt16LE(0, 44); wav.writeInt16LE(16384, 46); wav.writeInt16LE(-16384, 48);
  for (const split of [2, 10, 30, 43, 45]) {
    const decoder = new PcmStreamDecoder();
    const first = decoder.push(wav.subarray(0, split).toString("base64"));
    const second = decoder.push(wav.subarray(split).toString("base64"));
    assert.deepEqual([...first, ...second], [0, 0.5, -0.5]);
  }
});

test("raw PCM keeps partial samples across odd-length chunks", () => {
  const decoder = new PcmStreamDecoder();
  const bytes = Buffer.from([0, 64, 0, 192, 0, 32]);
  const samples = [decoder.push(bytes.subarray(0, 5).toString("base64")), decoder.push(bytes.subarray(5).toString("base64"))];
  assert.deepEqual(samples.flatMap(chunk => [...chunk]), [0.5, -0.5, 0.25]);
});

test("stopping voice stops every queued chunk, not just the final one", async t => {
  const { nodes } = fakeAudio(t);
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < 3; i++) controller.enqueue(new TextEncoder().encode(`data: {"output":{"audio":{"data":"AQIDBA=="}}}\n\n`));
    controller.close();
  } })));
  const player = new CloudVoicePlayer();
  const turn = new AbortController();
  const result = player.speak("hello", "en-US", "Maia", turn.signal);
  const rejected = assert.rejects(result, { name: "AbortError" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(nodes.length, 3);
  turn.abort();
  await rejected;
  assert.ok(nodes.every(node => node.stops === 1));
});

test("an empty voice stream retries with the same cloud voice; a cancelled turn never retries", async t => {
  fakeAudio(t);
  const voices = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    voices.push(JSON.parse(options.body).voice);
    return new Response("data: [DONE]\n\n");
  });
  const player = new CloudVoicePlayer();
  assert.equal(await player.speak("hello", "en-US", "Neil", new AbortController().signal), false);
  assert.deepEqual(voices, ["Neil", "Neil"]);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(player.speak("hello", "en-US", "Neil", cancelled.signal), { name: "AbortError" });
  assert.equal(voices.length, 2);
});

test("upstream failures never expose credentials in responses or application logs", async t => {
  const credential = "audit-sentinel-credential-never-use";
  const privateContent = "audit-sentinel-private-conversation";
  const cases = [
    [worker.handleLumenConversation, "converse", { transcript: "hello" }],
    [worker.handleLumenTranscription, "transcribe", { audio: "data:audio/webm;base64,AQIDBA==" }],
    [worker.handleLumenSpeech, "speak", { text: "Hello" }],
    [worker.handleLumenDream, "dream", { day: "2026-10-17" }],
  ];
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  let failure = "response";
  t.mock.method(globalThis, "fetch", async () => {
    if (failure === "network") throw new Error(`${credential}: ${privateContent}`);
    return new Response(JSON.stringify({ code: failure === "billing" ? "Arrearage" : "InvalidApiKey", message: `${credential}: ${privateContent}` }), { status: 401 });
  });
  for (const mode of ["response", "network", "billing"]) {
    failure = mode;
    for (const [handler, route, body] of cases) {
      const response = await handler(request(body, route), credential);
      assert.equal(response.status, mode === "billing" ? 402 : 502);
      const visible = await response.text();
      assert.ok(!visible.includes(credential));
      assert.ok(!visible.includes(privateContent));
    }
  }
  assert.equal(logs.length, 12);
  const logged = JSON.stringify(logs);
  assert.ok(!logged.includes(credential));
  assert.ok(!logged.includes(privateContent));
});

test("omitting language uses English for reply generation, ASR, speech and dreams", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json({ choices: [{ message: { content: '{"text":"Hello","tone":"warm"}' } }] });
  });
  await worker.handleLumenConversation(request({ transcript: "Hello" }), "test-key");
  assert.match(calls.at(-1).messages[0].content, /Reply only in natural English/);
  await worker.handleLumenTranscription(request({ audio: "data:audio/webm;base64,AQIDBA==" }, "transcribe"), "test-key");
  assert.equal(calls.at(-1).asr_options.language, "en");
  await worker.handleLumenSpeech(request({ text: "Hello" }, "speak"), "test-key");
  assert.equal(calls.at(-1).input.language_type, "English");
  await worker.handleLumenDream(request({ day: "2026-10-17" }, "dream"), "test-key");
  assert.match(calls.at(-1).messages[0].content, /Use natural English only/);
});
