// Plants: the identifier pinned but never compared.
export const SNAPSHOT_SCHEMA_ID = "fm-fleet-snapshot.v1";

export function parseSnapshot(raw: string) {
  return JSON.parse(raw);
}
