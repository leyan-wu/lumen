// Memory is optional: blocked storage must never interrupt an encounter.
export function readMemory(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeMemory(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Keep this visit in memory. */ }
}
