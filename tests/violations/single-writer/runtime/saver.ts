// Plants: a second file that can mutate the filesystem.
import { writeFile } from "node:fs/promises";

export const save = (text: string) => writeFile("out.json", text);
