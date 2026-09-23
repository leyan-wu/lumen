# Lumen

Lumen is a hand-tracked artificial organism with a fluid, cell-like body. It watches for one hand through the webcam, deforms its membrane around calm contact, contracts after sudden motion, and continues its own quiet activity when alone. Its bond and development with the visitor are stored only in the browser.

## Run locally

Requirements: Node.js 22.13 or newer and a browser with webcam support.

```bash
npm install
npm run dev
```

Open the local URL printed in the terminal (normally `http://localhost:3000`), choose **Let Lumen see you**, and allow camera access. Webcam access works on `localhost`; if testing from another device, serve the page over HTTPS.

The first visit begins with a short orientation explaining what Lumen is, how voice and hand contact work, what grows the bond, and where to find its dreams. The `?` beside Lumen's name opens this guide again.

You can talk without turning on the camera. Choose the microphone and one of Lumen's three test voices beside **begin conversation**. Maia is restrained and gentle, Andre is steady, and Neil is precise; Maia is the default. Lumen remembers both selections on this device. Press **begin conversation** once, then speak naturally. Local voice-activity detection notices when a turn starts and ends; after Lumen replies aloud, listening resumes automatically. Press **end conversation** only when the conversation is over. Short audio turns are sent to Alibaba Cloud Bailian for transcription; video remains local.

To verify a production build:

```bash
npm run build
npm run start
```

## How to interact

- Hold up one hand and approach slowly. Lumen notices the palm, assesses it, and approaches while preserving a small amount of personal space.
- Lumen treats the palm as the presence of a user: it first orients, cautiously circles, and only then approaches while maintaining personal space. It does not continuously attach itself to the fingertip.
- The index fingertip is reserved for contact. A calm nearby fingertip creates a local membrane indentation and wave without dragging Lumen around the screen.
- The live hand window mirrors the camera and shows the detected skeleton, palm center, and highlighted index fingertip. Use **hide** to collapse it.
- Bring the fingertip onto Lumen gently. A touch increases trust and creates a small spark response.
- Move the hand quickly. Lumen becomes startled, contracts its field, releases a cloud of digital ink, and moves away.
- Remove the hand. After a moment, Lumen resumes feeding, exploring, playing, or sleeping according to its own activity rhythm.

The small **bond** line is the only visible personality indicator. Trust, curiosity, energy, and interaction count are saved under `lumen-memory-v1` in `localStorage`.

Lumen also remembers **familiarity** separately from trust. New organisms hesitate before approaching; repeated encounters shorten recognition time and make their approach more confident. Fear rises after sudden movement and falls through gentle contact. Emotional signals decay gradually, so visible state changes have inertia instead of switching instantly.

When alone, Lumen chooses its own exploration points and wanders through the field. Trust expands and brightens its membrane, fear contracts and darkens it, and curiosity increases autonomous motion and fluid deformation.

Hand interaction is deliberately simple: quiet nearby presence and gentle fingertip contact grow the bond, while sudden movement briefly startles Lumen. Calm presence begins registering after five seconds and can add a small amount of familiarity every twelve seconds. Touch rewards have a six-second cooldown to avoid inflating bond when tracking flickers. Status messages show the current state; Lumen’s reply stays visible until the next spoken turn or visit end.

Lumen has a separate first-person text voice. The visitor's latest transcript is explicitly labeled **you**, while Lumen's answer is labeled **lumen** and follows the organism. Earlier event narration for touch, fear, and waiting is intentionally suppressed during this voice-focused iteration so it cannot be mistaken for a conversational reply.

Voice conversation uses a three-stage path: Bailian Qwen-ASR transcribes each detected turn, non-thinking `qwen3.7-plus` generates Lumen's reply, and `qwen3-tts-flash` streams its voice as 24 kHz PCM audio. Playback begins as soon as the first cloud audio chunk arrives instead of waiting for a complete file. The selected Maia, Andre, or Neil timbre is locked when a conversation begins and every turn and retry uses that same value. Browser speech synthesis is never substituted. A cloud failure before playback gets one retry with the same voice; a partial stream is never restarted, so Lumen cannot repeat the beginning of a sentence in a second timbre. Lumen pauses voice detection while speaking so it does not answer itself. If a language request fails, the interface explains the connection failure without speaking a canned answer. Ending a conversation aborts in-flight requests and stops every queued audio chunk. Switching away pauses the conversation. WAV headers, including split headers, are parsed before PCM playback and the first audible chunk fades in.

Hand landmarks stay in the browser. A local gesture interpreter turns them into short semantic observations—approaching, gentle touch, stroking, fast movement, and leaving. Only these observations, their duration, intensity, and age are sent as language-model context. Enable **hand voice** to hear occasional reactions (off initially). Sustained touch, stroking, and nearby startling movement can produce a short response, with at least 24 seconds between reactions. Six recent reactions are supplied to the model, exact duplicates and stale responses are suppressed, and failed requests leave the physical response intact. Hand voice never replaces the selected cloud timbre.

Lumen also follows a local daily rhythm: it dreams from 23:00–07:00 and takes a midday sleep from 13:00–14:00. While awake in this prototype, it rotates through exploring, feeding, exploring, and playing in two-minute blocks, so a complete activity cycle is visible within eight minutes. These states alter motion and particle behavior and are included in the conversation context, so Lumen can naturally mention what it is doing. During sleeping periods it becomes nearly still and shows a sleep marker. Hand presence or an open conversation wakes it temporarily. Dreams are generated only while sleeping, not on every page load. One short AI-generated dream is cached per local day in a separate **last dream** journal, where it remains readable after Lumen wakes without competing with conversational replies.

Lumen's conversation prompt balances its own artificial life with attention toward the visitor. It can reason, express preferences, and discuss ordinary subjects without translating everything into aquatic metaphors. When asked about its day or feelings, it answers and asks about the visitor in return. Personal details invite a specific follow-up in roughly half of replies, avoiding both self-absorption and an interview-like question on every turn. Up to eight recent exchanges are kept locally across visits so a returning conversation can continue rather than resetting to an empty context.

Growth is stored separately under `lumen-development-v1`. A unique birth seed gives every browser-local Lumen a different contour rhythm, organelle pattern, membrane complexity, and internal pulse. Visits on distinct days and meaningful interaction gradually increase growth, with a daily cap so refreshing or repeating one gesture cannot force a sudden transformation. Conversation strengthens luminous resonance, calm presence and touch open the membrane, exploration adds internal activity, and repeated startling encourages contraction and protective coloration. The organism passes continuously through seeded, unfolding, branching, and mature development rather than swapping between fixed character skins.

## Architecture

The prototype intentionally keeps the runtime small:

- `app/LumenExperience.tsx` owns camera and microphone selection, short audio recording, the animation loop, interaction updates, and minimal UI.
- `app/lumen/hand-tracker.ts` wraps MediaPipe Hand Landmarker and converts landmarks into mirrored fingertip position, palm position, and smoothed movement speed.
- `app/lumen/creature.ts` contains proximity detection, damped spring movement, mood transitions, and the procedural organism renderer. The restored cell body uses layered fluid membranes, a responsive luminous core, orbiting organelles, subtle filaments, particles, and digital ink—there are no image assets or character sprites. Contact, fear, voice, activity, and persistent growth modify this same biological form.
- `app/lumen/types.ts` defines shared state. `storage.ts` makes device-local memory optional when storage is blocked or full.
- `app/lumen/gestures.ts` interprets sustained contact and movement locally; no landmarks leave the device.
- `app/lumen/voice-player.ts` owns streaming decoding, fade-in, retries and cancellation of all scheduled audio.
- `app/lumen/requests.ts` bounds request latency and maps recoverable failures to readable messages.

MediaPipe's WASM runtime and hand model are bundled under `public/mediapipe`, so tracking does not make a runtime request to an external model host.

## Privacy

Video frames stay in the page and are processed locally. They are not recorded, uploaded, or stored. Short microphone recordings are sent to Bailian for transcription and are not saved by Lumen. Semantic gesture summaries, personality context and recent conversation text are sent for replies; raw hand landmarks never leave the browser. Numeric personality and development state, the preferred microphone and voice, and up to eight recent text exchanges are saved in the current browser.

## Tuning

The main interaction thresholds live in `app/lumen/creature.ts`. The most useful values to tune during testing are:

- `scareThreshold` for fast movement sensitivity
- the `radius * 0.92` touch boundary
- `awarenessDistance` for curiosity range
- `moodUntil` durations for emotional reactions

## Experience regression checks

Run `npm test` to build and check server rendering, audio MIME normalization, malformed inputs, gesture repetition and frame-rate behavior, blocked storage, PCM/WAV stream decoding, cancellation of queued audio, and consistent-voice retries.

The September 2026 review also checked the local page at desktop and 390px mobile widths, keyboard dismissal/reopening of the guide, returning visits and the dream journal’s empty state. Live Bailian calls confirmed gesture replies and decoded streaming audio. Real microphone capture and hand-tracking accuracy still depend on a device test; simulated traces do not establish compatibility with every phone or microphone.
