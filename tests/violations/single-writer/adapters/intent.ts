// quarterdeck:permitted-writer
// Plants: the permitted writer reaching for child_process and process.chdir.
// The exemption at this path lifts the fs-write ban, not the spawn ban or the
// working-directory ban.
import { execFile } from "node:child_process";

export const intent = "the one permitted writer";
export const run = () => execFile("echo", [], () => {});
export const move = () => process.chdir("/tmp");
