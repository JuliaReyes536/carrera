export function formatTime(ms: number) {
  const t = Math.max(0, Math.floor(ms));
  const pad = (n: number, size = 2) => String(n).padStart(size, "0");
  return `${pad(Math.floor(t / 3600000))}:${pad(Math.floor(t / 60000) % 60)}:${pad(Math.floor(t / 1000) % 60)}.${pad(t % 1000, 3)}`;
}
export function formatPace(ms: number | null) {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min/km`;
}
