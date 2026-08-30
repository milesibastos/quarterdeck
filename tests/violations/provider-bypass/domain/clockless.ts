// Plants: the wall clock reached for directly instead of taken as a dependency.
export const isStale = (at: string) => Date.now() - Date.parse(at) > 60_000;
