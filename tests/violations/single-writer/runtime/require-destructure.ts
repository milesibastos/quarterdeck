// Plants: a write API destructured off a require() call.
const { writeFile } = require("node:fs/promises");

export const save = (text: string) => writeFile("out.json", text);
