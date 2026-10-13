// Reports an error with private detail text on stderr, then keeps running.
import { HOME, leakyState, stayAlive, write } from "./fake-collector.mjs";
process.stderr.write(JSON.stringify({ error: "config_invalid", detail: "PRIVATE-DETAIL " + HOME + ".config" }) + "\n");
process.stderr.write("free text PRIVATE-DETAIL that is not JSON\n");
write(leakyState());
stayAlive();
