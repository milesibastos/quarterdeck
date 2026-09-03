package fleet

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("reading fixture: %v", err)
	}
	return raw
}

// The fixture carries a top-level key and per-task keys this build has never
// heard of. An upstream that adds a field must not break a reader that does
// not want it, which is the whole reason nothing here is decoded strictly.
func TestParseIgnoresUnknownFields(t *testing.T) {
	snapshot, err := Parse(readFixture(t, "snapshot.json"), "fixture")
	if err != nil {
		t.Fatalf("parsing a snapshot with added fields: %v", err)
	}
	if snapshot.Schema != SchemaID {
		t.Errorf("schema = %q, want %q", snapshot.Schema, SchemaID)
	}
	if len(snapshot.Tasks) != 6 {
		t.Fatalf("tasks = %d, want 6", len(snapshot.Tasks))
	}
	first := snapshot.Tasks[0]
	if first.ID != "demo-alpha-a1" || first.Backlog.Title != "Draw the lifecycle rail" {
		t.Errorf("first task = %+v", first)
	}
	if first.Paths.Worktree.Path != "/opt/worktrees/demo-alpha-a1" || !first.Paths.Worktree.Present {
		t.Errorf("first worktree = %+v", first.Paths.Worktree)
	}
}

func TestParseRefusesAnotherSchema(t *testing.T) {
	_, err := Parse(readFixture(t, "mismatched.json"), "fixture")
	if err == nil {
		t.Fatal("a snapshot announcing another schema was accepted")
	}
	if !strings.Contains(err.Error(), SchemaID) || !strings.Contains(err.Error(), "fm-fleet-snapshot.v2") {
		t.Errorf("refusal names neither identifier: %v", err)
	}
}

func TestParseRefusesRubbish(t *testing.T) {
	if _, err := Parse([]byte("{ not json"), "fixture"); err == nil {
		t.Fatal("unparseable bytes were accepted")
	}
}

// A missing schema is the shape a half-written file has, and it is refused for
// the same reason a changed one is: nothing downstream re-checks it.
func TestParseRefusesNoSchema(t *testing.T) {
	if _, err := Parse([]byte(`{"tasks":[]}`), "fixture"); err == nil {
		t.Fatal("a snapshot with no schema identifier was accepted")
	}
}

// A fleet home whose snapshot command never answers.
//
// Built in a temporary directory rather than committed, because a fixture that
// sleeps is a fixture every other reader has to know to avoid.
func slowHome(t *testing.T, seconds string) string {
	t.Helper()
	home := t.TempDir()
	if err := os.MkdirAll(home+"/bin", 0o755); err != nil {
		t.Fatalf("making the home: %v", err)
	}
	script := "#!/bin/sh\nsleep " + seconds + "\n"
	if err := os.WriteFile(home+"/bin/fm-fleet-snapshot.sh", []byte(script), 0o755); err != nil {
		t.Fatalf("writing the command: %v", err)
	}
	return home
}

// The budget is what stops one slow fleet from wedging the list: without it a
// read that never finishes leaves the refresh in flight for ever, and every
// later tick declines to start another.
func TestAReadThatOutrunsItsBudget(t *testing.T) {
	source := SourceFor(Config{
		Home:        slowHome(t, "30"),
		Label:       "slow",
		ReadTimeout: 50 * time.Millisecond,
	})
	started := time.Now()
	_, err := source.Read(context.Background())
	if err == nil {
		t.Fatal("a read that never answered was accepted")
	}
	if !strings.Contains(err.Error(), "did not answer within") {
		t.Errorf("a timeout was reported as something else: %v", err)
	}
	// Says which fleet, like every other refusal here.
	if !strings.Contains(err.Error(), "fleet:slow") {
		t.Errorf("the refusal does not name the source: %v", err)
	}
	if waited := time.Since(started); waited > 5*time.Second {
		t.Errorf("the read waited %v, well past its budget", waited)
	}
}

// A home that answers is read as itself, budget or no budget.
func TestAFleetHomeIsReadThroughItsCommand(t *testing.T) {
	home := t.TempDir()
	if err := os.MkdirAll(home+"/bin", 0o755); err != nil {
		t.Fatalf("making the home: %v", err)
	}
	// Echoes the fleet home it was told to report on, which is how upstream is
	// asked, and a snapshot this build accepts.
	script := "#!/bin/sh\nprintf '{\"schema\":\"%s\",\"generated\":\"%s\",\"tasks\":[]}' \"$FM_HOME_SCHEMA\" \"$FM_HOME\"\n"
	if err := os.WriteFile(home+"/bin/fm-fleet-snapshot.sh", []byte(script), 0o755); err != nil {
		t.Fatalf("writing the command: %v", err)
	}
	t.Setenv("FM_HOME_SCHEMA", SchemaID)

	snapshot, err := SourceFor(Config{Home: home, Label: "quick", ReadTimeout: 5 * time.Second}).Read(context.Background())
	if err != nil {
		t.Fatalf("reading: %v", err)
	}
	if snapshot.Generated != home {
		t.Errorf("the command was not told which home to report on: %q", snapshot.Generated)
	}
}
