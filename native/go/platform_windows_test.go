package main

import (
	"context"
	"errors"
	"golang.org/x/sys/windows/svc"
	"testing"
	"time"
)

func TestServiceLifecycle(t *testing.T) {
	for _, fail := range []bool{false, true} {
		requests := make(chan svc.ChangeRequest)
		states := make(chan svc.Status, 8)
		done := make(chan uint32, 1)
		m := menuService{run: func(ctx context.Context, ready func()) error {
			if fail {
				return errors.New("bind failed")
			}
			ready()
			<-ctx.Done()
			return nil
		}}
		go func() { _, code := m.Execute(nil, requests, states); done <- code }()
		if state := <-states; state.State != svc.StartPending {
			t.Fatal(state)
		}
		if !fail {
			select {
			case state := <-states:
				if state.State != svc.Running {
					t.Fatal(state)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("not running")
			}
			requests <- svc.ChangeRequest{Cmd: svc.Stop}
			if state := <-states; state.State != svc.StopPending {
				t.Fatal(state)
			}
		}
		select {
		case code := <-done:
			if (code != 0) != fail {
				t.Fatal("incorrect service exit", code)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("service did not stop")
		}
	}
}
