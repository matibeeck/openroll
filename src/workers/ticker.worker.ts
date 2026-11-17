/// <reference lib="webworker" />
/**
 * Steady clock for real-time export. Timers in dedicated workers keep running when the tab is
 * hidden, unlike requestAnimationFrame (paused) and main-thread timers (throttled to 1 Hz).
 */
let id: ReturnType<typeof setInterval> | null = null;
self.onmessage = (e: MessageEvent<{ cmd: 'start'; intervalMs: number } | { cmd: 'stop' }>) => {
  if (id !== null) clearInterval(id);
  id = null;
  if (e.data.cmd === 'start') id = setInterval(() => self.postMessage(0), e.data.intervalMs);
};
