/**
 * What the panel shows instead of a fleet when the snapshot announces a schema
 * this build does not understand.
 *
 * Deliberately not a small warning strip. A changed contract means every field
 * on the page is suspect, so the panel shows nothing else - a plausible-looking
 * fleet drawn from fields whose meaning has shifted is the exact failure the
 * pinned identifier exists to prevent.
 */
export function ContractRefusal({
  expected,
  found,
  source,
}: {
  expected: string;
  found: string;
  source: string;
}) {
  return (
    // The page does not scroll at `md` and up; this is a page of its own
    // inside that frame, so it takes the height and scrolls itself.
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-10 sm:px-6">
      <h1 className="text-base font-semibold tracking-tight text-danger">
        Snapshot refused
      </h1>
      <p className="text-sm text-foreground">
        The fleet snapshot announced a schema this build of Quarterdeck does not
        understand. Nothing is rendered from it, on purpose.
      </p>
      {/* Every value here is upstream's own, quoted as found, and nothing
          promises a short one - so each wraps anywhere rather than pushing the
          column, and with it the page, sideways. */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 font-mono text-sm">
        <dt className="text-muted-foreground">expected</dt>
        <dd className="min-w-0 wrap-anywhere text-foreground">{expected}</dd>
        <dt className="text-muted-foreground">found</dt>
        <dd className="min-w-0 wrap-anywhere text-foreground">{found}</dd>
        <dt className="text-muted-foreground">source</dt>
        <dd className="min-w-0 wrap-anywhere text-foreground">{source}</dd>
      </dl>
      <p className="text-sm text-muted-foreground">
        Update <code className="font-mono">SNAPSHOT_SCHEMA_ID</code> and the
        parser in <code className="font-mono">src/adapters/contract.ts</code> to
        match the new shape, then record the change in{" "}
        <code className="font-mono">docs/contract.md</code>.
      </p>
    </main>
  );
}
