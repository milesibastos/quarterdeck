// Plants: the projection doing its own I/O.
import { readFileSync } from "node:fs";

export const raw = () => readFileSync("snapshot.json", "utf8");
