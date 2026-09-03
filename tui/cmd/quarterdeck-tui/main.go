// Command quarterdeck-tui is Quarterdeck in a terminal: a list of the fleet's
// work in progress, and one key that hands this terminal to the selected work
// item's no-mistakes run.
//
// It reads and it hands over. It writes nothing, steers nobody, answers no
// decision and orders no merge - the web panel is where the two writes live,
// and this is deliberately the half that only looks. See the README.
package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/milesibastos/quarterdeck/tui/internal/app"
	"github.com/milesibastos/quarterdeck/tui/internal/fleet"
	"github.com/milesibastos/quarterdeck/tui/internal/nomistakes"
	"github.com/milesibastos/quarterdeck/tui/internal/ui"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "quarterdeck-tui:", err)
		os.Exit(1)
	}
}

func run() error {
	config, err := fleet.LoadConfig(fleet.OSEnv)
	if err != nil {
		return err
	}
	loader := app.Loader{
		Source:   fleet.SourceFor(config),
		Resolver: nomistakes.NewResolver(),
	}
	model := ui.New(loader.Load, config.Label)
	// The alternate screen, so the list leaves the operator's scrollback as it
	// found it - and so no-mistakes' own screen is what is on the terminal
	// while it has it.
	program := tea.NewProgram(model, tea.WithAltScreen())
	_, err = program.Run()
	return err
}
