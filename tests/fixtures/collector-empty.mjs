// A paired machine with nothing running: the "Nothing running" state (demo data).
import { stayAlive, write } from "./fake-collector.mjs";
const state = () => {
  const now = Date.now();
  return {
    v: 1, type: "state", at: now, known: true, counts: { active: 0, busy: 0, attention: 0, input: 0, review: 0 },
    environments: [{ id: "demo-laptop", label: "laptop", hostLabel: "laptop", state: "live", stale: false, url: "", serverVersion: "demo",
      lastLiveAt: now, sessionExpiresAt: now + 20 * 86400_000, retryAt: null, counts: { active: 0, busy: 0, attention: 0, input: 0, review: 0 }, providers: [] }],
    rows: [],
  };
};
write(state());
setInterval(() => write(state()), 5000);
process.stdin.resume();
stayAlive();
