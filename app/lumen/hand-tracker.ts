import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { HandSnapshot, Vec2 } from "./types";

const EMPTY_HAND: HandSnapshot = {
  present: false,
  center: { x: 0.5, y: 0.5 },
  indexTip: { x: 0.5, y: 0.5 },
  speed: 0,
  landmarks: [],
};

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private lastVideoTime = -1;
  private previousCenter: Vec2 | null = null;
  private smoothedCenter: Vec2 | null = null;
  private smoothedIndexTip: Vec2 | null = null;
  private previousTime = 0;
  private smoothedSpeed = 0;
  private latest: HandSnapshot = EMPTY_HAND;

  async initialize() {
    const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const baseOptions = {
      modelAssetPath: "/mediapipe/models/hand_landmarker.task",
    };

    try {
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { ...baseOptions, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.5,
      });
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions,
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.5,
      });
    }
  }

  update(video: HTMLVideoElement, now: number): HandSnapshot {
    if (!this.landmarker || video.readyState < 2) return this.latest;
    if (video.currentTime === this.lastVideoTime) return this.latest;

    this.lastVideoTime = video.currentTime;
    const result = this.landmarker.detectForVideo(video, now);
    this.latest = this.toSnapshot(result, now);
    return this.latest;
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
  }

  private toSnapshot(result: HandLandmarkerResult, now: number): HandSnapshot {
    const landmarks = result.landmarks[0];
    if (!landmarks) {
      this.previousCenter = null;
      this.smoothedCenter = null;
      this.smoothedIndexTip = null;
      this.smoothedSpeed *= 0.75;
      return { ...EMPTY_HAND, speed: this.smoothedSpeed };
    }

    const palmIndices = [0, 5, 9, 13, 17];
    const center = palmIndices.reduce(
      (sum, index) => ({
        x: sum.x + (1 - landmarks[index].x) / palmIndices.length,
        y: sum.y + landmarks[index].y / palmIndices.length,
      }),
      { x: 0, y: 0 },
    );
    const indexTip = { x: 1 - landmarks[8].x, y: landmarks[8].y };
    const mirroredLandmarks = landmarks.map((landmark) => ({
      x: 1 - landmark.x,
      y: landmark.y,
    }));

    if (this.previousCenter && this.previousTime) {
      const elapsed = Math.max(0.016, (now - this.previousTime) / 1000);
      const distance = Math.hypot(
        center.x - this.previousCenter.x,
        center.y - this.previousCenter.y,
      );
      const instantaneous = Math.min(3, distance / elapsed);
      this.smoothedSpeed += (instantaneous - this.smoothedSpeed) * 0.28;
    }

    this.previousCenter = center;
    this.previousTime = now;
    this.smoothedCenter = smoothPoint(this.smoothedCenter, center, 0.34);
    this.smoothedIndexTip = smoothPoint(this.smoothedIndexTip, indexTip, 0.42);
    return {
      present: true,
      center: this.smoothedCenter,
      indexTip: this.smoothedIndexTip,
      speed: this.smoothedSpeed,
      landmarks: mirroredLandmarks,
    };
  }
}

function smoothPoint(previous: Vec2 | null, next: Vec2, amount: number): Vec2 {
  if (!previous) return next;
  return {
    x: previous.x + (next.x - previous.x) * amount,
    y: previous.y + (next.y - previous.y) * amount,
  };
}
