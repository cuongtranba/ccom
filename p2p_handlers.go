package main

import (
	"context"
	"fmt"
)

// P2PEventType represents the type of an internal P2P handler event.
type P2PEventType string

const (
	P2PSignalReceived    P2PEventType = "signal.received"
	P2PSweepReceived     P2PEventType = "sweep.received"
	P2PQueryReceived     P2PEventType = "query.received"
	P2PVoteRequested     P2PEventType = "vote.requested"
	P2PChallengeReceived P2PEventType = "challenge.received"
	P2PPeerJoined        P2PEventType = "peer.joined"
	P2PMembershipRequest P2PEventType = "membership.request"
	P2PPairInviteReceived P2PEventType = "pair.invite_received"
	P2PPairAccepted       P2PEventType = "pair.accepted"
	P2PPairEnded          P2PEventType = "pair.ended"
)

// P2PEventPayload is implemented by all P2P event payload types.
type P2PEventPayload interface {
	p2pEventPayload()
}

// SignalEventPayload carries signal change details.
type SignalEventPayload struct {
	SourceItemID string
	SourceNodeID string
	TargetItemID string
	Reason       string
}

func (SignalEventPayload) p2pEventPayload() {}

// SweepEventPayload carries sweep event details.
type SweepEventPayload struct {
	ExternalRef  string
	SourceNodeID string
}

func (SweepEventPayload) p2pEventPayload() {}

// QueryEventPayload carries query event details.
type QueryEventPayload struct {
	QueryID  string
	AskerID  string
	Question string
}

func (QueryEventPayload) p2pEventPayload() {}

// ProposalEventPayload wraps a Proposal for event dispatch.
type ProposalEventPayload struct {
	Proposal *Proposal
}

func (ProposalEventPayload) p2pEventPayload() {}

// ChallengeEventPayload wraps a Challenge for event dispatch.
type ChallengeEventPayload struct {
	Challenge *Challenge
}

func (ChallengeEventPayload) p2pEventPayload() {}

// PeerEventPayload wraps a Peer for event dispatch.
type PeerEventPayload struct {
	Peer *Peer
}

func (PeerEventPayload) p2pEventPayload() {}

// PairingEventPayload wraps a PairingSession for event dispatch.
type PairingEventPayload struct {
	Session *PairingSession
}

func (PairingEventPayload) p2pEventPayload() {}

// P2PEvent represents an event emitted by a P2P handler after processing a message.
type P2PEvent struct {
	Type    P2PEventType
	Payload P2PEventPayload
}

// P2PEventBus dispatches P2P events to registered listeners.
type P2PEventBus struct {
	listeners []func(ctx context.Context, event P2PEvent)
}

// NewP2PEventBus creates a new P2PEventBus.
func NewP2PEventBus() *P2PEventBus {
	return &P2PEventBus{}
}

// Register adds a listener that will be called for every dispatched event.
func (d *P2PEventBus) Register(fn func(ctx context.Context, event P2PEvent)) {
	d.listeners = append(d.listeners, fn)
}

// Dispatch sends an event to all registered listeners.
func (d *P2PEventBus) Dispatch(ctx context.Context, event P2PEvent) {
	for _, fn := range d.listeners {
		fn(ctx, event)
	}
}

// TraceResolveResult holds the result of resolving a remote trace.
type TraceResolveResult struct {
	ItemID   string `json:"item_id"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	Status   string `json:"status"`
	NodeID   string `json:"node_id"`
	Vertical string `json:"vertical"`
	Found    bool   `json:"found"`
}

// P2PHandlers dispatches incoming P2P messages to the appropriate engine methods.
type P2PHandlers struct {
	engine     *Engine
	store      *Store
	dispatcher *P2PEventBus
}

func NewP2PHandlers(engine *Engine, store *Store, dispatcher *P2PEventBus) *P2PHandlers {
	return &P2PHandlers{engine: engine, store: store, dispatcher: dispatcher}
}

// dispatchEvent emits a P2PEvent if the dispatcher is configured.
func (h *P2PHandlers) dispatchEvent(ctx context.Context, event P2PEvent) {
	if h.dispatcher != nil {
		h.dispatcher.Dispatch(ctx, event)
	}
}

// HandleSignalChange processes an incoming signal.change message from a remote peer.
func (h *P2PHandlers) HandleSignalChange(ctx context.Context, sourceItemID, sourceNodeID, targetItemID, reason string) error {
	_, err := h.engine.GetItem(ctx, targetItemID)
	if err != nil {
		return fmt.Errorf("target item not found locally: %w", err)
	}

	_, err = h.engine.PropagateChange(ctx, targetItemID)
	if err != nil {
		return fmt.Errorf("propagate change: %w", err)
	}

	h.dispatchEvent(ctx, P2PEvent{Type: P2PSignalReceived, Payload: SignalEventPayload{
		SourceItemID: sourceItemID, SourceNodeID: sourceNodeID,
		TargetItemID: targetItemID, Reason: reason,
	}})
	return nil
}

// HandleSignalSweep processes an incoming signal.sweep message from a remote peer.
func (h *P2PHandlers) HandleSignalSweep(ctx context.Context, externalRef, sourceNodeID string) error {
	_, err := h.engine.Sweep(ctx, externalRef)
	if err != nil {
		return fmt.Errorf("handle sweep: %w", err)
	}
	h.dispatchEvent(ctx, P2PEvent{Type: P2PSweepReceived, Payload: SweepEventPayload{
		ExternalRef: externalRef, SourceNodeID: sourceNodeID,
	}})
	return nil
}

// HandleTraceResolve responds to a trace.resolve request — returns metadata for a local item.
func (h *P2PHandlers) HandleTraceResolve(ctx context.Context, itemID string) (*TraceResolveResult, error) {
	item, err := h.engine.GetItem(ctx, itemID)
	if err != nil {
		return &TraceResolveResult{ItemID: itemID, Found: false}, nil
	}

	node, err := h.engine.GetNode(ctx, item.NodeID)
	if err != nil {
		return &TraceResolveResult{ItemID: itemID, Found: false}, nil
	}

	return &TraceResolveResult{
		ItemID:   item.ID,
		Kind:     string(item.Kind),
		Title:    item.Title,
		Status:   string(item.Status),
		NodeID:   item.NodeID,
		Vertical: string(node.Vertical),
		Found:    true,
	}, nil
}

// HandleQueryAsk processes an incoming query.ask message.
func (h *P2PHandlers) HandleQueryAsk(ctx context.Context, queryID, askerID, question, queryCtx string) error {
	_, err := h.engine.AskNetwork(ctx, askerID, "remote", question, queryCtx, "")
	if err != nil {
		return fmt.Errorf("store remote query: %w", err)
	}
	h.dispatchEvent(ctx, P2PEvent{Type: P2PQueryReceived, Payload: QueryEventPayload{
		QueryID: queryID, AskerID: askerID, Question: question,
	}})
	return nil
}

// HandleProposalCreate processes an incoming proposal.create message.
func (h *P2PHandlers) HandleProposalCreate(ctx context.Context, prop *Proposal) error {
	if err := h.store.CreateProposal(ctx, prop); err != nil {
		return err
	}
	h.dispatchEvent(ctx, P2PEvent{Type: P2PVoteRequested, Payload: ProposalEventPayload{Proposal: prop}})
	return nil
}

// HandleProposalVote processes an incoming proposal.vote message.
func (h *P2PHandlers) HandleProposalVote(ctx context.Context, vote *ProposalVoteRecord) error {
	return h.store.CreateProposalVote(ctx, vote)
}

// HandleChallengeCreate processes an incoming challenge.create message.
func (h *P2PHandlers) HandleChallengeCreate(ctx context.Context, ch *Challenge) error {
	if err := h.store.CreateChallenge(ctx, ch); err != nil {
		return err
	}
	h.dispatchEvent(ctx, P2PEvent{Type: P2PChallengeReceived, Payload: ChallengeEventPayload{Challenge: ch}})
	return nil
}

// HandleChallengeResponse processes an incoming challenge.response message.
func (h *P2PHandlers) HandleChallengeResponse(ctx context.Context, challengeID, evidence string) error {
	return h.store.UpdateChallengeResponse(ctx, challengeID, evidence, ChallengeResponded)
}

// HandlePeerHandshake processes an incoming peer.handshake message and registers the peer.
func (h *P2PHandlers) HandlePeerHandshake(ctx context.Context, p *Peer) error {
	if err := h.store.CreatePeer(ctx, p); err != nil {
		return err
	}
	if p.Status == PeerStatusApproved {
		h.dispatchEvent(ctx, P2PEvent{Type: P2PPeerJoined, Payload: PeerEventPayload{Peer: p}})
	} else {
		h.dispatchEvent(ctx, P2PEvent{Type: P2PMembershipRequest, Payload: PeerEventPayload{Peer: p}})
	}
	return nil
}

// HandlePairInvite processes an incoming pair.invite message and creates a pairing session.
func (h *P2PHandlers) HandlePairInvite(ctx context.Context, sessionID, hostPeerID, hostNodeID, guestPeerID, guestNodeID string) (*PairingSession, error) {
	ps := &PairingSession{
		ID:          sessionID,
		HostPeerID:  hostPeerID,
		HostNodeID:  hostNodeID,
		GuestPeerID: guestPeerID,
		GuestNodeID: guestNodeID,
	}
	if err := h.store.CreatePairingSession(ctx, ps); err != nil {
		return nil, fmt.Errorf("create pairing session: %w", err)
	}
	h.dispatchEvent(ctx, P2PEvent{Type: P2PPairInviteReceived, Payload: PairingEventPayload{Session: ps}})
	return ps, nil
}

// HandlePairAccept processes an incoming pair.accept message and activates the session.
func (h *P2PHandlers) HandlePairAccept(ctx context.Context, sessionID, guestPeerID string) (*PairingSession, error) {
	ps, err := h.store.GetPairingSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("get pairing session: %w", err)
	}
	if ps.GuestPeerID != guestPeerID {
		return nil, fmt.Errorf("not the invited guest")
	}
	if ps.Status != PairingPending {
		return nil, fmt.Errorf("session is not pending (status: %s)", ps.Status)
	}
	if err := h.store.UpdatePairingSessionStatus(ctx, sessionID, PairingActive); err != nil {
		return nil, fmt.Errorf("activate pairing session: %w", err)
	}
	ps.Status = PairingActive
	h.dispatchEvent(ctx, P2PEvent{Type: P2PPairAccepted, Payload: PairingEventPayload{Session: ps}})
	return ps, nil
}

// HandlePairEnd processes an incoming pair.end message and ends the session.
func (h *P2PHandlers) HandlePairEnd(ctx context.Context, sessionID, endedBy string) (*PairingSession, error) {
	ps, err := h.store.GetPairingSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("get pairing session: %w", err)
	}
	if ps.HostPeerID != endedBy && ps.GuestPeerID != endedBy {
		return nil, fmt.Errorf("not a participant in this pairing session")
	}
	if err := h.store.EndPairingSession(ctx, sessionID); err != nil {
		return nil, fmt.Errorf("end pairing session: %w", err)
	}
	ps, err = h.store.GetPairingSession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("get ended pairing session: %w", err)
	}
	h.dispatchEvent(ctx, P2PEvent{Type: P2PPairEnded, Payload: PairingEventPayload{Session: ps}})
	return ps, nil
}
