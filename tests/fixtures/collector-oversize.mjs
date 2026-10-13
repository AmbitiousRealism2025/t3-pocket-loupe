// Emits a line over the bridge's cap (set to 64 KiB by the test), then a normal state.
import { leakyState, stayAlive, write } from "./fake-collector.mjs";
write({ ...leakyState(), padding: "p".repeat(200 * 1024), marker: "oversize" });
write(leakyState({ marker: "normal" }));
stayAlive();
