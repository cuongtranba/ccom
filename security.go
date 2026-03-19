package main

import (
	"sync"
	"time"
)

// MessageCache implements an LRU-based seen-message cache for replay protection.
type MessageCache struct {
	mu      sync.RWMutex
	seen    map[string]time.Time
	order   []string
	maxSize int
	maxAge  time.Duration
}

func NewMessageCache(maxSize int, maxAge time.Duration) *MessageCache {
	return &MessageCache{
		seen:    make(map[string]time.Time, maxSize),
		order:   make([]string, 0, maxSize),
		maxSize: maxSize,
		maxAge:  maxAge,
	}
}

func (mc *MessageCache) IsSeen(messageID string) bool {
	mc.mu.RLock()
	ts, exists := mc.seen[messageID]
	mc.mu.RUnlock()

	if !exists {
		return false
	}
	if time.Since(ts) > mc.maxAge {
		mc.mu.Lock()
		delete(mc.seen, messageID)
		mc.mu.Unlock()
		return false
	}
	return true
}

func (mc *MessageCache) MarkSeen(messageID string) {
	mc.mu.Lock()
	defer mc.mu.Unlock()

	if _, exists := mc.seen[messageID]; exists {
		return
	}

	// Evict oldest if at capacity
	if len(mc.order) >= mc.maxSize {
		oldest := mc.order[0]
		mc.order = mc.order[1:]
		delete(mc.seen, oldest)
	}

	mc.seen[messageID] = time.Now()
	mc.order = append(mc.order, messageID)
}

// IsWithinWindow checks if a message timestamp is within the acceptable window.
// Allows messages from (now - maxAge) to (now + 30s tolerance).
func (mc *MessageCache) IsWithinWindow(msgTime time.Time) bool {
	now := time.Now()
	earliest := now.Add(-mc.maxAge)
	latest := now.Add(30 * time.Second)
	return !msgTime.Before(earliest) && !msgTime.After(latest)
}

// RateCounter tracks message counts for a single peer within a time window.
type RateCounter struct {
	Messages    int
	Queries     int
	WindowStart time.Time
	Throttled   bool
	ThrottleEnd time.Time
}

// PeerRateLimiter enforces per-peer message rate limits.
type PeerRateLimiter struct {
	mu               sync.RWMutex
	counters         map[string]*RateCounter
	maxMessages      int
	windowDuration   time.Duration
	throttleDuration time.Duration
	queryLimit       int
}

func NewPeerRateLimiter(maxMessages int, windowDuration, throttleDuration time.Duration) *PeerRateLimiter {
	return &PeerRateLimiter{
		counters:         make(map[string]*RateCounter),
		maxMessages:      maxMessages,
		windowDuration:   windowDuration,
		throttleDuration: throttleDuration,
		queryLimit:       10,
	}
}

func (prl *PeerRateLimiter) SetQueryLimit(limit int) {
	prl.mu.Lock()
	defer prl.mu.Unlock()
	prl.queryLimit = limit
}

func (prl *PeerRateLimiter) getOrCreateCounter(peerID string) *RateCounter {
	counter, exists := prl.counters[peerID]
	if !exists {
		counter = &RateCounter{
			WindowStart: time.Now(),
		}
		prl.counters[peerID] = counter
	}

	// Reset window if expired
	if time.Since(counter.WindowStart) > prl.windowDuration {
		counter.Messages = 0
		counter.Queries = 0
		counter.WindowStart = time.Now()
		counter.Throttled = false
	}

	// Clear throttle if expired
	if counter.Throttled && time.Now().After(counter.ThrottleEnd) {
		counter.Throttled = false
		counter.Messages = 0
		counter.Queries = 0
		counter.WindowStart = time.Now()
	}

	return counter
}

func (prl *PeerRateLimiter) AllowMessage(peerID string) bool {
	prl.mu.Lock()
	defer prl.mu.Unlock()

	counter := prl.getOrCreateCounter(peerID)

	if counter.Throttled {
		return false
	}

	counter.Messages++
	if counter.Messages > prl.maxMessages {
		counter.Throttled = true
		counter.ThrottleEnd = time.Now().Add(prl.throttleDuration)
		return false
	}
	return true
}

func (prl *PeerRateLimiter) AllowQuery(peerID string) bool {
	prl.mu.Lock()
	defer prl.mu.Unlock()

	counter := prl.getOrCreateCounter(peerID)

	if counter.Throttled {
		return false
	}

	counter.Queries++
	if counter.Queries > prl.queryLimit {
		return false
	}
	return true
}

func (prl *PeerRateLimiter) IsThrottled(peerID string) bool {
	prl.mu.RLock()
	defer prl.mu.RUnlock()

	counter, exists := prl.counters[peerID]
	if !exists {
		return false
	}
	if counter.Throttled && time.Now().After(counter.ThrottleEnd) {
		return false
	}
	return counter.Throttled
}

func (prl *PeerRateLimiter) ThrottledPeerCount() int {
	prl.mu.RLock()
	defer prl.mu.RUnlock()

	count := 0
	now := time.Now()
	for _, counter := range prl.counters {
		if counter.Throttled && now.Before(counter.ThrottleEnd) {
			count++
		}
	}
	return count
}
