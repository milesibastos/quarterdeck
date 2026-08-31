// quarterdeck:permitted-writer
// Plants: the permitted writer reaching for child_process. The exemption at
// this path lifts the fs-write ban, not the spawn ban.
import { execFile } from "node:child_process";

export const intent = "the one permitted writer";
export const run = () => execFile("echo", [], () => {});
