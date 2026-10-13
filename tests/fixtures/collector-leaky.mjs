// A well-behaved collector whose state and details carry fields that must never reach the phone.
import { answerDetails, leakyState, stayAlive, write } from "./fake-collector.mjs";
write(leakyState());
setInterval(() => write(leakyState()), 1000);
answerDetails();
stayAlive();
