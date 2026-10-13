// Speaks a future protocol version.
import { leakyState, stayAlive, write } from "./fake-collector.mjs";
write({ ...leakyState(), v: 2 });
stayAlive();
