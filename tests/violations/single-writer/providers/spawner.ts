// Plants: a second file in providers/ reaching for child_process. The spawn
// door is one named file, not the whole providers directory.
import { execFile } from "node:child_process";

export const run = (command: string) => execFile(command, [], () => {});
