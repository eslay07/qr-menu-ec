package main

import (
	"context"
	"fmt"
	"golang.org/x/sys/windows/svc"
	"log"
)

func runPlatform(run serverRun) error {
	isService, err := svc.IsWindowsService()
	if err != nil {
		return err
	}
	if !isService {
		return runConsole(run)
	}
	return svc.Run("QRMenu-Servidor", &menuService{run: run})
}

type menuService struct{ run serverRun }

func (m *menuService) Execute(_ []string, requests <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ready := make(chan struct{})
	done := make(chan error, 1)
	status <- svc.Status{State: svc.StartPending, WaitHint: 30000}
	go func() { done <- m.run(ctx, func() { close(ready) }) }()
	current := svc.Status{State: svc.StartPending, WaitHint: 30000}
	stopping := false
	for {
		select {
		case <-ready:
			ready = nil
			if !stopping {
				current = svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
				status <- current
			}
		case err := <-done:
			if err != nil {
				log.Print(fmt.Errorf("servidor: %w", err))
				return true, 1
			}
			return false, 0
		case request, ok := <-requests:
			if !ok {
				cancel()
				return false, 0
			}
			switch request.Cmd {
			case svc.Interrogate:
				status <- current
			case svc.Stop, svc.Shutdown:
				stopping = true
				current = svc.Status{State: svc.StopPending, WaitHint: 20000}
				status <- current
				cancel()
			}
		}
	}
}
