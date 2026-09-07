package main

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"time"
)

// Bind both ports before announcing readiness. A failed second bind must release the first.
func servePair(ctx context.Context, ready func(), guestAddr, adminAddr, cert, key string, guest, admin http.Handler) error {
	pair, err := tls.LoadX509KeyPair(cert, key)
	if err != nil {
		return err
	}
	gl, err := net.Listen("tcp", guestAddr)
	if err != nil {
		return err
	}
	defer gl.Close()
	al, err := net.Listen("tcp", adminAddr)
	if err != nil {
		return err
	}
	defer al.Close()
	makeServer := func(h http.Handler) *http.Server {
		return &http.Server{Handler: http.MaxBytesHandler(h, 30000000), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 30 * time.Second}
	}
	gs, as := makeServer(guest), makeServer(admin)
	results := make(chan error, 2)
	go func() { results <- gs.Serve(gl) }()
	go func() {
		results <- as.Serve(tls.NewListener(al, &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{pair}}))
	}()
	ready()
	var result error
	select {
	case <-ctx.Done():
	case result = <-results:
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	done := make(chan struct{})
	go func() { _ = gs.Shutdown(shutdown); close(done) }()
	_ = as.Shutdown(shutdown)
	<-done
	_ = gs.Close()
	_ = as.Close()
	if errors.Is(result, http.ErrServerClosed) {
		return nil
	}
	return result
}
