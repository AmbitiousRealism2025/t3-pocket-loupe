// Starts and never answers detail requests.
import { leakyState, stayAlive, write } from "./fake-collector.mjs";
write(leakyState());
process.stdin.resume();
stayAlive();
