package main

import (
	"context"
	"os"
	"os/signal"
)

type serverRun func(context.Context, func()) error

func runConsole(run serverRun) error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	return run(ctx, func() {})
}
