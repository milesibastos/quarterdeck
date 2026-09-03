package fleet

import (
	"testing"
	"time"
)

func envOf(pairs map[string]string) Env {
	return func(name string) string { return pairs[name] }
}

// No setting at all is the default fixture set, which is what a checkout with
// no fleet reads - the same fallback the web panel has.
func TestConfigDefaultsToTheFixtures(t *testing.T) {
	config, err := LoadConfig(envOf(nil))
	if err != nil {
		t.Fatalf("loading: %v", err)
	}
	if config.Home != "" {
		t.Errorf("home = %q, want none", config.Home)
	}
	if config.FixtureFile != "fixtures/healthy/snapshot.json" {
		t.Errorf("fixture file = %q", config.FixtureFile)
	}
	if config.Label != "healthy" {
		t.Errorf("label = %q", config.Label)
	}
	if config.ReadTimeout != 20*time.Second {
		t.Errorf("read timeout = %v", config.ReadTimeout)
	}
}

// A configured home wins over the fixtures, and the first of several is the
// one this version opens: choosing between fleets is the web panel's.
func TestConfigPrefersTheFirstFleetHome(t *testing.T) {
	config, err := LoadConfig(envOf(map[string]string{
		"QUARTERDECK_FLEET_HOME":  "/opt/fleet/:/opt/other",
		"QUARTERDECK_FIXTURE_SET": "crowded",
	}))
	if err != nil {
		t.Fatalf("loading: %v", err)
	}
	if config.Home != "/opt/fleet" {
		t.Errorf("home = %q, want the first with no trailing separator", config.Home)
	}
	if config.Label != "fleet" {
		t.Errorf("label = %q, want the home's last segment", config.Label)
	}
	if config.FixtureFile != "" {
		t.Errorf("a configured home still fell back to %q", config.FixtureFile)
	}
}

func TestConfigReadsTheFixtureRootAndSet(t *testing.T) {
	config, err := LoadConfig(envOf(map[string]string{
		"QUARTERDECK_FIXTURE_SET":  "crowded:rails",
		"QUARTERDECK_FIXTURE_ROOT": "/opt/fixtures",
	}))
	if err != nil {
		t.Fatalf("loading: %v", err)
	}
	if config.FixtureFile != "/opt/fixtures/crowded/snapshot.json" {
		t.Errorf("fixture file = %q", config.FixtureFile)
	}
}

func TestConfigReadsTheReadBudget(t *testing.T) {
	config, err := LoadConfig(envOf(map[string]string{"QUARTERDECK_READ_TIMEOUT_MS": "4500"}))
	if err != nil {
		t.Fatalf("loading: %v", err)
	}
	if config.ReadTimeout != 4500*time.Millisecond {
		t.Errorf("read timeout = %v", config.ReadTimeout)
	}
}

// A setting that will not parse stops the program. A typo that quietly opens
// the wrong fleet is worse than one that refuses to start.
func TestConfigRefusesRatherThanDefaulting(t *testing.T) {
	for name, env := range map[string]map[string]string{
		"a relative home":     {"QUARTERDECK_FLEET_HOME": "fleet"},
		"an odd fixture name": {"QUARTERDECK_FIXTURE_SET": "Healthy"},
		"a fixture path":      {"QUARTERDECK_FIXTURE_SET": "../elsewhere"},
		"a zero budget":       {"QUARTERDECK_READ_TIMEOUT_MS": "0"},
		"a budget in words":   {"QUARTERDECK_READ_TIMEOUT_MS": "soon"},
	} {
		if _, err := LoadConfig(envOf(env)); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
}
