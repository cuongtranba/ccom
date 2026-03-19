package main

import (
	"context"
	"encoding/binary"
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

// writeHandshakeMsg writes a length-prefixed JSON message to the stream.
func writeHandshakeMsg(s network.Stream, payload HandshakePayload) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	// Write 4-byte big-endian length prefix
	lenBuf := make([]byte, 4)
	binary.BigEndian.PutUint32(lenBuf, uint32(len(data)))
	if _, err := s.Write(lenBuf); err != nil {
		return fmt.Errorf("write length: %w", err)
	}
	if _, err := s.Write(data); err != nil {
		return fmt.Errorf("write payload: %w", err)
	}
	return nil
}

// readHandshakeMsg reads a length-prefixed JSON message from the stream.
func readHandshakeMsg(s network.Stream) (HandshakePayload, error) {
	var payload HandshakePayload
	lenBuf := make([]byte, 4)
	if _, err := io.ReadFull(s, lenBuf); err != nil {
		return payload, fmt.Errorf("read length: %w", err)
	}
	msgLen := binary.BigEndian.Uint32(lenBuf)
	if msgLen > 4096 {
		return payload, fmt.Errorf("message too large: %d", msgLen)
	}
	data := make([]byte, msgLen)
	if _, err := io.ReadFull(s, data); err != nil {
		return payload, fmt.Errorf("read payload: %w", err)
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return payload, fmt.Errorf("unmarshal: %w", err)
	}
	return payload, nil
}

// SetupHandshakeHandler registers the stream handler for incoming handshakes.
func (p *P2PHost) SetupHandshakeHandler() {
	p.host.SetStreamHandler(HandshakeProtocolID, func(s network.Stream) {
		defer s.Close()

		remote, err := readHandshakeMsg(s)
		if err != nil {
			log.Debug().Err(err).Msg("handshake: read failed")
			return
		}

		if err := writeHandshakeMsg(s, p.buildHandshakePayload()); err != nil {
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

	if err := writeHandshakeMsg(stream, p.buildHandshakePayload()); err != nil {
		return fmt.Errorf("write handshake: %w", err)
	}

	remote, err := readHandshakeMsg(stream)
	if err != nil {
		return fmt.Errorf("read handshake response: %w", err)
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
