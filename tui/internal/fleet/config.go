// Package fleet reads a fleet snapshot and reduces it to the rows the TUI
// draws.
//
// It is the terminal panel's half of the same boundary the web panel keeps in
// `src/adapters/contract.ts`: the snapshot arrives as bytes from a command a
// fleet home publishes, the pinned schema identifier is checked before
// anything is read out of it, and nothing here ever opens a fleet's own
// `state/` or `data/` files. The environment is read here and nowhere else,
// with the same names and the same meanings the web panel gives them.
package fleet

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// FleetSeparator is how several fleets are written into one setting: a colon,
// because that is what an operator already types between paths in PATH.
const fleetSeparator = ":"

const defaultFixtureSet = "healthy"

const defaultReadTimeout = 20 * time.Second

// Config is everything the TUI needs to know before it reads anything.
//
// One fleet, not the configured list: choosing between fleets is the web
// panel's, and this first version navigates rather than selects. The first
// configured entry wins, which is the same one the web panel opens on when a
// browser has remembered nothing.
type Config struct {
	// Home is a fleet home whose snapshot command is run, or "" when the
	// fixtures are being read instead.
	Home string
	// FixtureFile is a committed synthetic snapshot, or "" when a real home
	// is configured. Exactly one of Home and FixtureFile is set.
	FixtureFile string
	// Label is what the operator calls this fleet - a home's last segment, or
	// the fixture set's name. Never a full machine path.
	Label string
	// ReadTimeout is the budget one snapshot read gets.
	ReadTimeout time.Duration
}

// Env is the environment, as a lookup. `os.Getenv` satisfies it, and a test
// hands it a map instead.
type Env func(name string) string

// LoadConfig reads the settings the web panel already defines.
//
// A value that fails to parse fails the start rather than reverting to a
// default: a typo in QUARTERDECK_FIXTURE_SET that quietly opens the healthy
// fleet is worse than a program that refuses to run.
func LoadConfig(env Env) (Config, error) {
	timeout, err := readTimeout(env)
	if err != nil {
		return Config{}, err
	}

	home, err := firstHome(env)
	if err != nil {
		return Config{}, err
	}
	if home != "" {
		return Config{Home: home, Label: lastSegment(home), ReadTimeout: timeout}, nil
	}

	set, err := firstFixtureSet(env)
	if err != nil {
		return Config{}, err
	}
	root := env("QUARTERDECK_FIXTURE_ROOT")
	if root == "" {
		root = "fixtures"
	}
	return Config{
		FixtureFile: filepath.Join(root, set, "snapshot.json"),
		Label:       set,
		ReadTimeout: timeout,
	}, nil
}

func readTimeout(env Env) (time.Duration, error) {
	raw := env("QUARTERDECK_READ_TIMEOUT_MS")
	if raw == "" {
		return defaultReadTimeout, nil
	}
	ms, err := strconv.Atoi(raw)
	if err != nil || ms <= 0 {
		return 0, fmt.Errorf("QUARTERDECK_READ_TIMEOUT_MS must be a positive integer, got: %s", raw)
	}
	return time.Duration(ms) * time.Millisecond, nil
}

// firstHome is the first configured fleet home, checked to be absolute.
//
// A relative home would resolve against whatever directory the panel happened
// to be started from, which makes "it is reading the wrong fleet" a question
// about a shell's history rather than about a setting.
func firstHome(env Env) (string, error) {
	for _, entry := range entriesOf(env("QUARTERDECK_FLEET_HOME")) {
		if !strings.HasPrefix(entry, "/") {
			return "", fmt.Errorf("QUARTERDECK_FLEET_HOME must be an absolute path, got: %s", entry)
		}
		return strings.TrimRight(entry, "/"), nil
	}
	return "", nil
}

func firstFixtureSet(env Env) (string, error) {
	for _, entry := range entriesOf(env("QUARTERDECK_FIXTURE_SET")) {
		if !isFixtureName(entry) {
			return "", fmt.Errorf("QUARTERDECK_FIXTURE_SET must be a lowercase fixture directory name, got: %s", entry)
		}
		return entry, nil
	}
	return defaultFixtureSet, nil
}

func isFixtureName(name string) bool {
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
		default:
			return false
		}
	}
	return name != ""
}

// entriesOf is the non-empty entries of a colon-separated setting, in the
// order they were written.
func entriesOf(raw string) []string {
	var entries []string
	for _, entry := range strings.Split(raw, fleetSeparator) {
		if trimmed := strings.TrimSpace(entry); trimmed != "" {
			entries = append(entries, trimmed)
		}
	}
	return entries
}

// lastSegment is what an operator calls a fleet, or a project: the last part
// of the path, never the path itself.
func lastSegment(path string) string {
	trimmed := strings.TrimRight(path, "/")
	if i := strings.LastIndex(trimmed, "/"); i >= 0 {
		return trimmed[i+1:]
	}
	return trimmed
}

// OSEnv reads the real environment.
func OSEnv(name string) string { return os.Getenv(name) }
