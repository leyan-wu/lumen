import type { HandSnapshot, LifeActivity, Mood, Personality, Vec2 } from "./types";
import type { VoiceTone } from "./conversation";

export type CreatureEvent =
  | "touch"
  | "scare"
  | "ritual-invite"
  | "ritual-success"
  | "ritual-break"
  | null;

type Spark = { x: number; y: number; angle: number; life: number; speed: number };
type Affect = { fear: number; curiosity: number; resonance: number; solitude: number };
type RitualPhase = "dormant" | "inviting" | "synchronizing" | "success" | "cooldown";

export class Creature {
  position: Vec2 = { x: 0, y: 0 };
  mood: Mood = "idle";
  activity: LifeActivity = "exploring";

  private velocity: Vec2 = { x: 0, y: 0 };
  private target: Vec2 = { x: 0, y: 0 };
  private initialized = false;
  private touching = false;
  private hasMetHand = false;
  private handSeenSince = 0;
  private missingSince = 0;
  private moodUntil = 0;
  private lastScare = -Infinity;
  private pendingMood: Mood = "idle";
  private pendingMoodSince = 0;
  private nextWanderAt = 0;
  private explorationPoint: Vec2 = { x: 0, y: 0 };
  private contactPoint: Vec2 = { x: 0, y: 0 };
  private contactStrength = 0;
  private ritualPhase: RitualPhase = "dormant";
  private ritualProgress = 0;
  private ritualStartedAt = 0;
  private nextRitualAt = 0;
  private affect: Affect = { fear: 0.18, curiosity: 0.12, resonance: 0, solitude: 0.2 };
  private visual = { fear: 0.18, openness: 0.25, curiosity: 0.5 };
  private sparks: Spark[] = [];
  private heardUntil = 0;
  private heardTone: VoiceTone = "neutral";
  private voicePulse = 0;

  setActivity(activity: LifeActivity) {
    this.activity = activity;
  }

  hear(tone: VoiceTone, now: number) {
    this.heardTone = tone;
    this.heardUntil = now + 2600;
    this.voicePulse = 1;
    if (this.initialized) this.releaseSparks(this.position);
  }

  step(
    hand: HandSnapshot,
    personality: Personality,
    width: number,
    height: number,
    now: number,
    deltaSeconds: number,
  ): CreatureEvent {
    if (!this.initialized) {
      this.position = { x: width * 0.5, y: height * 0.51 };
      this.target = { ...this.position };
      this.explorationPoint = { ...this.position };
      this.initialized = true;
    }

    const radius = this.radius(width, height);
    const palmPoint = { x: hand.center.x * width, y: hand.center.y * height };
    const tipPoint = { x: hand.indexTip.x * width, y: hand.indexTip.y * height };
    const dx = palmPoint.x - this.position.x;
    const dy = palmPoint.y - this.position.y;
    const distance = Math.max(0.001, Math.hypot(dx, dy));
    const tipDx = tipPoint.x - this.position.x;
    const tipDy = tipPoint.y - this.position.y;
    const tipDistance = Math.hypot(tipDx, tipDy);
    const awarenessDistance = Math.min(width, height) * (0.29 + personality.curiosity * 0.0015);
    const isNewborn = personality.familiarity < 5 && personality.interactionCount < 6;
    let desiredMood: Mood = "idle";
    let fearTarget = personality.fear / 220;
    let curiosityTarget = 0.12 + personality.curiosity / 220;
    let resonanceTarget = 0;
    let solitudeTarget = 0.12;
    let frightened = false;
    let event: CreatureEvent = null;

    if (hand.present) {
      if (!this.handSeenSince) this.handSeenSince = now;
      this.hasMetHand = true;
      this.missingSince = 0;
      const scareThreshold = 0.82 + personality.trust * 0.0025;
      const recognitionDelay = 1450 - personality.familiarity * 11.5;
      const recognition = clamp((now - this.handSeenSince) / Math.max(240, recognitionDelay), 0, 1);

      if (hand.speed > scareThreshold && now - this.lastScare > 1400) {
        this.lastScare = now;
        this.moodUntil = now + 950;
        this.touching = false;
        desiredMood = "scared";
        fearTarget = 1;
        frightened = true;
        const fleeDistance = Math.min(width, height) * 0.3;
        this.target = {
          x: this.position.x - (dx / distance) * fleeDistance,
          y: this.position.y - (dy / distance) * fleeDistance,
        };
        event = "scare";
      } else if (now < this.moodUntil && this.affect.fear > 0.38) {
        desiredMood = "scared";
        fearTarget = 0.82;
        frightened = true;
        // Let the recoil resolve before accepting another intent.
      } else if (tipDistance < radius * 0.92 && hand.speed < 0.68) {
        this.moodUntil = now + 1050;
        desiredMood = "happy";
        resonanceTarget = 1;
        fearTarget *= 0.35;
        this.contactPoint = tipPoint;
        // Contact deforms the membrane locally; it does not drag the organism.
        this.target = { ...this.position };
        if (!this.touching) {
          this.touching = true;
          this.releaseSparks(tipPoint);
          event = "touch";
        }
      } else {
        this.touching = false;
        if (distance < awarenessDistance) {
          desiredMood = isNewborn && recognition < 0.78 ? "newborn" : "curious";
          curiosityTarget = isNewborn ? 0.62 : 0.9;
          fearTarget = isNewborn ? Math.max(fearTarget, 0.28 * (1 - recognition)) : fearTarget;
          if (recognition < 0.34) {
            // First notice: orient internally and hold position before deciding.
            const sway = Math.sin(now * 0.0018) * radius * 0.04;
            this.target = {
              x: this.position.x + (-dy / distance) * sway,
              y: this.position.y + (dx / distance) * sway,
            };
          } else {
            const safetyDistance = radius * (2.15 - personality.trust * 0.0065);
            const willingness = clamp(
              recognition * (0.24 + personality.familiarity / 135),
              0,
              0.96,
            );
            const approach = Math.max(0, distance - safetyDistance) * willingness;
            const orbitDirection = Math.sin(now * 0.00072 + personality.curiosity * 0.08);
            const orbit = radius * (isNewborn ? 0.48 : 0.27) * orbitDirection;
            this.target = {
              x: this.position.x + (dx / distance) * approach + (-dy / distance) * orbit,
              y: this.position.y + (dy / distance) * approach + (dx / distance) * orbit,
            };
          }
        } else {
          desiredMood = isNewborn && recognition < 0.55 ? "newborn" : "idle";
          // A distant hand is registered, but Lumen does not behave like a cursor follower.
          this.target = {
            x: this.position.x + dx * 0.006 * recognition,
            y: this.position.y + dy * 0.006 * recognition,
          };
        }
      }
    } else {
      this.handSeenSince = 0;
      this.touching = false;
      if (!this.missingSince) this.missingSince = now;
      const aloneFor = now - this.missingSince;
      desiredMood = this.hasMetHand && aloneFor > 1100 ? "lonely" : "idle";
      solitudeTarget = this.hasMetHand ? 0.62 : 0.24;
      curiosityTarget = 0.2 + personality.curiosity / 180;

      if (
        this.activity !== "dreaming" &&
        aloneFor > 1450 &&
        (now >= this.nextWanderAt || distanceBetween(this.target, this.position) < radius * 0.3)
      ) {
        const phase = now * 0.00031 + personality.curiosity * 0.071;
        const activityRange = this.activity === "playing" ? 1.22 : this.activity === "feeding" ? 0.72 : 1;
        const wander = (0.16 + personality.curiosity / 330) * activityRange;
        this.explorationPoint = {
          x: width * (0.5 + Math.sin(phase * 1.7) * wander),
          y: height * (0.49 + Math.cos(phase * 1.13 + 1.4) * wander * 0.58),
        };
        const activityPace = this.activity === "playing" ? 0.56 : this.activity === "feeding" ? 1.28 : 1;
        this.nextWanderAt = now + (6500 - personality.curiosity * 34 + Math.sin(phase) * 900) * activityPace;
      }
      // Briefly hold the last place of attention, then resume autonomous life.
      this.target = this.activity === "dreaming" || aloneFor <= 1450
        ? { ...this.position }
        : { ...this.explorationPoint };
    }

    if (now < this.heardUntil && event !== "touch" && event !== "scare") {
      if (this.heardTone === "warm") {
        desiredMood = "happy";
        resonanceTarget = Math.max(resonanceTarget, 0.82);
        fearTarget *= 0.24;
      } else if (this.heardTone === "curious") {
        desiredMood = "curious";
        curiosityTarget = Math.max(curiosityTarget, 0.98);
        resonanceTarget = Math.max(resonanceTarget, 0.3);
      } else if (this.heardTone === "uneasy") {
        desiredMood = "scared";
        fearTarget = Math.max(fearTarget, 0.78);
      } else {
        desiredMood = personality.familiarity < 5 ? "newborn" : "curious";
        curiosityTarget = Math.max(curiosityTarget, 0.72);
        resonanceTarget = Math.max(resonanceTarget, 0.22);
      }
    }

    const ritualEvent = this.updateRitual(
      hand,
      personality,
      distance,
      radius,
      awarenessDistance,
      now,
      deltaSeconds,
      frightened || event === "scare",
    );
    if (this.ritualPhase === "inviting" || this.ritualPhase === "synchronizing") {
      curiosityTarget = Math.max(curiosityTarget, 0.92);
      resonanceTarget = Math.max(resonanceTarget, 0.46 + this.ritualProgress * 0.42);
    }
    if (!event && ritualEvent) event = ritualEvent;

    const fearRate = fearTarget > this.affect.fear ? 4.8 : 0.58;
    this.affect.fear = damp(this.affect.fear, fearTarget, fearRate, deltaSeconds);
    this.affect.curiosity = damp(this.affect.curiosity, curiosityTarget, 1.15, deltaSeconds);
    this.affect.resonance = damp(this.affect.resonance, resonanceTarget, resonanceTarget ? 3.2 : 0.72, deltaSeconds);
    this.affect.solitude = damp(this.affect.solitude, solitudeTarget, 0.42, deltaSeconds);
    this.contactStrength = damp(this.contactStrength, this.touching ? 1 : 0, this.touching ? 7 : 2.1, deltaSeconds);
    this.voicePulse = damp(this.voicePulse, 0, 1.12, deltaSeconds);
    this.transitionMood(desiredMood, now);

    this.target.x = clamp(this.target.x, radius * 1.2, width - radius * 1.2);
    this.target.y = clamp(this.target.y, radius * 1.2, height - radius * 1.2);

    const activityEnergy = this.activity === "dreaming" ? 0.18 : this.activity === "playing" ? 1.18 : 1;
    const energy = (0.65 + personality.energy / 180) * activityEnergy;
    const familiarResponse = 0.62 + personality.familiarity / 210;
    const idleResponse = 0.45 + personality.curiosity / 250;
    const stiffness = (frightened ? 13 : hand.present ? 5.4 * familiarResponse : 3.8 * idleResponse) * energy;
    const damping = Math.pow(frightened ? 0.0014 : 0.0008, deltaSeconds);
    this.velocity.x = (this.velocity.x + (this.target.x - this.position.x) * stiffness * deltaSeconds) * damping;
    this.velocity.y = (this.velocity.y + (this.target.y - this.position.y) * stiffness * deltaSeconds) * damping;
    this.position.x += this.velocity.x * deltaSeconds;
    this.position.y += this.velocity.y * deltaSeconds;

    this.sparks = this.sparks
      .map((spark) => ({ ...spark, life: spark.life - deltaSeconds }))
      .filter((spark) => spark.life > 0);

    return event;
  }

  private updateRitual(
    hand: HandSnapshot,
    personality: Personality,
    palmDistance: number,
    radius: number,
    awarenessDistance: number,
    now: number,
    deltaSeconds: number,
    threatened: boolean,
  ): Exclude<CreatureEvent, "touch" | "scare"> {
    if (!this.nextRitualAt) {
      this.nextRitualAt = now + (personality.familiarity < 5 ? 6500 : 4200);
    }

    if (this.ritualPhase === "success") {
      if (now - this.ritualStartedAt > 2800) this.ritualPhase = "cooldown";
      return null;
    }

    if (this.ritualPhase === "cooldown") {
      if (now >= this.nextRitualAt) this.ritualPhase = "dormant";
      return null;
    }

    const active = this.ritualPhase === "inviting" || this.ritualPhase === "synchronizing";
    if ((!hand.present || threatened) && active) {
      this.ritualPhase = "cooldown";
      this.ritualProgress = 0;
      this.nextRitualAt = now + 10500;
      return "ritual-break";
    }

    if (
      this.ritualPhase === "dormant" &&
      hand.present &&
      !this.touching &&
      personality.familiarity >= 1.5 &&
      now >= this.nextRitualAt &&
      palmDistance < awarenessDistance * 1.12 &&
      hand.speed < 0.42
    ) {
      this.ritualPhase = "inviting";
      this.ritualStartedAt = now;
      this.ritualProgress = 0;
      return "ritual-invite";
    }

    if (this.ritualPhase === "inviting" && now - this.ritualStartedAt > 1750) {
      this.ritualPhase = "synchronizing";
    }

    if (this.ritualPhase === "synchronizing") {
      const receptiveDistance = palmDistance > radius * 1.1 && palmDistance < awarenessDistance * 1.12;
      const gentleMotion = hand.speed < 0.34;
      const gain = 0.25 + personality.familiarity * 0.0015;
      this.ritualProgress = clamp(
        this.ritualProgress + deltaSeconds * (receptiveDistance && gentleMotion ? gain : -0.2),
        0,
        1,
      );

      if (this.ritualProgress >= 1) {
        this.ritualPhase = "success";
        this.ritualStartedAt = now;
        this.nextRitualAt = now + 26000;
        return "ritual-success";
      }
    }

    if (active && now - this.ritualStartedAt > 12000) {
      this.ritualPhase = "cooldown";
      this.ritualProgress = 0;
      this.nextRitualAt = now + 12000;
      return "ritual-break";
    }

    return null;
  }

  private transitionMood(desired: Mood, now: number) {
    if (desired === this.mood) {
      this.pendingMood = desired;
      this.pendingMoodSince = now;
      return;
    }
    if (desired !== this.pendingMood) {
      this.pendingMood = desired;
      this.pendingMoodSince = now;
      return;
    }

    const delay = desired === "scared" ? 110 : desired === "happy" ? 170 : 440;
    if (now - this.pendingMoodSince >= delay) this.mood = desired;
  }

  draw(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    now: number,
    personality: Personality,
    hand: HandSnapshot,
  ) {
    const time = now / 1000;
    const energy = personality.energy / 100;
    const traitFear = personality.fear / 100;
    const fear = clamp(traitFear * 0.5 + this.affect.fear * 0.82, 0, 1);
    const openness = clamp(personality.trust / 100 * 0.82 + this.affect.resonance * 0.24, 0, 1);
    const curiosity = clamp(personality.curiosity / 100 * 0.64 + this.affect.curiosity * 0.48, 0, 1);
    this.visual = { fear, openness, curiosity };
    const radius = this.radius(width, height) * (0.92 + openness * 0.15) * (1 - fear * 0.17);
    const breathRate = this.activity === "dreaming" ? 0.34 : 0.72 + energy * 0.22;
    const breath = (Math.sin(time * breathRate * Math.PI * 2) + 1) * 0.5;
    const breathingScale = 0.968 + breath * (0.04 + energy * 0.012 + openness * 0.018) - fear * 0.018;
    const activityFloat = this.activity === "dreaming" ? 0.24 : this.activity === "playing" ? 1.28 : 1;
    const floatY = Math.sin(time * (0.42 + curiosity * 0.12)) * (4 + energy * 2 + curiosity * 4) * activityFloat;
    const center = { x: this.position.x, y: this.position.y + floatY };
    const movement = Math.hypot(this.velocity.x, this.velocity.y);
    const movementAngle = Math.atan2(this.velocity.y, this.velocity.x);
    const stretch = Math.min(0.13, movement / 900);

    this.drawAtmosphere(context, width, height, time, center, radius, hand);
    this.drawFilaments(context, center, radius, time, movementAngle, stretch);
    this.drawHalo(context, center, radius, breath);
    this.drawVoiceRipple(context, center, radius);
    this.drawMembranes(
      context,
      center,
      radius * breathingScale,
      time,
      energy,
      movementAngle,
      stretch,
    );
    this.drawInternalLife(context, center, radius, time, energy, breath, hand);
    this.drawFieldParticles(context, center, radius, time, energy, hand);
    this.drawRitual(context, center, radius, time);
    this.drawSparks(context);
  }

  private radius(width: number, height: number) {
    return clamp(Math.min(width, height) * 0.13, 72, 126);
  }

  private drawVoiceRipple(context: CanvasRenderingContext2D, center: Vec2, radius: number) {
    if (this.voicePulse < 0.025) return;
    const progress = 1 - this.voicePulse;
    const color = this.heardTone === "uneasy"
      ? "216, 152, 164"
      : this.heardTone === "warm"
        ? "205, 255, 194"
        : "154, 241, 218";

    context.save();
    context.globalCompositeOperation = "screen";
    context.lineWidth = 1.1;
    for (let ring = 0; ring < 2; ring += 1) {
      const staggered = clamp(progress - ring * 0.14, 0, 1);
      context.globalAlpha = this.voicePulse * (0.32 - ring * 0.09);
      context.strokeStyle = `rgb(${color})`;
      context.beginPath();
      context.arc(center.x, center.y, radius * (0.92 + staggered * 0.9), 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  private drawHalo(context: CanvasRenderingContext2D, center: Vec2, radius: number, breath: number) {
    context.save();
    context.globalCompositeOperation = "screen";
    const halo = context.createRadialGradient(
      center.x,
      center.y,
      radius * 0.08,
      center.x,
      center.y,
      radius * (2.3 + breath * 0.2),
    );
    const glowAlpha = 0.1 + this.visual.openness * 0.2 - this.visual.fear * 0.055;
    const inner = this.visual.fear > 0.5
      ? `rgba(91, 137, 170, ${glowAlpha})`
      : `rgba(111, 229, 191, ${glowAlpha})`;
    halo.addColorStop(0, inner);
    halo.addColorStop(0.3, "rgba(76, 171, 159, .11)");
    halo.addColorStop(1, "rgba(4, 17, 23, 0)");
    context.fillStyle = halo;
    context.beginPath();
    context.arc(center.x, center.y, radius * 2.6, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  private drawMembranes(
    context: CanvasRenderingContext2D,
    center: Vec2,
    radius: number,
    time: number,
    energy: number,
    movementAngle: number,
    stretch: number,
  ) {
    context.save();

    this.fluidPath(context, center, radius, time, energy, 0, movementAngle, stretch);
    const body = context.createRadialGradient(
      center.x - radius * 0.34,
      center.y - radius * 0.42,
      radius * 0.03,
      center.x + radius * 0.1,
      center.y + radius * 0.12,
      radius * 1.18,
    );
    const brightness = 0.28 + this.visual.openness * 0.25 - this.visual.fear * 0.12;
    body.addColorStop(0, `rgba(191, 255, 226, ${brightness})`);
    body.addColorStop(0.28, `rgba(65, 180, 151, ${0.25 + this.visual.openness * 0.18})`);
    body.addColorStop(0.7, this.visual.fear > 0.48 ? "rgba(20, 55, 72, .8)" : "rgba(23, 104, 98, .66)");
    body.addColorStop(1, this.visual.fear > 0.48 ? "rgba(4, 19, 31, .96)" : "rgba(7, 31, 43, .9)");
    context.fillStyle = body;
    context.shadowColor = this.visual.fear > 0.48 ? "rgba(75, 125, 170, .3)" : `rgba(91, 239, 194, ${0.2 + this.visual.openness * 0.3})`;
    context.shadowBlur = radius * 0.5;
    context.fill();

    context.globalCompositeOperation = "screen";
    context.lineWidth = 1.15;
    context.strokeStyle = this.visual.fear > 0.48 ? "rgba(122, 171, 204, .34)" : `rgba(159, 246, 215, ${0.28 + this.visual.openness * 0.28})`;
    context.stroke();

    for (let layer = 1; layer <= 3; layer += 1) {
      const inset = 1 - layer * 0.12;
      this.fluidPath(
        context,
        center,
        radius * inset,
        time * (1 + layer * 0.035),
        energy,
        layer,
        movementAngle,
        stretch * 0.5,
      );
      context.lineWidth = 0.8 + layer * 0.25;
      context.strokeStyle = `rgba(139, 237, 205, ${0.16 - layer * 0.025})`;
      context.stroke();
    }

    context.restore();
  }

  private fluidPath(
    context: CanvasRenderingContext2D,
    center: Vec2,
    radius: number,
    time: number,
    energy: number,
    layer: number,
    movementAngle: number,
    stretch: number,
  ) {
    const count = 44;
    const points: Vec2[] = [];
    const agitation = 0.82 + this.visual.curiosity * 0.58 + this.visual.fear * 0.82;

    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const cellularNoise =
        Math.sin(angle * 3 + time * (0.48 + this.visual.curiosity * 0.34 + layer * 0.08) + layer * 1.7) * 0.036 +
        Math.sin(angle * 5 - time * 0.41 + layer * 0.9) * 0.019 +
        Math.cos(angle * 7 + time * 0.23) * 0.009;
      const directionalStretch = Math.cos((angle - movementAngle) * 2) * stretch;
      const pulse = Math.sin(time * 1.15 + angle * 2 + layer) * energy * 0.008;
      const contactAngle = Math.atan2(this.contactPoint.y - center.y, this.contactPoint.x - center.x);
      const contactAlignment = Math.max(0, Math.cos(angle - contactAngle));
      const localDent = -this.contactStrength * Math.pow(contactAlignment, 8) * (0.1 - layer * 0.012);
      const contactRipple = this.contactStrength * Math.sin(angle * 4 - time * 5.4) * 0.006;
      const radial = radius * (
        1 + cellularNoise * agitation + directionalStretch + pulse + localDent + contactRipple
      );
      points.push({
        x: center.x + Math.cos(angle) * radial,
        y: center.y + Math.sin(angle) * radial * (0.94 - stretch * 0.3),
      });
    }

    const midpoint = (a: Vec2, b: Vec2) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const first = midpoint(points[count - 1], points[0]);
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (let index = 0; index < count; index += 1) {
      const next = points[(index + 1) % count];
      const mid = midpoint(points[index], next);
      context.quadraticCurveTo(points[index].x, points[index].y, mid.x, mid.y);
    }
    context.closePath();
  }

  private drawInternalLife(
    context: CanvasRenderingContext2D,
    center: Vec2,
    radius: number,
    time: number,
    energy: number,
    breath: number,
    hand: HandSnapshot,
  ) {
    const handX = hand.center.x * context.canvas.clientWidth;
    const handY = hand.center.y * context.canvas.clientHeight;
    const towardHand = hand.present
      ? normalized({ x: handX - center.x, y: handY - center.y })
      : normalized({
          x: this.explorationPoint.x - center.x + Math.cos(time * 0.29) * 12,
          y: this.explorationPoint.y - center.y + Math.sin(time * 0.31) * 12,
        });
    const core = {
      x: center.x + towardHand.x * radius * 0.12 + Math.sin(time * 0.67) * radius * 0.025,
      y: center.y + towardHand.y * radius * 0.1 + Math.cos(time * 0.53) * radius * 0.02,
    };

    context.save();
    context.globalCompositeOperation = "screen";

    for (let index = 0; index < 11; index += 1) {
      const orbit = radius * (0.28 + (index % 4) * 0.105);
      const angle = time * (0.18 + (index % 3) * 0.055) * (index % 2 ? -1 : 1) + index * 2.18;
      const x = center.x + Math.cos(angle) * orbit * (0.82 + Math.sin(time * 0.3 + index) * 0.09);
      const y = center.y + Math.sin(angle) * orbit * 0.72;
      const size = radius * (0.018 + (index % 3) * 0.007);
      context.fillStyle = index % 3 === 0 ? "rgba(209, 239, 142, .28)" : "rgba(137, 244, 208, .24)";
      context.beginPath();
      context.ellipse(x, y, size * 1.6, size, angle, 0, Math.PI * 2);
      context.fill();
    }

    const coreRadius = radius * (0.19 + breath * 0.025 + energy * 0.018);
    const coreGlow = context.createRadialGradient(core.x, core.y, 0, core.x, core.y, coreRadius * 2.7);
    coreGlow.addColorStop(0, this.visual.fear > 0.5 ? "rgba(148, 190, 220, .7)" : `rgba(225, 255, 183, ${0.7 + this.visual.openness * 0.25})`);
    coreGlow.addColorStop(0.17, "rgba(158, 244, 188, .65)");
    coreGlow.addColorStop(0.48, "rgba(65, 191, 161, .18)");
    coreGlow.addColorStop(1, "rgba(30, 118, 109, 0)");
    context.fillStyle = coreGlow;
    context.beginPath();
    context.arc(core.x, core.y, coreRadius * 2.7, 0, Math.PI * 2);
    context.fill();

    this.fluidPath(context, core, coreRadius, time * 1.28, energy, 4, time * 0.2, 0.025);
    context.fillStyle = this.visual.fear > 0.5 ? "rgba(129, 172, 198, .48)" : "rgba(192, 240, 151, .5)";
    context.fill();
    context.strokeStyle = "rgba(235, 255, 218, .48)";
    context.lineWidth = 0.8;
    context.stroke();
    context.restore();
  }

  private drawFilaments(
    context: CanvasRenderingContext2D,
    center: Vec2,
    radius: number,
    time: number,
    movementAngle: number,
    stretch: number,
  ) {
    context.save();
    context.globalCompositeOperation = "screen";
    context.lineCap = "round";
    for (let index = 0; index < 7; index += 1) {
      const anchorAngle = index * (Math.PI * 2 / 7) + time * 0.035;
      const anchor = {
        x: center.x + Math.cos(anchorAngle) * radius * 0.92,
        y: center.y + Math.sin(anchorAngle) * radius * 0.87,
      };
      const driftAngle = anchorAngle + Math.sin(time * 0.37 + index) * 0.38 - stretch * Math.cos(anchorAngle - movementAngle);
      const openness = (0.58 + this.visual.openness * 0.62) * (1 - this.visual.fear * 0.58);
      const length = radius * (0.3 + (index % 3) * 0.08 + Math.sin(time * 0.43 + index) * 0.04) * openness;
      const tip = {
        x: anchor.x + Math.cos(driftAngle) * length,
        y: anchor.y + Math.sin(driftAngle) * length,
      };
      const control = {
        x: anchor.x + Math.cos(driftAngle + Math.sin(time + index) * 0.45) * length * 0.55,
        y: anchor.y + Math.sin(driftAngle + Math.sin(time + index) * 0.45) * length * 0.55,
      };
      const gradient = context.createLinearGradient(anchor.x, anchor.y, tip.x, tip.y);
      gradient.addColorStop(0, `rgba(117, 223, 190, ${0.09 + this.visual.openness * 0.2})`);
      gradient.addColorStop(1, "rgba(117, 223, 190, 0)");
      context.strokeStyle = gradient;
      context.lineWidth = 0.7 + (index % 2) * 0.35;
      context.beginPath();
      context.moveTo(anchor.x, anchor.y);
      context.quadraticCurveTo(control.x, control.y, tip.x, tip.y);
      context.stroke();
    }
    context.restore();
  }

  private drawFieldParticles(
    context: CanvasRenderingContext2D,
    center: Vec2,
    radius: number,
    time: number,
    energy: number,
    hand: HandSnapshot,
  ) {
    context.save();
    context.globalCompositeOperation = "screen";
    for (let index = 0; index < 36; index += 1) {
      const cycle = (time * (0.026 + this.visual.curiosity * 0.025 + (index % 5) * 0.006) + index * 0.137) % 1;
      const feedingCycle = this.activity === "feeding" ? 1 - cycle : cycle;
      const orbit = radius * (this.activity === "feeding" ? 0.32 + feedingCycle * 1.85 : 1.05 + cycle * 1.1);
      const angle = index * 2.399 + time * (index % 2 ? 0.11 : -0.08);
      const attraction = hand.present ? (1 - cycle) * 0.12 : (1 - cycle) * 0.025 * this.visual.curiosity;
      const targetX = hand.present ? hand.center.x * context.canvas.clientWidth : this.explorationPoint.x;
      const targetY = hand.present ? hand.center.y * context.canvas.clientHeight : this.explorationPoint.y;
      const x = center.x + Math.cos(angle) * orbit + (targetX - center.x) * attraction;
      const y = center.y + Math.sin(angle) * orbit * 0.74 + (targetY - center.y) * attraction;
      const alpha = Math.sin(cycle * Math.PI) * (0.06 + energy * 0.1 + this.visual.curiosity * 0.08) * (this.activity === "dreaming" ? 0.42 : 1);
      context.globalAlpha = alpha;
      context.fillStyle = index % 4 === 0 ? "#d8f5a9" : "#8cebd1";
      context.beginPath();
      context.arc(x, y, 0.45 + (index % 3) * 0.42, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  private drawRitual(
    context: CanvasRenderingContext2D,
    center: Vec2,
    radius: number,
    time: number,
  ) {
    if (
      this.ritualPhase !== "inviting" &&
      this.ritualPhase !== "synchronizing" &&
      this.ritualPhase !== "success"
    ) return;

    const pulse = (Math.sin(time * Math.PI * 1.55) + 1) * 0.5;
    const success = this.ritualPhase === "success";
    const intensity = success ? 1 : 0.38 + this.ritualProgress * 0.52;
    context.save();
    context.globalCompositeOperation = "screen";

    for (let ring = 0; ring < 3; ring += 1) {
      const phase = (pulse + ring / 3) % 1;
      const ringRadius = radius * (1.08 + phase * (success ? 1.55 : 0.68));
      context.globalAlpha = (1 - phase) * 0.22 * intensity;
      context.strokeStyle = success ? "#e4ffb8" : "#9af1d2";
      context.lineWidth = 0.8 + (1 - phase) * 1.1;
      context.beginPath();
      context.arc(center.x, center.y, ringRadius, 0, Math.PI * 2);
      context.stroke();
    }

    const motes = success ? 18 : 10;
    for (let index = 0; index < motes; index += 1) {
      const angle = index * (Math.PI * 2 / motes) + time * 0.16;
      const orbit = radius * (1.16 + this.ritualProgress * 0.34 + Math.sin(time * 1.2 + index) * 0.04);
      context.globalAlpha = (0.22 + pulse * 0.36) * intensity;
      context.fillStyle = index % 3 === 0 ? "#efffc8" : "#a8f3d7";
      context.beginPath();
      context.arc(
        center.x + Math.cos(angle) * orbit,
        center.y + Math.sin(angle) * orbit * 0.78,
        0.8 + (index % 2) * 0.7,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    context.restore();
  }

  private drawAtmosphere(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    time: number,
    center: Vec2,
    radius: number,
    hand: HandSnapshot,
  ) {
    context.clearRect(0, 0, width, height);
    const wash = context.createRadialGradient(center.x, center.y, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.78);
    wash.addColorStop(0, "#0a2428");
    wash.addColorStop(0.42, "#07171e");
    wash.addColorStop(1, "#02070b");
    context.fillStyle = wash;
    context.fillRect(0, 0, width, height);

    const handX = hand.center.x * width;
    const handY = hand.center.y * height;
    for (let index = 0; index < 40; index += 1) {
      const baseX = ((index * 193.7 + Math.sin(index * 4.1) * 47) % width + width) % width;
      const baseY = ((index * 89.3 + time * (2 + (index % 4) * 0.8)) % height + height) % height;
      const pull = hand.present ? 0.018 * Math.sin(time * 0.7 + index) : 0;
      const x = baseX + (handX - baseX) * pull;
      const y = baseY + (handY - baseY) * pull;
      const distance = Math.hypot(x - center.x, y - center.y);
      context.globalAlpha = (0.08 + (index % 5) * 0.025) * clamp(distance / (radius * 1.4), 0.2, 1);
      context.fillStyle = index % 6 === 0 ? "#d9efad" : "#a6ddcf";
      context.beginPath();
      context.arc(x, y, 0.45 + (index % 3) * 0.38, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  private releaseSparks(point: Vec2) {
    for (let index = 0; index < 14; index += 1) {
      this.sparks.push({
        x: point.x,
        y: point.y,
        angle: (index / 14) * Math.PI * 2 + Math.random() * 0.25,
        life: 0.8 + Math.random() * 0.35,
        speed: 48 + Math.random() * 42,
      });
    }
  }

  private drawSparks(context: CanvasRenderingContext2D) {
    context.save();
    context.globalCompositeOperation = "screen";
    for (const spark of this.sparks) {
      const age = 1.15 - spark.life;
      const travel = Math.max(0, age) * spark.speed;
      const x = spark.x + Math.cos(spark.angle) * travel;
      const y = spark.y + Math.sin(spark.angle) * travel;
      context.globalAlpha = Math.sin(clamp(spark.life, 0, 1) * Math.PI * 0.5) * 0.85;
      context.fillStyle = "#dfffc0";
      context.beginPath();
      context.arc(x, y, 0.8 + spark.life * 1.7, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

function normalized(vector: Vec2): Vec2 {
  const length = Math.max(0.001, Math.hypot(vector.x, vector.y));
  return { x: vector.x / length, y: vector.y / length };
}

function damp(current: number, target: number, rate: number, deltaSeconds: number) {
  return current + (target - current) * (1 - Math.exp(-rate * deltaSeconds));
}

function distanceBetween(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
