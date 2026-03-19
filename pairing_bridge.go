package main

import (
	"context"
	"encoding/json"
)

// PairEventSendFunc is a callback that sends a pairing event to a remote peer.
type PairEventSendFunc func(ctx context.Context, sessionID, toPeerID, eventKind, payloadJSON string)

// PairingBridge listens to P2P events and forwards non-pairing events to
// active pairing session guests. This allows a guest to observe the host's
// inventory events in real time during a pairing session.
type PairingBridge struct {
	store     *Store
	localPeer string
	sendFunc  PairEventSendFunc
}

// NewPairingBridge creates a new PairingBridge that forwards events to paired guests.
func NewPairingBridge(store *Store, localPeerID string, sendFunc PairEventSendFunc) *PairingBridge {
	return &PairingBridge{store: store, localPeer: localPeerID, sendFunc: sendFunc}
}

// pairingEventTypes tracks event types that should NOT be forwarded to avoid loops.
var pairingEventTypes = map[P2PEventType]bool{
	P2PPairInviteReceived: true,
	P2PPairAccepted:       true,
	P2PPairEnded:          true,
}

// Register subscribes the bridge to the P2PEventBus.
func (b *PairingBridge) Register(bus *P2PEventBus) {
	bus.Register(func(ctx context.Context, event P2PEvent) {
		b.onEvent(ctx, event)
	})
}

// onEvent handles an incoming P2P event and forwards it to all active pairing
// session guests where the local peer is the host.
func (b *PairingBridge) onEvent(ctx context.Context, event P2PEvent) {
	// Skip pairing-related events to avoid infinite forwarding loops.
	if pairingEventTypes[event.Type] {
		return
	}

	sessions, err := b.store.ListActivePairingSessions(ctx, b.localPeer)
	if err != nil || len(sessions) == 0 {
		return
	}

	payloadJSON, err := json.Marshal(event.Payload)
	if err != nil {
		return
	}

	for _, sess := range sessions {
		// Only forward events when we are the host.
		if sess.HostPeerID != b.localPeer {
			continue
		}
		b.sendFunc(ctx, sess.ID, sess.GuestPeerID, string(event.Type), string(payloadJSON))
	}
}
