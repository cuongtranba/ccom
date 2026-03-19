package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/protocol"
	"github.com/rs/zerolog/log"
)

const HandshakeProtocolID = protocol.ID("/inv/handshake/1.0.0")

// HandshakePayload is exchanged between peers on first connection.
type HandshakePayload struct {
	PeerID   string   `json:"peer_id"`
	NodeID   string   `json:"node_id"`
	Name     string   `json:"name"`
	Vertical string   `json:"vertical"`
	Project  string   `json:"project"`
	Owner    string   `json:"owner"`
	IsAI     bool     `json:"is_ai"`
	Addrs    []string `json:"addrs"`
}

// SetupHandshakeHandler registers the stream handler for incoming handshakes.
func (p *P2PHost) SetupHandshakeHandler() {
	p.host.SetStreamHandler(HandshakeProtocolID, func(s network.Stream) {
		defer s.Close()

		data, err := io.ReadAll(io.LimitReader(s, 4096))
		if err != nil {
			log.Debug().Err(err).Msg("handshake: read failed")
			return
		}

		var remote HandshakePayload
		if err := json.Unmarshal(data, &remote); err != nil {
			log.Debug().Err(err).Msg("handshake: parse failed")
			return
		}

		// Send our payload back
		resp, err := json.Marshal(p.buildHandshakePayload())
		if err != nil {
			log.Debug().Err(err).Msg("handshake: marshal response failed")
			return
		}
		if _, err := s.Write(resp); err != nil {
			log.Debug().Err(err).Msg("handshake: write response failed")
			return
		}

		if err := p.registerDiscoveredPeer(context.Background(), &remote); err != nil {
			log.Debug().Err(err).Str("peer", remote.PeerID).Msg("handshake: register failed")
			return
		}
		log.Info().Str("peer", remote.PeerID).Str("name", remote.Name).Msg("handshake: peer registered (incoming)")
	})
}

// InitiateHandshake opens a handshake stream to a connected peer,
// exchanges inventory metadata, and registers the peer in the store.
func (p *P2PHost) InitiateHandshake(ctx context.Context, remotePeerID peer.ID) error {
	stream, err := p.host.NewStream(ctx, remotePeerID, HandshakeProtocolID)
	if err != nil {
		return fmt.Errorf("open handshake stream: %w", err)
	}
	defer stream.Close()

	data, err := json.Marshal(p.buildHandshakePayload())
	if err != nil {
		return fmt.Errorf("marshal handshake: %w", err)
	}
	if _, err := stream.Write(data); err != nil {
		return fmt.Errorf("write handshake: %w", err)
	}

	if err := stream.CloseWrite(); err != nil {
		return fmt.Errorf("close write: %w", err)
	}

	resp, err := io.ReadAll(io.LimitReader(stream, 4096))
	if err != nil {
		return fmt.Errorf("read handshake response: %w", err)
	}

	var remote HandshakePayload
	if err := json.Unmarshal(resp, &remote); err != nil {
		return fmt.Errorf("parse handshake response: %w", err)
	}

	if err := p.registerDiscoveredPeer(ctx, &remote); err != nil {
		return fmt.Errorf("register peer: %w", err)
	}
	log.Info().Str("peer", remote.PeerID).Str("name", remote.Name).Msg("handshake: peer registered (outgoing)")
	return nil
}

func (p *P2PHost) buildHandshakePayload() HandshakePayload {
	return HandshakePayload{
		PeerID:   p.host.ID().String(),
		Name:     p.config.Node.Name,
		Vertical: string(p.config.Node.Vertical),
		Project:  p.config.Node.Project,
		Owner:    p.config.Node.Owner,
		IsAI:     p.config.Node.IsAI,
		Addrs:    p.ShareableAddrs(),
	}
}

func (p *P2PHost) registerDiscoveredPeer(ctx context.Context, remote *HandshakePayload) error {
	if remote.Project != p.config.Node.Project {
		return fmt.Errorf("project mismatch: %s vs %s", remote.Project, p.config.Node.Project)
	}

	invPeer := &Peer{
		PeerID:   remote.PeerID,
		NodeID:   remote.NodeID,
		Name:     remote.Name,
		Vertical: Vertical(remote.Vertical),
		Project:  remote.Project,
		Owner:    remote.Owner,
		IsAI:     remote.IsAI,
		Status:   PeerStatusApproved,
		Addrs:    remote.Addrs,
	}
	return p.store.CreatePeer(ctx, invPeer)
}
