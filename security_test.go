package main

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"
)

type SecuritySuite struct {
	suite.Suite
}

func (s *SecuritySuite) TestMessageCache_SeenAndExpiry() {
	cache := NewMessageCache(100, 100*time.Millisecond)

	seen := cache.IsSeen("msg-1")
	s.False(seen)

	cache.MarkSeen("msg-1")
	seen = cache.IsSeen("msg-1")
	s.True(seen)

	// Wait for expiry
	time.Sleep(150 * time.Millisecond)
	seen = cache.IsSeen("msg-1")
	s.False(seen)
}

func (s *SecuritySuite) TestMessageCache_MaxSize() {
	cache := NewMessageCache(3, 5*time.Minute)

	cache.MarkSeen("msg-1")
	cache.MarkSeen("msg-2")
	cache.MarkSeen("msg-3")
	cache.MarkSeen("msg-4") // Should evict msg-1

	s.False(cache.IsSeen("msg-1"))
	s.True(cache.IsSeen("msg-4"))
}

func (s *SecuritySuite) TestMessageCache_TimestampValidation() {
	cache := NewMessageCache(100, 5*time.Minute)

	// Message within window
	valid := cache.IsWithinWindow(time.Now())
	s.True(valid)

	// Message too old
	old := cache.IsWithinWindow(time.Now().Add(-10 * time.Minute))
	s.False(old)

	// Message from the future (reasonable tolerance: 30s)
	future := cache.IsWithinWindow(time.Now().Add(20 * time.Second))
	s.True(future)

	// Message too far in the future
	farFuture := cache.IsWithinWindow(time.Now().Add(5 * time.Minute))
	s.False(farFuture)
}

func (s *SecuritySuite) TestPeerRateLimiter_AllowsUnderLimit() {
	limiter := NewPeerRateLimiter(5, 1*time.Minute, 10*time.Second)

	for i := 0; i < 5; i++ {
		allowed := limiter.AllowMessage("peer-1")
		s.True(allowed, "message %d should be allowed", i)
	}
}

func (s *SecuritySuite) TestPeerRateLimiter_BlocksOverLimit() {
	limiter := NewPeerRateLimiter(3, 1*time.Minute, 10*time.Second)

	limiter.AllowMessage("peer-1")
	limiter.AllowMessage("peer-1")
	limiter.AllowMessage("peer-1")

	allowed := limiter.AllowMessage("peer-1")
	s.False(allowed)

	throttled := limiter.IsThrottled("peer-1")
	s.True(throttled)
}

func (s *SecuritySuite) TestPeerRateLimiter_WindowReset() {
	limiter := NewPeerRateLimiter(2, 100*time.Millisecond, 10*time.Millisecond)

	limiter.AllowMessage("peer-1")
	limiter.AllowMessage("peer-1")

	// Over limit
	allowed := limiter.AllowMessage("peer-1")
	s.False(allowed)

	// Wait for window + throttle to expire
	time.Sleep(120 * time.Millisecond)

	allowed = limiter.AllowMessage("peer-1")
	s.True(allowed)
}

func (s *SecuritySuite) TestPeerRateLimiter_QueryRateLimit() {
	limiter := NewPeerRateLimiter(100, 1*time.Minute, 10*time.Second)
	limiter.SetQueryLimit(2)

	s.True(limiter.AllowQuery("peer-1"))
	s.True(limiter.AllowQuery("peer-1"))
	s.False(limiter.AllowQuery("peer-1"))
}

func (s *SecuritySuite) TestPeerRateLimiter_IndependentPeers() {
	limiter := NewPeerRateLimiter(2, 1*time.Minute, 10*time.Second)

	limiter.AllowMessage("peer-1")
	limiter.AllowMessage("peer-1")
	limiter.AllowMessage("peer-1") // Blocked

	allowed := limiter.AllowMessage("peer-2")
	s.True(allowed, "peer-2 should be independent of peer-1")
}

func (s *SecuritySuite) TestHealthStatus_JSON() {
	tmpDir := s.T().TempDir()
	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	defer store.Close()

	ctx := context.Background()

	health, err := BuildHealthStatus(ctx, store, "12D3KooWABC", "test-proj", time.Now())
	s.Require().NoError(err)
	s.Equal("12D3KooWABC", health.PeerID)
	s.Equal(0, health.ConnectedPeers)
	s.Equal(0, health.OutboxDepth)
}

func TestSecuritySuite(t *testing.T) {
	suite.Run(t, new(SecuritySuite))
}
