// [pure] Watch-loop timing: adaptive frame rate and rolling performance stats.

// Milliseconds to wait before the next tick. Drops to idleFps after idleAfterSec with no faces.
export function nextDelay({ now, lastFaceAt, elapsedMs, processFps, idleFps, idleAfterSec }) {
  const idle = now - lastFaceAt > idleAfterSec * 1000;
  const interval = 1000 / (idle ? idleFps : processFps);
  return { delay: Math.max(0, interval - elapsedMs), idle };
}

// Rolling window of tick timings. fps = achieved ticks/second over the window.
export function createStats(windowSize = 20) {
  const ticks = []; // { at, ms }
  return {
    record(at, ms) {
      ticks.push({ at, ms });
      if (ticks.length > windowSize) ticks.shift();
    },
    get detectMs() {
      return ticks.length ? ticks.reduce((sum, t) => sum + t.ms, 0) / ticks.length : 0;
    },
    get fps() {
      if (ticks.length < 2) return 0;
      const span = ticks[ticks.length - 1].at - ticks[0].at;
      return span > 0 ? ((ticks.length - 1) * 1000) / span : 0;
    },
    reset() {
      ticks.length = 0;
    },
  };
}
