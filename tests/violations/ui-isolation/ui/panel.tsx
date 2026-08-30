// Plants: a component reading the fleet instead of the document.
import { readSnapshot } from "../adapters/contract.ts";

export const Panel = () => String(readSnapshot);
