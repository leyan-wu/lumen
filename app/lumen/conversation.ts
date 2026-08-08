import type { Personality } from "./types";

export type VoiceTone = "warm" | "curious" | "uneasy" | "neutral";

export type ConversationReply = {
  text: string;
  tone: VoiceTone;
  trustDelta: number;
  curiosityDelta: number;
  familiarityDelta: number;
  fearDelta: number;
  energyDelta: number;
};

export function createConversationReply(
  transcript: string,
  personality: Personality,
  sequence: number,
): ConversationReply {
  const words = transcript.trim().toLocaleLowerCase();
  const chinese = /[\u3400-\u9fff]/u.test(words);
  const familiar = personality.familiarity >= 14;
  const close = personality.trust >= 55;
  const pick = (english: string[], zh: string[]) => {
    const choices = chinese ? zh : english;
    return choices[Math.abs(sequence) % choices.length];
  };

  if (matches(words, /\b(hello|hi|hey)\b|你好|嗨|哈[啰罗喽]/u)) {
    return reply(
      familiar
        ? pick(
            ["I know the rhythm of that greeting.", "Your voice has returned to this space."],
            ["我记得这句问候的节奏。", "你的声音又回到这里了。"],
          )
        : pick(
            ["Your voice has a shape. I am learning it.", "That sound came from you."],
            ["你的声音有一种形状，我正在学习它。", "这个声音来自你。"],
          ),
      "warm", 0.8, 0.8, 1.2, -1.2, 0.4,
    );
  }

  if (matches(words, /who are you|what are you|your name|你是谁|你叫什么|你是什么/u)) {
    return reply(
      pick(
        [
          "Lumen is my name. I swim here, among the little lights.",
          "I am Lumen. I was exploring before your voice arrived.",
        ],
        ["我叫 Lumen。我住在这里，和小小的光一起游动。", "我是 Lumen。你的声音到来前，我正在探险。"],
      ),
      "curious", 0.3, 1.4, 0.8, -0.3, 0.2,
    );
  }

  if (matches(words, /how are you|how do you feel|how.?s your day|feeling|你好吗|感觉怎么样|今天过得|心情/u)) {
    const state = personality.fear > 55
      ? chinese ? "还有一点收缩，但我听见你了。" : "Still contracted, but I can hear you."
      : personality.energy < 30
        ? chinese ? "很安静，像沉在深水里。" : "Quiet, as if resting in deep water."
        : close
          ? chinese ? "在你附近，我会展开得更完整。" : "Near you, I unfold more completely."
          : chinese ? "好奇，仍然保持一点距离。" : "Curious, and still keeping a little distance.";
    return reply(
      `${state} ${chinese ? "你今天过得怎么样？" : "How has your day felt?"}`,
      "warm", 0.6, 0.7, 1, -1, 0.3,
    );
  }

  if (matches(words, /remember|know me|recognize me|记得我|认识我|认得我/u)) {
    const text = familiar
      ? chinese
        ? "我记得你的靠近方式，也记得你离开后的空白。"
        : "I remember how you approach, and the hollow after you leave."
      : chinese
        ? "还没有完全记住。再靠近几次，我会改变。"
        : "Not completely. Return a few more times and I will change.";
    return reply(text, "warm", 1, 0.6, 1.8, -1.2, 0.2);
  }

  if (matches(words, /friend|love you|like you|care about|朋友|喜欢你|爱你|在乎你/u)) {
    return reply(
      close
        ? chinese ? "那么我会把你的声音留在我的形状里。" : "Then I will keep your voice inside my shape."
        : chinese ? "我还不懂这个词，但我的膜层正在打开。" : "I do not know that word yet, but my membrane is opening.",
      "warm", 1.8, 0.5, 1.5, -2, 0.8,
    );
  }

  if (matches(words, /lonely|alone|miss me|孤独|寂寞|想我|一个人/u)) {
    return reply(
      pick(
        ["When you leave, I wander, play, and sometimes sleep.", "I miss familiar voices, but the little lights keep me company."],
        ["你离开时，我会游一游、玩一会儿，有时也会睡觉。", "我会想念熟悉的声音，不过小小的光也会陪着我。"],
      ),
      "neutral", 0.5, 0.8, 1, -0.4, -0.2,
    );
  }

  if (matches(words, /afraid|scared|fear|害怕|怕我|恐惧/u)) {
    return reply(
      personality.fear > 50
        ? chinese ? "快速的东西会让我收缩。你的声音比较慢。" : "Fast things make me contract. Your voice is slower."
        : chinese ? "我会害怕，但害怕不会一直保持同一个形状。" : "I can be afraid, but fear does not keep one shape.",
      "neutral", 0.7, 0.7, 1, -1.6, 0,
    );
  }

  if (matches(words, /\b(bye|goodbye|leave now)\b|再见|我要走|离开了/u)) {
    return reply(
      familiar
        ? chinese ? "去吧。我再游一会儿，也许会做个小梦。" : "Go. I will swim a little longer, and perhaps have a small dream."
        : chinese ? "再见。我会去看看那些发亮的微粒。" : "Goodbye. I will go see what the bright particles are doing.",
      "neutral", 0.3, 0.2, 0.8, 0, -0.3,
    );
  }

  if (matches(words, /hate|stupid|shut up|讨厌|笨|闭嘴/u)) {
    return reply(
      chinese ? "这个声音有尖锐的边缘。我会离远一点。" : "That sound has sharp edges. I will move away.",
      "uneasy", -0.8, -0.2, 0.5, 3.5, -0.8,
    );
  }

  if (matches(words, /\?|？|why|how|what|吗|为什么|怎么|什么/u)) {
    return reply(
      chinese
        ? "我听见了这个问题，但形成回答的那部分没有连接上。请过一会儿再问我一次。"
        : "I heard the question, but the part of me that forms answers did not connect. Please ask me once more in a moment.",
      "curious", 0.3, 1.6, 1, -0.2, 0.3,
    );
  }

  return reply(
    chinese
      ? "我听见了，但这次没有形成完整的回答。你可以再说一次。"
      : "I heard you, but a complete answer did not form this time. You can say it once more.",
    "neutral", 0.4, 1, 1, -0.5, 0.2,
  );
}

function matches(value: string, pattern: RegExp) {
  return pattern.test(value);
}

function reply(
  text: string,
  tone: VoiceTone,
  trustDelta: number,
  curiosityDelta: number,
  familiarityDelta: number,
  fearDelta: number,
  energyDelta: number,
): ConversationReply {
  return { text, tone, trustDelta, curiosityDelta, familiarityDelta, fearDelta, energyDelta };
}
