// Emits one state, then dies.
import { leakyState, write } from "./fake-collector.mjs";
write(leakyState());
setTimeout(() => process.exit(1), 20);
