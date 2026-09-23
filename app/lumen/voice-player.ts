type Voice = "Maia" | "Andre" | "Neil";

// One owner for every scheduled chunk: stopping a visit stops future audio too.
export class CloudVoicePlayer {
  private context: AudioContext | null = null;
  private sources = new Set<AudioBufferSourceNode>();

  async unlock() {
    if (!this.context || this.context.state === "closed") this.context = new AudioContext();
    if (this.context.state !== "running") await this.context.resume();
    return this.context;
  }

  stop() {
    for (const source of this.sources) {
      try { source.stop(); } catch { /* Already ended. */ }
    }
    this.sources.clear();
  }

  close() {
    this.stop();
    void this.context?.close();
    this.context = null;
  }

  async speak(text: string, language: string, voice: Voice, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const context = await this.unlock();
    const stop = () => this.stop();
    signal.addEventListener("abort", stop, { once: true });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        let started = false;
        try {
          signal.throwIfAborted();
          const streamSignal = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
          const response = await fetch("/api/lumen/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, language, voice }),
            signal: streamSignal,
          });
          if (!response.ok || !response.body) throw new Error(`Voice unavailable (${response.status})`);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let pending = "";
          let nextStart = context.currentTime + 0.04;
          let lastPlayback = Promise.resolve();
          const pcm = new PcmStreamDecoder();
          const consume = (event: string) => {
            signal.throwIfAborted();
            const data = event.split(/\r?\n/).filter(line => line.startsWith("data:"))
              .map(line => line.slice(5).trim()).join("");
            if (!data || data === "[DONE]") return;
            const payload = JSON.parse(data);
            if (payload.code) throw new Error("Voice stream failed");
            if (!payload.output?.audio?.data) return;
            const samples = pcm.push(payload.output.audio.data);
            const count = samples.length;
            if (!count) return;
            const buffer = context.createBuffer(1, count, 24_000);
            buffer.copyToChannel(samples, 0);
            const source = context.createBufferSource();
            const gain = context.createGain();
            source.buffer = buffer;
            source.connect(gain);
            gain.connect(context.destination);
            const start = Math.max(nextStart, context.currentTime + 0.02);
            const gap = start - nextStart > 0.005;
            gain.gain.setValueAtTime(!started || gap ? 0 : 0.78, start);
            if (!started || gap) gain.gain.linearRampToValueAtTime(0.78, start + Math.min(0.018, buffer.duration / 2));
            nextStart = start + buffer.duration;
            this.sources.add(source);
            lastPlayback = new Promise(resolve => {
              source.onended = () => {
                this.sources.delete(source);
                source.disconnect();
                gain.disconnect();
                resolve();
              };
            });
            source.start(start);
            started = true;
          };
          try {
            while (true) {
              const { done, value } = await reader.read();
              streamSignal.throwIfAborted();
              pending += decoder.decode(value, { stream: !done });
              const events = pending.split(/\r?\n\r?\n/);
              pending = events.pop() ?? "";
              for (const event of events) consume(event);
              if (done) break;
            }
            if (pending.trim()) consume(pending);
            if (!started) throw new Error("Empty voice stream");
            await lastPlayback;
            signal.throwIfAborted();
            return true;
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        } catch {
          this.stop();
          signal.throwIfAborted();
          // Never repeat a sentence after any of it has been scheduled.
          if (started) return false;
        }
      }
      return false;
    } finally { signal.removeEventListener("abort", stop); }
  }
}

// Bailian may prefix the first SSE audio chunk with a streaming WAV header.
// Parse actual RIFF chunks (including split headers), never play header bytes.
export class PcmStreamDecoder {
  private pending: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private headerRead = false;

  push(encoded: string): Float32Array<ArrayBuffer> {
    const binary = atob(encoded);
    let bytes = new Uint8Array(this.pending.length + binary.length);
    bytes.set(this.pending);
    for (let i = 0; i < binary.length; i++) bytes[this.pending.length + i] = binary.charCodeAt(i);
    if (!this.headerRead) {
      if (bytes.length < 4) { this.pending = bytes; return new Float32Array(0); }
      const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
      if (tag(0) === "RIFF") {
        if (bytes.length < 12) { this.pending = bytes; return new Float32Array(0); }
        if (tag(8) !== "WAVE") throw new Error("Unsupported audio container");
        const view = new DataView(bytes.buffer);
        let offset = 12;
        let dataOffset = -1;
        let validFormat = false;
        while (offset + 8 <= bytes.length) {
          const size = view.getUint32(offset + 4, true);
          if (tag(offset) === "data") {
            if (!validFormat) throw new Error("Unsupported WAV format");
            dataOffset = offset + 8;
            break;
          }
          if (offset + 8 + size > bytes.length) break;
          if (tag(offset) === "fmt " && size >= 16) {
            validFormat = view.getUint16(offset + 8, true) === 1
              && view.getUint16(offset + 10, true) === 1
              && view.getUint32(offset + 12, true) === 24_000
              && view.getUint16(offset + 22, true) === 16;
          }
          offset += 8 + size + size % 2;
        }
        if (dataOffset < 0) {
          if (bytes.length > 4096) throw new Error("Invalid WAV header");
          this.pending = bytes;
          return new Float32Array(0);
        }
        bytes = bytes.slice(dataOffset);
      }
      this.headerRead = true;
    }
    const count = Math.floor(bytes.length / 2);
    this.pending = bytes.slice(count * 2);
    const samples = new Float32Array(count);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
    return samples;
  }
}
