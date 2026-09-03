package fleet

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// SchemaID is the snapshot shape this build understands, pinned. When upstream
// ships a new one it changes this string, and the panel then refuses instead of
// reading fields that have quietly changed meaning. The web panel pins the same
// identifier in `src/adapters/contract.ts`.
const SchemaID = "fm-fleet-snapshot.v1"

// snapshotCommand is the command a fleet home publishes its snapshot through,
// relative to the home. Read-only by upstream's own contract: it takes no lock,
// drains nothing and writes nothing, which is the whole reason a reader is
// allowed to run it.
const snapshotCommand = "bin/fm-fleet-snapshot.sh"

// snapshotArgs asks for the structured surface rather than the human one.
var snapshotArgs = []string{"--json"}

// Snapshot is the part of `fm-fleet-snapshot.v1` this program reads.
//
// Upstream carries far more than this - the deck, the landed work, the health
// beacons, a worker's endpoint and status log. Fields nothing here draws are
// not decoded: a value nobody renders is one the next reader has to guess the
// meaning of. Unknown and newly added fields are ignored by construction,
// which is what keeps an additive upstream release from breaking this list.
type Snapshot struct {
	Schema    string `json:"schema"`
	Generated string `json:"generated"`
	Tasks     []Task `json:"tasks"`
}

// Task is one dispatched worker.
type Task struct {
	ID string `json:"id"`
	// Project is where the worker is working, as upstream records it - a path
	// in a live fleet and a bare name in the fixtures. Only its last segment
	// is ever drawn.
	Project string `json:"project"`
	Kind    string `json:"kind"`
	Mode    string `json:"mode"`
	// Remote names the machine a worker runs on, and is absent for a local
	// one. A remote worker's terminal is not this terminal's to hand over.
	Remote *string `json:"remote"`
	Paths  struct {
		Worktree Path `json:"worktree"`
	} `json:"paths"`
	CurrentState struct {
		State  string `json:"state"`
		Detail string `json:"detail"`
	} `json:"current_state"`
	// Backlog is the hand-written queue row upstream joins onto the worker. A
	// live fleet carries it and the synthetic fixtures do not, so the title
	// falls back to the identifier rather than to nothing.
	Backlog struct {
		Title string `json:"title"`
	} `json:"backlog"`
}

// Path is a location upstream reports along with whether it is still there.
type Path struct {
	Path    string `json:"path"`
	Present bool   `json:"present"`
}

// Parse reads snapshot bytes as the pinned schema.
//
// The identifier is checked before anything else, and a mismatch is its own
// refusal: a malformed snapshot may be a file that was half-written a moment
// ago, but a changed schema will still be changed on the next read.
func Parse(raw []byte, source string) (Snapshot, error) {
	var snapshot Snapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return Snapshot{}, fmt.Errorf("fleet snapshot could not be parsed (from %s): %w", source, err)
	}
	if snapshot.Schema != SchemaID {
		return Snapshot{}, fmt.Errorf(
			"fleet snapshot schema mismatch: expected %q, found %q (from %s)",
			SchemaID, snapshot.Schema, source)
	}
	return snapshot, nil
}

// Source is where snapshot bytes come from, injected so the list can be driven
// by a fixture or by a real fleet without the parser knowing the difference.
type Source struct {
	// Description names the source in every refusal, so an error says which
	// one produced it.
	Description string
	read        func(ctx context.Context) ([]byte, error)
}

// Read reads the source and parses it.
func (s Source) Read(ctx context.Context) (Snapshot, error) {
	raw, err := s.read(ctx)
	if err != nil {
		return Snapshot{}, fmt.Errorf("reading %s: %w", s.Description, err)
	}
	return Parse(raw, s.Description)
}

// SourceFor is the source a configuration names: a real fleet's snapshot
// command, or a committed synthetic fixture.
//
// The home arrives as configuration and nothing here knows a machine path. The
// command is run with the home in its environment because that is how upstream
// is told which fleet to report on, and with an otherwise inherited
// environment because it needs a PATH to find the tools it uses.
func SourceFor(config Config) Source {
	if config.Home == "" {
		file := config.FixtureFile
		return Source{
			Description: "fixture:" + config.Label,
			read: func(context.Context) ([]byte, error) {
				return os.ReadFile(file)
			},
		}
	}
	command := filepath.Join(config.Home, snapshotCommand)
	home := config.Home
	return Source{
		Description: "fleet:" + config.Label,
		read: func(ctx context.Context) ([]byte, error) {
			cmd := exec.CommandContext(ctx, command, snapshotArgs...)
			cmd.Env = append(os.Environ(), "FM_HOME="+home)
			return cmd.Output()
		},
	}
}
