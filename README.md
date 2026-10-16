# Lumen

*A small artificial life in an increasingly digital world.*

As more of our lives move onto screens, can a digital encounter still offer a little comfort?

Lumen begins with that question. It is an experiment in artificial life: a fluid, luminous organism you can speak to, reach toward, and spend time with. It responds to gentle contact, draws back from sudden movement, and wanders or rests when left alone. Over repeated visits, its body changes through the relationship you build.

[**Spend a moment with Lumen →**](https://lumen-lifeform.leyanwu56.chatgpt.site)

## Why Lumen exists

Lumen grew out of two interests: finding moments of comfort in a world that feels increasingly electronic, and exploring what it might mean for AI to have a body.

A body gives an encounter a place to happen. There is distance to cross, a membrane to touch, movement to notice, and a rhythm that continues while you watch. Lumen's form carries traces of your time together: familiarity, caution, and gradual growth become visible in how it moves and changes.

This opens a deeper question: **if we give AI a body, could it come to feel or become aware of its own existence?**

Lumen cannot answer that question or demonstrate subjective experience. It is a creative experiment that gives the question a form we can meet. The hope is to make a little room for curiosity, care, and comfort within digital life.

## Meet Lumen

Open the [live experience](https://lumen-lifeform.leyanwu56.chatgpt.site) in a browser. No installation is needed.

- **Talk to Lumen.** Allow microphone access, speak naturally, and pause for a reply. Listening resumes after Lumen answers. The camera is optional.
- **Enable touch.** Allow camera access and show one hand. Approach slowly, then bring your fingertip gently to its membrane.
- **Stay a while.** Watch it explore, feed, play, and sleep. Open its dream journal, or return another day to see how it develops.

The sliders beside the main controls open **Interaction settings**, where you can choose a microphone, voice, and language, or enable occasional spoken reactions to touch. Conversations start in English; Chinese is available manually. Choose **End conversation** to stop talking and **Camera on** to turn off the camera. The `?` beside Lumen's name reopens the guide.

## A life that takes shape over time

Each browser starts with a different seed for Lumen's body. Gentle contact, conversation, and visits on different days gradually influence its development. It also follows a daily rhythm of activity and sleep.

Its memory belongs to the current browser: there is no account-based continuity across devices, and clearing browser storage resets that local history. Lumen is an evolving prototype; real camera and microphone behavior can vary by device.

## Privacy

Camera frames and hand tracking stay on your device. Voice clips are sent to Alibaba Cloud Bailian for transcription. Conversation text and short semantic gesture summaries are sent for AI replies; raw hand landmarks are not uploaded.

Relationship and development state, microphone and voice preferences, and up to eight recent text exchanges are stored in the browser.

## Run locally

Requirements: **Node.js 22.13+** and a browser with microphone or webcam support for the corresponding interactions.

```bash
npm install
cp .env.example .env.local
```

For voice conversation and generated dreams, set `DASHSCOPE_API_KEY` in `.env.local` to your own Alibaba Cloud Bailian key. The key is used by the server. Keep `.env.local` private; it is excluded from Git. Do not put credentials in client code or browser-exposed environment variables.

```bash
npm run dev
```

Open the URL printed in the terminal, normally `http://localhost:3000`. Camera and microphone access require `localhost` or HTTPS.

```bash
npm test       # production build and regression checks
npm run start # serve the production build locally
```

## How it is built

Lumen combines a procedural canvas body, local MediaPipe hand tracking, and a server-side voice pipeline for transcription, replies, and streaming speech. Its movement, gesture interpretation, and browser memory are implemented locally; AI requests pass through the Worker backend.

See [technical notes](docs/technical-notes.md) for architecture, interaction details, daily rhythms, tuning, and validation. The [credential exposure review](docs/security-review-2026-10-17.md) records the scope and limits of the latest security check.
