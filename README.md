# Lumen

Lumen is a small, hand-tracked artificial organism. It watches for one hand through the webcam, follows calm movement, responds to gentle fingertip contact, and retreats from sudden motion. Its bond with the visitor is stored only in the browser.

## Run locally

Requirements: Node.js 22.13 or newer and a browser with webcam support.

```bash
npm install
npm run dev
```

Open the local URL printed in the terminal (normally `http://localhost:3000`), choose **Let Lumen see you**, and allow camera access. Webcam access works on `localhost`; if testing from another device, serve the page over HTTPS.

Once the visit begins, choose the microphone beside **begin conversation**. Lumen prefers a detected MacBook microphone by default and remembers the selection on this device. Press **begin conversation** once, then speak naturally. Local voice-activity detection notices when a turn starts and ends; after Lumen replies aloud, listening resumes automatically. Press **end conversation** only when the conversation is over. Short audio turns are sent to Alibaba Cloud Bailian for transcription; video remains local.

To verify a production build:

```bash
npm run build
npm run start
```

## How to interact

- Hold up one hand and approach slowly. Lumen notices the palm, assesses it, and approaches while preserving a small amount of personal space.
- Lumen treats the palm as the presence of a user: it first orients, cautiously circles, and only then approaches while maintaining personal space. It does not continuously attach itself to the fingertip.
- The index fingertip is reserved for contact. Touch creates a local membrane indentation and wave instead of dragging Lumen around the screen.
- The live hand window mirrors the camera and shows the detected skeleton, palm center, and highlighted index fingertip. Use **hide** to collapse it.
- Bring the fingertip onto Lumen gently. A touch increases trust and creates a small spark response.
- Move the hand quickly. Lumen becomes startled, loses a little trust and energy, and moves away.
- Remove the hand. After a moment, Lumen returns to the center and waits.

The small **bond** line is the only visible personality indicator. Trust, curiosity, energy, and interaction count are saved under `lumen-memory-v1` in `localStorage`.

Lumen also remembers **familiarity** separately from trust. New organisms hesitate before approaching; repeated encounters shorten recognition time and make their approach more confident. Fear rises after sudden movement and falls through gentle contact. Emotional signals decay gradually, so visible state changes have inertia instead of switching instantly.

When alone, Lumen chooses its own exploration points, wanders through the field, and directs its internal nucleus and particles toward those points. Trust expands and brightens the membrane, fear contracts and darkens it, and curiosity increases autonomous motion and fluid deformation.

After some familiarity has formed, Lumen may initiate a synchronization ritual. Concentric pulses and orbiting motes are an invitation to keep the palm nearby and move gently. Sustained calm alignment completes the ritual, increasing trust and familiarity; sudden movement or disappearance dissolves it. On-screen messages are queued with minimum reading times so rapid emotional changes do not overwrite one another.

Lumen has a separate first-person text voice. The visitor's latest transcript is explicitly labeled **you**, while Lumen's answer is labeled **lumen** and follows the organism. Earlier event narration for touch, fear, synchronization, and waiting is intentionally suppressed during this voice-focused iteration so it cannot be mistaken for a conversational reply.

Voice conversation uses a three-stage path: Bailian Qwen-ASR transcribes each detected turn, Qwen generates Lumen's short reply, and a fixed Qwen-TTS model and system voice speak it. The browser audio context is unlocked by the **begin conversation** gesture, allowing the generated voice to play after asynchronous synthesis. Lumen pauses voice detection while speaking so it does not answer itself.

Lumen also follows a local daily rhythm: dreaming, exploring, feeding on drifting motes, and playing. These states alter motion and particle behavior and are included in the conversation context, so Lumen can naturally mention what it is doing. During sleeping periods it becomes nearly still and shows a sleep marker. One short AI-generated dream is cached per local day and appears as text while it sleeps.

## Architecture

The prototype intentionally keeps the runtime small:

- `app/LumenExperience.tsx` owns camera and microphone selection, short audio recording, the animation loop, interaction updates, and minimal UI.
- `app/lumen/hand-tracker.ts` wraps MediaPipe Hand Landmarker and converts landmarks into mirrored fingertip position, palm position, and smoothed movement speed.
- `app/lumen/creature.ts` contains proximity detection, spring movement, mood transitions, and the procedural organism renderer. The organism is built from fluid membrane paths, a pulsing nucleus, orbiting organelles, filaments, and particle fields—there are no image assets or character sprites.
- `app/lumen/types.ts` defines shared state and handles browser memory.

MediaPipe's WASM runtime and hand model are bundled under `public/mediapipe`, so tracking does not make a runtime request to an external model host.

## Privacy

Video frames stay in the page and are processed locally. They are not recorded, uploaded, or stored. Short microphone recordings are sent to Bailian for transcription and are not saved by Lumen. Only the numeric personality state and preferred microphone ID are saved in the current browser.

## Tuning

The main interaction thresholds live in `app/lumen/creature.ts`. The most useful values to tune during testing are:

- `scareThreshold` for fast movement sensitivity
- the `radius * 0.9` touch boundary
- `noticeDistance` for curiosity range
- `moodUntil` durations for emotional reactions
