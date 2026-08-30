// Plants: a write API called through bracket-notation member access.
import * as fs from "node:fs";

export const save = (text: string) => fs["writeFileSync"]("out.json", text);
