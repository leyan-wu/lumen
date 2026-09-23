export class LumenRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function requestJson<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(22_000)]),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
      ? result.error : "Request failed";
    throw new LumenRequestError(response.status, message);
  }
  if (result === null) throw new Error("Invalid server response");
  return result as T;
}

export function requestErrorMessage(error: unknown, chinese: boolean) {
  const status = error instanceof LumenRequestError ? error.status : 0;
  if (status === 402 || status === 503) return chinese
    ? "语音服务暂时不可用。你仍然可以用手陪伴 Lumen。"
    : "Voice is unavailable for now. You can still spend time with Lumen using your hand.";
  if (status === 429) return chinese ? "稍等片刻，再试一次。" : "Please wait a moment before trying again.";
  if (status === 400) return chinese ? "这段录音无法读取，请再试一次。" : "This recording could not be read. Please try again.";
  return chinese ? "这次没有听清或连接中断了，请再说一次。" : "That turn did not come through. Please try again.";
}
