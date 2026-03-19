package main

import (
	"context"
	"fmt"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
)

// P2PSender handles sending protobuf envelopes to peers with outbox fallback.
type P2PSender struct {
	host  *P2PHost
	store *Store
}

func NewP2PSender(host *P2PHost, store *Store) *P2PSender {
	return &P2PSender{host: host, store: store}
}

// SendEnvelope sends a serialized envelope to a specific peer.
// If the peer is unreachable, it queues to the outbox.
func (s *P2PSender) SendEnvelope(ctx context.Context, toPeerID string, envelope []byte) error {
	if s.host == nil {
		return s.queueToOutbox(ctx, toPeerID, envelope)
	}

	peerID, err := peer.Decode(toPeerID)
	if err != nil {
		return s.queueToOutbox(ctx, toPeerID, envelope)
	}

	// Check if peer is connected
	connectedness := s.host.Host().Network().Connectedness(peerID)
	if connectedness != network.Connected {
		return s.queueToOutbox(ctx, toPeerID, envelope)
	}

	// Open stream and send
	stream, err := s.host.Host().NewStream(ctx, peerID, ProtocolID)
	if err != nil {
		return s.queueToOutbox(ctx, toPeerID, envelope)
	}
	defer stream.Close()

	_, err = stream.Write(envelope)
	if err != nil {
		return s.queueToOutbox(ctx, toPeerID, envelope)
	}

	return nil
}

// BroadcastEnvelope sends a serialized envelope to all approved peers in a project,
// excluding the sender's own peer ID.
func (s *P2PSender) BroadcastEnvelope(ctx context.Context, project string, selfPeerID string, envelope []byte) error {
	peers, err := s.store.ListPeers(ctx, project)
	if err != nil {
		return fmt.Errorf("list peers: %w", err)
	}

	for _, p := range peers {
		if p.PeerID == selfPeerID {
			continue
		}
		if p.Status != PeerStatusApproved {
			continue
		}
		if err := s.SendEnvelope(ctx, p.PeerID, envelope); err != nil {
			return fmt.Errorf("send to %s: %w", p.PeerID, err)
		}
	}
	return nil
}

func (s *P2PSender) queueToOutbox(ctx context.Context, toPeerID string, envelope []byte) error {
	msg := &OutboxMessage{
		ToPeer:   toPeerID,
		Envelope: envelope,
	}
	return s.store.EnqueueOutbox(ctx, msg)
}

// DrainOutbox attempts to send all pending outbox messages for a specific peer.
func (s *P2PSender) DrainOutbox(ctx context.Context, peerID string) (int, error) {
	msgs, err := s.store.GetPendingOutbox(ctx, peerID, 100)
	if err != nil {
		return 0, fmt.Errorf("get pending outbox: %w", err)
	}

	sent := 0
	for _, msg := range msgs {
		if s.host == nil {
			break
		}

		pid, err := peer.Decode(msg.ToPeer)
		if err != nil {
			continue
		}

		if s.host.Host().Network().Connectedness(pid) != network.Connected {
			if err := s.store.IncrementOutboxAttempts(ctx, msg.ID); err != nil {
				continue
			}
			break
		}

		stream, err := s.host.Host().NewStream(ctx, pid, ProtocolID)
		if err != nil {
			if err := s.store.IncrementOutboxAttempts(ctx, msg.ID); err != nil {
				continue
			}
			continue
		}

		if _, err := stream.Write(msg.Envelope); err != nil {
			stream.Close()
			if err := s.store.IncrementOutboxAttempts(ctx, msg.ID); err != nil {
				continue
			}
			continue
		}
		stream.Close()

		if err := s.store.DeleteOutboxMessage(ctx, msg.ID); err != nil {
			continue
		}
		sent++
	}

	return sent, nil
}

// DrainAllOutbox attempts to send all pending outbox messages for all peers.
func (s *P2PSender) DrainAllOutbox(ctx context.Context) (int, error) {
	msgs, err := s.store.GetAllPendingOutbox(ctx, 500)
	if err != nil {
		return 0, fmt.Errorf("get all pending outbox: %w", err)
	}

	sent := 0
	for _, msg := range msgs {
		err := s.SendEnvelope(ctx, msg.ToPeer, msg.Envelope)
		if err == nil {
			s.store.DeleteOutboxMessage(ctx, msg.ID)
			sent++
		} else {
			s.store.IncrementOutboxAttempts(ctx, msg.ID)
		}
	}
	return sent, nil
}
