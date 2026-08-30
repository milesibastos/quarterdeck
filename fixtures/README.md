# Fixture fleets

Every fleet in here is invented. The project names, worker ids and paths do not
correspond to anything real, and never may: this repository is public and the
tool it holds reads a private fleet. Test material has been synthetic since the
first commit so that nobody ever has to decide, later and in a hurry, whether a
particular sample is safe to publish.

`npm test` asserts this: a leak guard greps every tracked file, plus every
uncommitted file that is not gitignored, for home directories, absolute
machine paths and real operator identifiers.

Which set the panel reads is a config value, not a code change:

```sh
QUARTERDECK_FIXTURE_SET=stale npm start
```

| Set | What it exercises |
| --- | --- |
| `healthy` | Several workers across every state the panel renders. |
| `empty` | A clean read that reports nothing running - the definitive empty state, not a blank area. |
| `stale` | A valid snapshot generated long ago. Renders, marked stale. |
| `mismatched` | A schema identifier this build does not understand. The loud typed refusal. |
| `malformed` | A truncated snapshot. Falls back to last-known-good when there is one. |

`generatedAt` in `healthy` and `empty` sits far enough in the future that those
sets never drift into looking stale as the repository ages. `stale` is fixed in
the past on purpose.
