// Plants: a write API destructured off a default-imported module alias.
import fsp from "node:fs/promises";

const { writeFile } = fsp;

export const save = (text: string) => writeFile("out.json", text);
