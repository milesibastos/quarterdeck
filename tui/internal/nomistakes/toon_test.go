package nomistakes

import "testing"

// What `no-mistakes axi status` prints today: two scalars, a count, and one
// tabular block whose values are quoted where they carry a separator.
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
