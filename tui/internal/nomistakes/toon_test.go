package nomistakes

import "testing"

// The overview `no-mistakes axi status` falls back to when it has no current
// run to describe: two scalars, a count, and one tabular block whose values
// are quoted where they carry a separator. Checked on 2026-09-04 against
// v1.64.0.
const listing = `current_branch: fm/demo-alpha-a1
runs_on_current_branch: 2
count: 4 of 45 total
runs[4]{id,branch,status,head,pr}:
  "01M1J02SQYXYN3QZ76ZH7ZCR1V",fm/demo-alpha-a1,completed,6d33e0f8,"https://forge.example/demo/pull/42"
  "01M1FH96NFS0GSS9P9T183WT38",fm/demo-alpha-a10,completed,9ca20d1e,"https://forge.example/demo/pull/41"
  "01M1F9WA5Q7G2T21DACY1R5Y12",fm/demo-alpha-a1,cancelled,a1c9e535,
  "01M1F53D2SRS55FQK8A5G9CCP5",fm/demo-beacon-b2,running,4347b6c8,
help[1]: "Run ` + "`no-mistakes axi run`" + ` to validate the current branch"
`

func TestParseStatusReadsTheScalarsAndTheTable(t *testing.T) {
	status := ParseStatus(listing)
	if status.CurrentBranch != "fm/demo-alpha-a1" {
		t.Errorf("current branch = %q", status.CurrentBranch)
	}
	if !status.CountedRuns || status.RunsOnCurrentBranch != 2 {
		t.Errorf("count = %d, counted = %v", status.RunsOnCurrentBranch, status.CountedRuns)
	}
	if len(status.Runs) != 4 {
		t.Fatalf("runs = %d, want 4", len(status.Runs))
	}
	first := status.Runs[0]
	if first.ID != "01M1J02SQYXYN3QZ76ZH7ZCR1V" || first.Branch != "fm/demo-alpha-a1" || first.Status != "completed" {
		t.Errorf("first run = %+v", first)
	}
}

// The columns are read by name, so a release that reorders them or adds one
// is read the same way. A table this program knows nothing about is skipped,
// and a table of runs under another name is still runs.
func TestParseStatusReadsColumnsByName(t *testing.T) {
	status := ParseStatus(`current_branch: fm/demo-alpha-a1
active[1]{step,state}:
  review,waiting
branch_runs[1]{status,head,branch,id,started}:
  running,4347b6c8,fm/demo-alpha-a1,01M1F53D2SRS55FQK8A5G9CCP5,2099-01-01
`)
	if len(status.Runs) != 1 {
		t.Fatalf("runs = %+v", status.Runs)
	}
	if status.Runs[0].ID != "01M1F53D2SRS55FQK8A5G9CCP5" || status.Runs[0].Branch != "fm/demo-alpha-a1" {
		t.Errorf("run = %+v", status.Runs[0])
	}
}

// A row that does not carry both a run and its branch says nothing this
// program can act on, so it contributes nothing rather than half a run.
func TestParseStatusSkipsRowsItCannotRead(t *testing.T) {
	status := ParseStatus(`runs[2]{id,branch}:
  01ABC,
  ,fm/demo-alpha-a1
`)
	if len(status.Runs) != 0 {
		t.Errorf("runs = %+v, want none", status.Runs)
	}
}

// The declared row count is the bound, so prose following a table is never
// read as another run.
func TestParseStatusStopsAtTheDeclaredCount(t *testing.T) {
	status := ParseStatus(`runs[1]{id,branch}:
  01ABC,fm/demo-alpha-a1
  01DEF,fm/demo-alpha-a10
`)
	if len(status.Runs) != 1 || status.Runs[0].ID != "01ABC" {
		t.Errorf("runs = %+v", status.Runs)
	}
}

func TestParseStatusOfNothing(t *testing.T) {
	status := ParseStatus("")
	if len(status.Runs) != 0 || status.CountedRuns {
		t.Errorf("status = %+v", status)
	}
}

// What `no-mistakes axi status` prints when the branch it is standing on has a
// run: one nested `run:` object, whose useful fields are indented beneath it.
// Checked on 2026-09-04 against v1.64.0.
//
// The traps are deliberate. `head` and `findings` are fields this program has
// no use for; `steps[...]` is a table nested inside the object, which must not
// be read as a table of runs; and `branch_sync` carries a second, deeper
// `branch:` that names another branch entirely.
const detailed = `run:
  id: "01M1PCQKPF2T5N3MN7MJX618Y5"
  branch: fm/demo-alpha-a1
  status: running
  head: fd5daca0
  findings: none
  steps[3]{step,status,findings,duration_ms}:
    review,completed,none,1200
    tests,running,none,
    docs,pending,none,
branch_sync:
  local:
    branch: fm/demo-alpha-a10
    head: fd5daca0
help[1]: "Run ` + "`no-mistakes axi respond`" + ` to answer the gate"
`

// The overview `axi status` falls back to in a worktree that is no longer on a
// branch: no current run to detail, so the bounded table again - and the run
// this program wants is in it. There is no branch to count runs on, so no count
// either. Checked on 2026-09-04 against v1.64.0.
const detached = `current_branch: unknown
count: 2 of 47 total
runs[2]{id,branch,status,head,pr}:
  "01M1PCQKPF2T5N3MN7MJX618Y5",fm/demo-alpha-a1,completed,35bfd0e5,"https://forge.example/demo/pull/44"
  "01M1MNZXFWN3QPPCW34T8N11BW",fm/demo-beacon-b2,completed,50a1c921,
`

// The shape production actually asks for. Read wrong, a live run reads as no
// run at all, which is the one answer that must never be invented.
func TestParseStatusReadsTheNestedRun(t *testing.T) {
	status := ParseStatus(detailed)
	if !status.Detailed {
		t.Fatal("the nested run object was not recognised")
	}
	want := Run{ID: "01M1PCQKPF2T5N3MN7MJX618Y5", Branch: "fm/demo-alpha-a1", Status: "running"}
	if status.Current != want {
		t.Errorf("current run = %+v, want %+v", status.Current, want)
	}
	// The table nested inside the object describes steps, not runs, and the
	// deeper branch under branch_sync belongs to another branch.
	if len(status.Runs) != 0 {
		t.Errorf("runs = %+v, want none", status.Runs)
	}
	if status.CurrentBranch != "" || status.CountedRuns {
		t.Errorf("a nested field was read as a top-level scalar: %+v", status)
	}
}

// An object that arrived without the two fields the join needs is not the same
// fact as a branch with no run, so the parser keeps the difference: the shape
// was understood and its answer was incomplete.
func TestParseStatusKeepsAnIncompleteNestedRun(t *testing.T) {
	for name, out := range map[string]string{
		"no id":     "run:\n  branch: fm/demo-alpha-a1\n  status: running\n",
		"no branch": "run:\n  id: \"01M1J02SQYXYN3QZ76ZH7ZCR1V\"\n  status: running\n",
	} {
		status := ParseStatus(out)
		if !status.Detailed {
			t.Errorf("%s: the object was not recognised at all", name)
		}
		if status.Current.Status != "running" {
			t.Errorf("%s: the object was recognised but not read: %+v", name, status.Current)
		}
		if status.Current.ID != "" && status.Current.Branch != "" {
			t.Errorf("%s: a field was invented: %+v", name, status.Current)
		}
	}
}
