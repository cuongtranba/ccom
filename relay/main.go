package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/relay"
)

func main() {
	port := os.Getenv("RELAY_PORT")
	if port == "" {
		port = "4001"
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	h, err := libp2p.New(
		libp2p.ListenAddrStrings(
			fmt.Sprintf("/ip4/0.0.0.0/tcp/%s", port),
			fmt.Sprintf("/ip4/0.0.0.0/udp/%s/quic-v1", port),
		),
		libp2p.EnableRelayService(relay.WithLimit(nil)),
		libp2p.NATPortMap(),
		libp2p.EnableAutoNATv2(),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create host: %v\n", err)
		os.Exit(1)
	}
	defer h.Close()

	// Bootstrap into DHT so peers can find this relay
	kademliaDHT, err := dht.New(ctx, h, dht.Mode(dht.ModeServer))
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create DHT: %v\n", err)
		os.Exit(1)
	}
	defer kademliaDHT.Close()

	if err := kademliaDHT.Bootstrap(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "failed to bootstrap DHT: %v\n", err)
		os.Exit(1)
	}

	// Connect to IPFS bootstrap peers
	for _, addr := range dht.DefaultBootstrapPeers {
		pi, err := peer.AddrInfoFromP2pAddr(addr)
		if err != nil {
			continue
		}
		if err := h.Connect(ctx, *pi); err != nil {
			fmt.Fprintf(os.Stderr, "bootstrap peer %s: %v\n", pi.ID.ShortString(), err)
		} else {
			fmt.Printf("connected to bootstrap peer %s\n", pi.ID.ShortString())
		}
	}

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════")
	fmt.Printf("  Relay server running\n")
	fmt.Printf("  Peer ID: %s\n", h.ID())
	fmt.Printf("  Port:    %s\n", port)
	fmt.Println()
	for _, addr := range h.Addrs() {
		fmt.Printf("  %s/p2p/%s\n", addr, h.ID())
	}
	fmt.Println("═══════════════════════════════════════════════════")
	fmt.Println()
	fmt.Println("Add this to your inv config.yaml bootstrap_peers:")
	for _, addr := range h.Addrs() {
		fmt.Printf("  - %s/p2p/%s\n", addr, h.ID())
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	fmt.Println("\nshutting down...")
}
