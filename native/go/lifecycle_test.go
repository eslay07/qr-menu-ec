package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestSecondBindFailureReleasesGuest(t *testing.T) {
	cert, key, err := ensureTLS(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer occupied.Close()
	free, _ := net.Listen("tcp", "127.0.0.1:0")
	addr := free.Addr().String()
	free.Close()
	called := false
	err = servePair(context.Background(), func() { called = true }, addr, occupied.Addr().String(), cert, key, http.NotFoundHandler(), http.NotFoundHandler())
	if err == nil || called {
		t.Fatal("announced readiness after failed bind")
	}
	retry, err := net.Listen("tcp", addr)
	if err != nil {
		t.Fatal("guest listener leaked", err)
	}
	retry.Close()
}
func TestPairStopsAndReleasesPorts(t *testing.T) {
	cert, key, err := ensureTLS(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	ready := make(chan struct{})
	go func() {
		done <- servePair(ctx, func() { close(ready) }, "127.0.0.1:0", "127.0.0.1:0", cert, key, http.NotFoundHandler(), http.NotFoundHandler())
	}()
	select {
	case <-ready:
	case <-time.After(5 * time.Second):
		t.Fatal("startup timeout")
	}
	cancel()
	select {
	case err := <-done:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown timeout")
	}
}
