// Writes an oversized line in several chunks with pauses (so the reader sees it across
// many `data` events), then a normal state.
import { leakyState, stayAlive, write } from "./fake-collector.mjs";
const line = JSON.stringify({ ...leakyState(), padding: "p".repeat(200 * 1024), marker: "oversize" });
const parts = 8;
const size = Math.ceil(line.length / parts);
let i = 0;
const next = () => {
  if (i < parts) {
    process.stdout.write(line.slice(i * size, (i + 1) * size));
    i++;
    setTimeout(next, 30);
  } else {
    process.stdout.write("\n");
    write(leakyState({ marker: "normal" }));
  }
};
next();
stayAlive();
