# P2P Network Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add P2P networking to the inventory tool so independent nodes can discover each other, exchange signals/CRs/queries/traces, hold governance votes, and file challenges — all without a central server.

**Architecture:** Flat package at root. Engine orchestrates Store (SQLite) + StateMachine + SignalPropagator. CLI (Cobra) and MCP server both call Engine. DI via pumped-go. Two zerolog instances: agent (stdout) for data, system (stderr) for diagnostics. libp2p provides transport, encryption, and discovery. Protobuf defines the wire protocol. Store-and-forward outbox for offline peers.

**Tech Stack:** Go 1.25, SQLite (go-sqlite3), Cobra, mcp-go (v0.45.0), pumped-go (v0.1.3), zerolog, testify, libp2p, protobuf, yaml.v3

**Depends on:** Phase 2 implementation (must be completed first — adds external_ref, query, sweep, reconcile, trace up/down, dual zerolog)

---

## Task 1: Add Dependencies (libp2p, protobuf, yaml)

**Files:**
- Modify: `go.mod`

**Step 1: Add libp2p and DHT**

Run:
```bash
cd /Users/cuongtran/Desktop/repo/my-inventory && go get github.com/libp2p/go-libp2p@latest
cd /Users/cuongtran/Desktop/repo/my-inventory && go get github.com/libp2p/go-libp2p-kad-dht@latest
```

**Step 2: Add protobuf runtime**

Run:
```bash
cd /Users/cuongtran/Desktop/repo/my-inventory && go get google.golang.org/protobuf@latest
```

**Step 3: Add yaml.v3 (already indirect, promote to direct)**

Run:
```bash
cd /Users/cuongtran/Desktop/repo/my-inventory && go get gopkg.in/yaml.v3@v3.0.1
```

**Step 4: Install protoc-gen-go (if not present)**

Run:
```bash
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
```

**Step 5: Tidy**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go mod tidy`

**Step 6: Verify compilation**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go build ./...`
Expected: No errors.

**Step 7: Commit**

```bash
git add go.mod go.sum
git commit -m "deps: add libp2p, protobuf, yaml.v3 for P2P networking"
```

---

## Task 2: YAML Config Parsing

**Files:**
- Create: `config.go`

**Step 1: Write failing test**

Create `config_test.go`:

```go
package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stretchr/testify/suite"
)

type ConfigSuite struct {
	suite.Suite
	tmpDir string
}

func (s *ConfigSuite) SetupTest() {
	s.tmpDir = s.T().TempDir()
}

func (s *ConfigSuite) TestDefaultConfig() {
	cfg := DefaultNodeConfig()

	// Node defaults
	s.Equal("", cfg.Node.Name)
	s.Equal(Vertical(""), cfg.Node.Vertical)
	s.Equal("", cfg.Node.Project)
	s.Equal("", cfg.Node.Owner)
	s.False(cfg.Node.IsAI)
	s.Equal(PermissionNormal, cfg.Node.PermissionMode)

	// Database defaults
	s.Contains(cfg.Database.Path, "inventory.db")

	// Network defaults
	s.Equal(9090, cfg.Network.ListenPort)
	s.Empty(cfg.Network.BootstrapPeers)
	s.True(cfg.Network.EnableMDNS)
	s.True(cfg.Network.EnableDHT)

	// Security defaults
	s.Equal(100, cfg.Security.MaxMessageRate)
	s.Equal(1048576, cfg.Security.MaxEnvelopeSize)
	s.Equal(5*time.Minute, cfg.Security.ReplayWindow)
	s.Equal(10000, cfg.Security.SeenCacheSize)
	s.Equal(10, cfg.Security.QueryRateLimit)
	s.Equal(5*time.Minute, cfg.Security.ThrottleDuration)
	s.True(cfg.Security.Membership.RequireApproval)
	s.Equal(48*time.Hour, cfg.Security.Membership.ApprovalTimeout)

	// Challenge defaults
	s.False(cfg.Challenges.AutoChallenge)
	s.Equal(48*time.Hour, cfg.Challenges.StaleThreshold)
	s.Equal(24*time.Hour, cfg.Challenges.Cooldown)

	// Logging defaults
	s.Equal("info", cfg.Logging.AgentLevel)
	s.Equal("info", cfg.Logging.SystemLevel)

	// Observability defaults
	s.Equal(30*time.Second, cfg.Observability.HealthInterval)
	s.Equal(50, cfg.Observability.AlertOutboxThreshold)
	s.Equal(-5, cfg.Observability.AlertReputationThreshold)
	s.Equal(2*time.Hour, cfg.Observability.AlertDeadlineWarning)
}

func (s *ConfigSuite) TestWriteAndLoadConfig() {
	cfgPath := filepath.Join(s.tmpDir, "config.yaml")
	cfg := DefaultNodeConfig()
	cfg.Node.Name = "test-node"
	cfg.Node.Vertical = VerticalDev
	cfg.Node.Project = "test-proj"
	cfg.Node.Owner = "tester"
	cfg.Node.IsAI = false
	cfg.Node.PermissionMode = PermissionAutonomous
	cfg.Database.Path = filepath.Join(s.tmpDir, "inventory.db")

	err := WriteNodeConfig(cfgPath, cfg)
	require.NoError(s.T(), err)

	loaded, err := LoadNodeConfig(cfgPath)
	require.NoError(s.T(), err)
	assert.Equal(s.T(), "test-node", loaded.Node.Name)
	assert.Equal(s.T(), VerticalDev, loaded.Node.Vertical)
	assert.Equal(s.T(), "test-proj", loaded.Node.Project)
	assert.Equal(s.T(), "tester", loaded.Node.Owner)
	assert.False(s.T(), loaded.Node.IsAI)
	assert.Equal(s.T(), PermissionAutonomous, loaded.Node.PermissionMode)
	assert.Equal(s.T(), 9090, loaded.Network.ListenPort)
}

func (s *ConfigSuite) TestWriteAndLoadAINodeConfig() {
	cfgPath := filepath.Join(s.tmpDir, "config.yaml")
	cfg := DefaultNodeConfig()
	cfg.Node.Name = "claude-qa-agent"
	cfg.Node.Vertical = VerticalQA
	cfg.Node.Project = "clinic-checkin"
	cfg.Node.Owner = "claude"
	cfg.Node.IsAI = true
	cfg.Node.PermissionMode = PermissionAutonomous
	cfg.Challenges.AutoChallenge = true
	cfg.Challenges.StaleThreshold = 24 * time.Hour

	err := WriteNodeConfig(cfgPath, cfg)
	require.NoError(s.T(), err)

	loaded, err := LoadNodeConfig(cfgPath)
	require.NoError(s.T(), err)
	assert.True(s.T(), loaded.Node.IsAI)
	assert.Equal(s.T(), PermissionAutonomous, loaded.Node.PermissionMode)
	assert.True(s.T(), loaded.Challenges.AutoChallenge)
	assert.Equal(s.T(), 24*time.Hour, loaded.Challenges.StaleThreshold)
}

func (s *ConfigSuite) TestLoadMissingFileReturnsError() {
	_, err := LoadNodeConfig(filepath.Join(s.tmpDir, "nonexistent.yaml"))
	s.Error(err)
}

func (s *ConfigSuite) TestInvDirPath() {
	dir := InvDirPath()
	home, _ := os.UserHomeDir()
	s.Equal(filepath.Join(home, ".inv"), dir)
}

func TestConfigSuite(t *testing.T) {
	suite.Run(t, new(ConfigSuite))
}
```

**Step 2: Run failing test**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestConfigSuite -v ./...`
Expected: Compilation errors — `DefaultNodeConfig`, `LoadNodeConfig`, `WriteNodeConfig`, `InvDirPath` undefined.

**Step 3: Implement config.go**

Create `config.go`:

```go
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"gopkg.in/yaml.v3"
)

type PermissionMode string

const (
	PermissionNormal     PermissionMode = "normal"      // AI suggests, human confirms every action
	PermissionAutonomous PermissionMode = "autonomous"   // AI acts freely on own node, governance requires human
)

type NodeConfigNode struct {
	Name           string         `yaml:"name"`
	Vertical       Vertical       `yaml:"vertical"`
	Project        string         `yaml:"project"`
	Owner          string         `yaml:"owner"`
	IsAI           bool           `yaml:"is_ai"`
	PermissionMode PermissionMode `yaml:"permission_mode"`
}

type NodeConfigDatabase struct {
	Path string `yaml:"path"`
}

type NodeConfigNetwork struct {
	ListenPort     int      `yaml:"listen_port"`
	BootstrapPeers []string `yaml:"bootstrap_peers"`
	EnableMDNS     bool     `yaml:"enable_mdns"`
	EnableDHT      bool     `yaml:"enable_dht"`
}

type NodeConfigMembership struct {
	RequireApproval bool          `yaml:"require_approval"`
	ApprovalTimeout time.Duration `yaml:"approval_timeout"`
}

type NodeConfigSecurity struct {
	MaxMessageRate   int                  `yaml:"max_message_rate"`
	MaxEnvelopeSize  int                  `yaml:"max_envelope_size"`
	ReplayWindow     time.Duration        `yaml:"replay_window"`
	SeenCacheSize    int                  `yaml:"seen_cache_size"`
	QueryRateLimit   int                  `yaml:"query_rate_limit"`
	ThrottleDuration time.Duration        `yaml:"throttle_duration"`
	Membership       NodeConfigMembership `yaml:"membership"`
}

type NodeConfigChallenges struct {
	AutoChallenge  bool          `yaml:"auto_challenge"`
	StaleThreshold time.Duration `yaml:"stale_threshold"`
	Cooldown       time.Duration `yaml:"cooldown"`
}

type NodeConfigLogging struct {
	AgentLevel  string `yaml:"agent_level"`
	SystemLevel string `yaml:"system_level"`
}

type NodeConfigObservability struct {
	HealthInterval            time.Duration `yaml:"health_interval"`
	AlertOutboxThreshold      int           `yaml:"alert_outbox_threshold"`
	AlertReputationThreshold  int           `yaml:"alert_reputation_threshold"`
	AlertDeadlineWarning      time.Duration `yaml:"alert_deadline_warning"`
}

type NodeConfig struct {
	Node          NodeConfigNode          `yaml:"node"`
	Database      NodeConfigDatabase      `yaml:"database"`
	Network       NodeConfigNetwork       `yaml:"network"`
	Security      NodeConfigSecurity      `yaml:"security"`
	Challenges    NodeConfigChallenges    `yaml:"challenges"`
	Logging       NodeConfigLogging       `yaml:"logging"`
	Observability NodeConfigObservability  `yaml:"observability"`
}

func DefaultNodeConfig() *NodeConfig {
	return &NodeConfig{
		Node: NodeConfigNode{
			PermissionMode: PermissionNormal,
		},
		Database: NodeConfigDatabase{
			Path: filepath.Join(InvDirPath(), "inventory.db"),
		},
		Network: NodeConfigNetwork{
			ListenPort:     9090,
			BootstrapPeers: []string{},
			EnableMDNS:     true,
			EnableDHT:      true,
		},
		Security: NodeConfigSecurity{
			MaxMessageRate:   100,
			MaxEnvelopeSize:  1048576,
			ReplayWindow:     5 * time.Minute,
			SeenCacheSize:    10000,
			QueryRateLimit:   10,
			ThrottleDuration: 5 * time.Minute,
			Membership: NodeConfigMembership{
				RequireApproval: true,
				ApprovalTimeout: 48 * time.Hour,
			},
		},
		Challenges: NodeConfigChallenges{
			AutoChallenge:  false,
			StaleThreshold: 48 * time.Hour,
			Cooldown:       24 * time.Hour,
		},
		Logging: NodeConfigLogging{
			AgentLevel:  "info",
			SystemLevel: "info",
		},
		Observability: NodeConfigObservability{
			HealthInterval:           30 * time.Second,
			AlertOutboxThreshold:     50,
			AlertReputationThreshold: -5,
			AlertDeadlineWarning:     2 * time.Hour,
		},
	}
}

func InvDirPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ".inv"
	}
	return filepath.Join(home, ".inv")
}

func LoadNodeConfig(path string) (*NodeConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	cfg := DefaultNodeConfig()
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	return cfg, nil
}

func WriteNodeConfig(path string, cfg *NodeConfig) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	return nil
}

func EnsureInvDir() (string, error) {
	dir := InvDirPath()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("create inv dir: %w", err)
	}
	return dir, nil
}
```

**Step 4: Run tests**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestConfigSuite -v ./...`
Expected: All PASS.

**Step 5: Commit**

```bash
git add config.go config_test.go
git commit -m "feat: add YAML config parsing with defaults for P2P node configuration"
```

---

## Task 3: Identity Management (Ed25519 Keypair)

**Files:**
- Create: `identity.go`
- Create: `identity_test.go`

**Step 1: Write failing test**

Create `identity_test.go`:

```go
package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/suite"
)

type IdentitySuite struct {
	suite.Suite
	tmpDir string
}

func (s *IdentitySuite) SetupTest() {
	s.tmpDir = s.T().TempDir()
}

func (s *IdentitySuite) TestGenerateIdentity() {
	ident, err := GenerateIdentity()
	s.Require().NoError(err)
	s.NotNil(ident.PrivKey)
	s.NotEmpty(ident.PeerID)
	s.True(len(ident.PeerID.String()) > 10)
}

func (s *IdentitySuite) TestSaveAndLoadIdentity() {
	keyPath := filepath.Join(s.tmpDir, "identity.key")
	peerIDPath := filepath.Join(s.tmpDir, "peer_id")

	ident, err := GenerateIdentity()
	s.Require().NoError(err)

	err = SaveIdentity(ident, keyPath, peerIDPath)
	s.Require().NoError(err)

	// Verify key file has restricted permissions
	info, err := os.Stat(keyPath)
	s.Require().NoError(err)
	s.Equal(os.FileMode(0600), info.Mode().Perm())

	// Load it back
	loaded, err := LoadIdentity(keyPath)
	s.Require().NoError(err)
	s.Equal(ident.PeerID, loaded.PeerID)

	// Verify peer_id file was written
	peerIDData, err := os.ReadFile(peerIDPath)
	s.Require().NoError(err)
	s.Equal(ident.PeerID.String(), string(peerIDData))
}

func (s *IdentitySuite) TestLoadOrCreateIdentity_Creates() {
	keyPath := filepath.Join(s.tmpDir, "identity.key")
	peerIDPath := filepath.Join(s.tmpDir, "peer_id")

	ident, err := LoadOrCreateIdentity(keyPath, peerIDPath)
	s.Require().NoError(err)
	s.NotEmpty(ident.PeerID)

	// File should now exist
	_, err = os.Stat(keyPath)
	s.NoError(err)
}

func (s *IdentitySuite) TestLoadOrCreateIdentity_Loads() {
	keyPath := filepath.Join(s.tmpDir, "identity.key")
	peerIDPath := filepath.Join(s.tmpDir, "peer_id")

	// Create first
	ident1, err := LoadOrCreateIdentity(keyPath, peerIDPath)
	s.Require().NoError(err)

	// Load same
	ident2, err := LoadOrCreateIdentity(keyPath, peerIDPath)
	s.Require().NoError(err)

	s.Equal(ident1.PeerID, ident2.PeerID)
}

func TestIdentitySuite(t *testing.T) {
	suite.Run(t, new(IdentitySuite))
}
```

**Step 2: Run failing test**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestIdentitySuite -v ./...`
Expected: Compilation errors — `GenerateIdentity`, `SaveIdentity`, `LoadIdentity`, `LoadOrCreateIdentity` undefined.

**Step 3: Implement identity.go**

Create `identity.go`:

```go
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
)

type NodeIdentity struct {
	PrivKey crypto.PrivKey
	PeerID  peer.ID
}

func GenerateIdentity() (*NodeIdentity, error) {
	privKey, _, err := crypto.GenerateEd25519Key(nil)
	if err != nil {
		return nil, fmt.Errorf("generate ed25519 key: %w", err)
	}
	peerID, err := peer.IDFromPrivateKey(privKey)
	if err != nil {
		return nil, fmt.Errorf("derive peer ID: %w", err)
	}
	return &NodeIdentity{PrivKey: privKey, PeerID: peerID}, nil
}

func SaveIdentity(ident *NodeIdentity, keyPath string, peerIDPath string) error {
	dir := filepath.Dir(keyPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create identity dir: %w", err)
	}

	keyBytes, err := crypto.MarshalPrivateKey(ident.PrivKey)
	if err != nil {
		return fmt.Errorf("marshal private key: %w", err)
	}
	if err := os.WriteFile(keyPath, keyBytes, 0600); err != nil {
		return fmt.Errorf("write identity key: %w", err)
	}

	if err := os.WriteFile(peerIDPath, []byte(ident.PeerID.String()), 0644); err != nil {
		return fmt.Errorf("write peer ID: %w", err)
	}

	return nil
}

func LoadIdentity(keyPath string) (*NodeIdentity, error) {
	keyBytes, err := os.ReadFile(keyPath)
	if err != nil {
		return nil, fmt.Errorf("read identity key: %w", err)
	}

	privKey, err := crypto.UnmarshalPrivateKey(keyBytes)
	if err != nil {
		return nil, fmt.Errorf("unmarshal private key: %w", err)
	}

	peerID, err := peer.IDFromPrivateKey(privKey)
	if err != nil {
		return nil, fmt.Errorf("derive peer ID: %w", err)
	}

	return &NodeIdentity{PrivKey: privKey, PeerID: peerID}, nil
}

func LoadOrCreateIdentity(keyPath string, peerIDPath string) (*NodeIdentity, error) {
	if _, err := os.Stat(keyPath); err == nil {
		return LoadIdentity(keyPath)
	}

	ident, err := GenerateIdentity()
	if err != nil {
		return nil, err
	}

	if err := SaveIdentity(ident, keyPath, peerIDPath); err != nil {
		return nil, err
	}

	return ident, nil
}
```

**Step 4: Run tests**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestIdentitySuite -v ./...`
Expected: All PASS.

**Step 5: Commit**

```bash
git add identity.go identity_test.go
git commit -m "feat: add Ed25519 identity management with save/load/generate"
```

---

## Task 4: Protobuf Definitions

**Files:**
- Create: `proto/inv.proto`
- Create: `proto/inv.pb.go` (generated)

**Step 1: Create proto directory**

Run: `mkdir -p /Users/cuongtran/Desktop/repo/my-inventory/proto`

**Step 2: Write protobuf definitions**

Create `proto/inv.proto`:

```protobuf
syntax = "proto3";
package inv;
option go_package = "github.com/cuongtran/my-inventory/proto";

import "google/protobuf/timestamp.proto";

message Envelope {
  string message_id = 1;
  string from_peer = 2;
  string to_peer = 3;
  google.protobuf.Timestamp timestamp = 4;

  oneof payload {
    SignalChange signal_change = 10;
    SignalSweep signal_sweep = 11;
    QueryAsk query_ask = 14;
    QueryRespond query_respond = 15;
    TraceResolveRequest trace_resolve_req = 16;
    TraceResolveResponse trace_resolve_resp = 17;
    Ack ack = 20;
    Error error = 21;
    ProposalCreate proposal_create = 22;
    ProposalVote proposal_vote = 23;
    ProposalResult proposal_result = 24;
    TallyRequest tally_request = 25;
    PeerHandshake peer_handshake = 26;
    ChallengeCreate challenge_create = 30;
    ChallengeResponse challenge_response = 31;
    ChallengeVote challenge_vote = 32;
    ChallengeResult challenge_result = 33;
  }
}

message SignalChange {
  string source_item_id = 1;
  string source_node_id = 2;
  string target_item_id = 3;
  string reason = 4;
}

message SignalSweep {
  string external_ref = 1;
  string source_node_id = 2;
  repeated string matched_item_ids = 3;
}

message QueryAsk {
  string query_id = 1;
  string asker_id = 2;
  string question = 3;
  string context = 4;
}

message QueryRespond {
  string query_id = 1;
  string responder_id = 2;
  string answer = 3;
  bool is_ai = 4;
}

message TraceResolveRequest {
  string item_id = 1;
}

message TraceResolveResponse {
  string item_id = 1;
  string kind = 2;
  string title = 3;
  string status = 4;
  string node_id = 5;
  string vertical = 6;
  bool found = 7;
}

message Ack {
  string ref_message_id = 1;
}

message Error {
  string ref_message_id = 1;
  string code = 2;
  string message = 3;
}

message PeerHandshake {
  string peer_id = 1;
  string node_id = 2;
  string name = 3;
  string vertical = 4;
  string project = 5;
  string owner = 6;
  bool is_ai = 7;
}

message ProposalCreate {
  string proposal_id = 1;
  string kind = 2;
  string title = 3;
  string description = 4;
  string proposer_peer = 5;
  string owner_peer = 6;
  repeated string affected_item_ids = 7;
  google.protobuf.Timestamp deadline = 8;
}

message ProposalVote {
  string proposal_id = 1;
  string voter_peer = 2;
  string voter_id = 3;
  string decision = 4;
  string reason = 5;
  bool is_ai = 6;
}

message ProposalResult {
  string proposal_id = 1;
  string decision = 2;
  int32 votes_for = 3;
  int32 votes_against = 4;
  int32 total_eligible = 5;
  bool owner_vetoed = 6;
}

message TallyRequest {
  string proposal_id = 1;
}

message ChallengeCreate {
  string challenge_id = 1;
  string kind = 2;
  string challenger_peer = 3;
  string challenged_peer = 4;
  string target_item_id = 5;
  string target_trace_id = 6;
  string reason = 7;
  string evidence = 8;
  int64 deadline_seconds = 9;
}

message ChallengeResponse {
  string challenge_id = 1;
  string evidence = 2;
  string justification = 3;
}

message ChallengeVote {
  string challenge_id = 1;
  string voter_peer = 2;
  string decision = 3;
  string reason = 4;
  bool is_ai = 5;
}

message ChallengeResult {
  string challenge_id = 1;
  string outcome = 2;
  int32 votes_sustain = 3;
  int32 votes_dismiss = 4;
  string penalty_applied = 5;
}
```

**Step 3: Generate Go code**

Run:
```bash
cd /Users/cuongtran/Desktop/repo/my-inventory && protoc --go_out=. --go_opt=paths=source_relative proto/inv.proto
```

If `protoc` is not installed:
```bash
brew install protobuf
```

Then re-run the protoc command.

**Step 4: Verify generated code compiles**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go build ./...`
Expected: No errors.

**Step 5: Commit**

```bash
git add proto/
git commit -m "feat: add protobuf definitions for all P2P message types"
```

---

## Task 5: Peer + Outbox + Blocklist SQLite Tables

**Files:**
- Modify: `store.go:34-161` (add tables to migrate)
- Modify: `store.go` (append CRUD methods)

**Step 1: Write failing tests**

Append to `store_test.go` (within a new test suite or as standalone test functions following existing pattern):

```go
func TestStore_PeerCRUD(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	p := &Peer{
		PeerID:   "12D3KooWABC",
		NodeID:   "node-1",
		Name:     "dev-node",
		Vertical: VerticalDev,
		Project:  "clinic-checkin",
		Owner:    "cuong",
		IsAI:     false,
		Status:   PeerStatusPending,
		Addrs:    []string{"/ip4/127.0.0.1/tcp/9090"},
	}
	err := s.CreatePeer(ctx, p)
	if err != nil {
		t.Fatalf("create peer: %v", err)
	}

	got, err := s.GetPeer(ctx, "12D3KooWABC")
	if err != nil {
		t.Fatalf("get peer: %v", err)
	}
	if got.Name != "dev-node" {
		t.Errorf("got name %q, want %q", got.Name, "dev-node")
	}
	if got.Status != PeerStatusPending {
		t.Errorf("got status %q, want %q", got.Status, PeerStatusPending)
	}

	err = s.UpdatePeerStatus(ctx, "12D3KooWABC", PeerStatusApproved)
	if err != nil {
		t.Fatalf("update status: %v", err)
	}
	got, _ = s.GetPeer(ctx, "12D3KooWABC")
	if got.Status != PeerStatusApproved {
		t.Errorf("got status %q, want %q", got.Status, PeerStatusApproved)
	}

	peers, err := s.ListPeers(ctx, "clinic-checkin")
	if err != nil {
		t.Fatalf("list peers: %v", err)
	}
	if len(peers) != 1 {
		t.Errorf("got %d peers, want 1", len(peers))
	}

	err = s.UpdatePeerLastSeen(ctx, "12D3KooWABC")
	if err != nil {
		t.Fatalf("update last seen: %v", err)
	}
}

func TestStore_OutboxCRUD(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	msg := &OutboxMessage{
		ToPeer:   "12D3KooWABC",
		Envelope: []byte("test envelope data"),
	}
	err := s.EnqueueOutbox(ctx, msg)
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}

	msgs, err := s.GetPendingOutbox(ctx, "12D3KooWABC", 10)
	if err != nil {
		t.Fatalf("get pending: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("got %d messages, want 1", len(msgs))
	}
	if string(msgs[0].Envelope) != "test envelope data" {
		t.Errorf("got envelope %q, want %q", string(msgs[0].Envelope), "test envelope data")
	}

	err = s.DeleteOutboxMessage(ctx, msgs[0].ID)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}

	msgs, _ = s.GetPendingOutbox(ctx, "12D3KooWABC", 10)
	if len(msgs) != 0 {
		t.Errorf("got %d messages after delete, want 0", len(msgs))
	}
}

func TestStore_OutboxRetryIncrement(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	msg := &OutboxMessage{
		ToPeer:   "12D3KooWABC",
		Envelope: []byte("retry test"),
	}
	err := s.EnqueueOutbox(ctx, msg)
	if err != nil {
		t.Fatalf("enqueue: %v", err)
	}

	msgs, _ := s.GetPendingOutbox(ctx, "12D3KooWABC", 10)
	err = s.IncrementOutboxAttempts(ctx, msgs[0].ID)
	if err != nil {
		t.Fatalf("increment: %v", err)
	}

	msgs, _ = s.GetPendingOutbox(ctx, "12D3KooWABC", 10)
	if msgs[0].Attempts != 1 {
		t.Errorf("got attempts %d, want 1", msgs[0].Attempts)
	}
}

func TestStore_BlocklistCRUD(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	err := s.BlockPeer(ctx, "12D3KooWBAD", "spam", "admin")
	if err != nil {
		t.Fatalf("block: %v", err)
	}

	blocked, err := s.IsBlocked(ctx, "12D3KooWBAD")
	if err != nil {
		t.Fatalf("is blocked: %v", err)
	}
	if !blocked {
		t.Error("expected peer to be blocked")
	}

	blocked, _ = s.IsBlocked(ctx, "12D3KooWGOOD")
	if blocked {
		t.Error("expected peer to not be blocked")
	}

	err = s.UnblockPeer(ctx, "12D3KooWBAD")
	if err != nil {
		t.Fatalf("unblock: %v", err)
	}

	blocked, _ = s.IsBlocked(ctx, "12D3KooWBAD")
	if blocked {
		t.Error("expected peer to be unblocked")
	}
}
```

**Step 2: Run failing test**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run "TestStore_Peer|TestStore_Outbox|TestStore_Blocklist" -v ./...`
Expected: Compilation errors — `Peer`, `PeerStatusPending`, `OutboxMessage`, `EnqueueOutbox`, `BlockPeer`, etc. undefined.

**Step 3: Add Peer, OutboxMessage types to network.go**

Append to `network.go` (after line 155):

```go
type PeerStatus string

const (
	PeerStatusPending  PeerStatus = "pending"
	PeerStatusApproved PeerStatus = "approved"
	PeerStatusBlocked  PeerStatus = "blocked"
)

type Peer struct {
	PeerID   string     `json:"peer_id"`
	NodeID   string     `json:"node_id"`
	Name     string     `json:"name"`
	Vertical Vertical   `json:"vertical"`
	Project  string     `json:"project"`
	Owner    string     `json:"owner"`
	IsAI     bool       `json:"is_ai"`
	Status   PeerStatus `json:"status"`
	LastSeen *time.Time `json:"last_seen,omitempty"`
	Addrs    []string   `json:"addrs"`
}

type OutboxMessage struct {
	ID        string    `json:"id"`
	ToPeer    string    `json:"to_peer"`
	Envelope  []byte    `json:"envelope"`
	Attempts  int       `json:"attempts"`
	CreatedAt time.Time `json:"created_at"`
	NextRetry time.Time `json:"next_retry"`
}
```

**Step 4: Add tables to store.go migrate()**

In `store.go:34-161`, add inside the schema string, after the `reconciliation_log` table (before the CREATE INDEX statements):

```sql
CREATE TABLE IF NOT EXISTS peers (
    peer_id     TEXT PRIMARY KEY,
    node_id     TEXT NOT NULL,
    name        TEXT NOT NULL,
    vertical    TEXT NOT NULL,
    project     TEXT NOT NULL,
    owner       TEXT NOT NULL,
    is_ai       INTEGER DEFAULT 0,
    status      TEXT DEFAULT 'pending',
    last_seen   DATETIME,
    addrs       TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS outbox (
    id          TEXT PRIMARY KEY,
    to_peer     TEXT NOT NULL,
    envelope    BLOB NOT NULL,
    attempts    INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    next_retry  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS peer_blocklist (
    peer_id     TEXT PRIMARY KEY,
    reason      TEXT NOT NULL,
    blocked_by  TEXT NOT NULL,
    blocked_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_outbox_peer ON outbox(to_peer, next_retry);
CREATE INDEX IF NOT EXISTS idx_peers_project ON peers(project);
```

**Step 5: Add CRUD methods to store.go**

Append to `store.go`:

```go
func (s *Store) CreatePeer(ctx context.Context, p *Peer) error {
	addrs, _ := json.Marshal(p.Addrs)
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO peers (peer_id, node_id, name, vertical, project, owner, is_ai, status, addrs)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(peer_id) DO UPDATE SET
		   node_id = excluded.node_id, name = excluded.name, vertical = excluded.vertical,
		   project = excluded.project, owner = excluded.owner, is_ai = excluded.is_ai,
		   addrs = excluded.addrs`,
		p.PeerID, p.NodeID, p.Name, p.Vertical, p.Project, p.Owner, p.IsAI, p.Status, string(addrs))
	return err
}

func (s *Store) GetPeer(ctx context.Context, peerID string) (*Peer, error) {
	p := &Peer{}
	var lastSeen sql.NullTime
	var addrs string
	err := s.db.QueryRowContext(ctx,
		`SELECT peer_id, node_id, name, vertical, project, owner, is_ai, status, last_seen, addrs
		 FROM peers WHERE peer_id = ?`, peerID).
		Scan(&p.PeerID, &p.NodeID, &p.Name, &p.Vertical, &p.Project, &p.Owner, &p.IsAI, &p.Status, &lastSeen, &addrs)
	if err != nil {
		return nil, err
	}
	if lastSeen.Valid {
		p.LastSeen = &lastSeen.Time
	}
	_ = json.Unmarshal([]byte(addrs), &p.Addrs)
	return p, nil
}

func (s *Store) ListPeers(ctx context.Context, project string) ([]Peer, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT peer_id, node_id, name, vertical, project, owner, is_ai, status, last_seen, addrs
		 FROM peers WHERE project = ? ORDER BY name`, project)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var peers []Peer
	for rows.Next() {
		var p Peer
		var lastSeen sql.NullTime
		var addrs string
		if err := rows.Scan(&p.PeerID, &p.NodeID, &p.Name, &p.Vertical, &p.Project, &p.Owner, &p.IsAI, &p.Status, &lastSeen, &addrs); err != nil {
			return nil, err
		}
		if lastSeen.Valid {
			p.LastSeen = &lastSeen.Time
		}
		_ = json.Unmarshal([]byte(addrs), &p.Addrs)
		peers = append(peers, p)
	}
	return peers, rows.Err()
}

func (s *Store) UpdatePeerStatus(ctx context.Context, peerID string, status PeerStatus) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE peers SET status = ? WHERE peer_id = ?`, status, peerID)
	return err
}

func (s *Store) UpdatePeerLastSeen(ctx context.Context, peerID string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE peers SET last_seen = ? WHERE peer_id = ?`, time.Now(), peerID)
	return err
}

func (s *Store) DeletePeer(ctx context.Context, peerID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM peers WHERE peer_id = ?`, peerID)
	return err
}

func (s *Store) EnqueueOutbox(ctx context.Context, msg *OutboxMessage) error {
	if msg.ID == "" {
		msg.ID = uuid.New().String()
	}
	msg.CreatedAt = time.Now()
	msg.NextRetry = time.Now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO outbox (id, to_peer, envelope, attempts, created_at, next_retry)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		msg.ID, msg.ToPeer, msg.Envelope, msg.Attempts, msg.CreatedAt, msg.NextRetry)
	return err
}

func (s *Store) GetPendingOutbox(ctx context.Context, peerID string, limit int) ([]OutboxMessage, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, to_peer, envelope, attempts, created_at, next_retry
		 FROM outbox WHERE to_peer = ? AND next_retry <= ? ORDER BY created_at LIMIT ?`,
		peerID, time.Now(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var msgs []OutboxMessage
	for rows.Next() {
		var m OutboxMessage
		if err := rows.Scan(&m.ID, &m.ToPeer, &m.Envelope, &m.Attempts, &m.CreatedAt, &m.NextRetry); err != nil {
			return nil, err
		}
		msgs = append(msgs, m)
	}
	return msgs, rows.Err()
}

func (s *Store) GetAllPendingOutbox(ctx context.Context, limit int) ([]OutboxMessage, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, to_peer, envelope, attempts, created_at, next_retry
		 FROM outbox WHERE next_retry <= ? ORDER BY created_at LIMIT ?`,
		time.Now(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var msgs []OutboxMessage
	for rows.Next() {
		var m OutboxMessage
		if err := rows.Scan(&m.ID, &m.ToPeer, &m.Envelope, &m.Attempts, &m.CreatedAt, &m.NextRetry); err != nil {
			return nil, err
		}
		msgs = append(msgs, m)
	}
	return msgs, rows.Err()
}

func (s *Store) IncrementOutboxAttempts(ctx context.Context, msgID string) error {
	// Exponential backoff: next_retry = now + 2^attempts * 30 seconds
	_, err := s.db.ExecContext(ctx,
		`UPDATE outbox SET attempts = attempts + 1,
		 next_retry = datetime('now', '+' || CAST(POWER(2, attempts) * 30 AS INTEGER) || ' seconds')
		 WHERE id = ?`, msgID)
	return err
}

func (s *Store) DeleteOutboxMessage(ctx context.Context, msgID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM outbox WHERE id = ?`, msgID)
	return err
}

func (s *Store) OutboxDepth(ctx context.Context) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM outbox`).Scan(&count)
	return count, err
}

func (s *Store) BlockPeer(ctx context.Context, peerID, reason, blockedBy string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO peer_blocklist (peer_id, reason, blocked_by) VALUES (?, ?, ?)
		 ON CONFLICT(peer_id) DO UPDATE SET reason = excluded.reason, blocked_by = excluded.blocked_by`,
		peerID, reason, blockedBy)
	return err
}

func (s *Store) UnblockPeer(ctx context.Context, peerID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM peer_blocklist WHERE peer_id = ?`, peerID)
	return err
}

func (s *Store) IsBlocked(ctx context.Context, peerID string) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM peer_blocklist WHERE peer_id = ?`, peerID).Scan(&count)
	return count > 0, err
}
```

**Step 6: Run tests**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run "TestStore_Peer|TestStore_Outbox|TestStore_Blocklist" -v ./...`
Expected: All PASS.

**Step 7: Commit**

```bash
git add network.go store.go store_test.go
git commit -m "feat: add peers, outbox, blocklist tables with CRUD methods"
```

---

## Task 6: Proposal + Vote Tables

**Files:**
- Modify: `network.go` (add Proposal, ProposalKind, ProposalStatus, TallyResult types)
- Modify: `store.go` (add proposals, proposal_votes tables + CRUD)
- Modify: `store_test.go` (add tests)

**Step 1: Write failing tests**

Append to `store_test.go`:

```go
func TestStore_ProposalCRUD(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	deadline := time.Now().Add(24 * time.Hour)
	prop := &Proposal{
		Kind:          ProposalCR,
		Title:         "Switch to WebSocket",
		Description:   "Replace REST with WebSocket for real-time updates",
		ProposerPeer:  "12D3KooWABC",
		ProposerName:  "cuong",
		OwnerPeer:     "",
		AffectedItems: []string{"item-1", "item-2"},
		Deadline:      deadline,
	}
	err := s.CreateProposal(ctx, prop)
	if err != nil {
		t.Fatalf("create proposal: %v", err)
	}
	if prop.ID == "" {
		t.Fatal("expected proposal ID to be set")
	}

	got, err := s.GetProposal(ctx, prop.ID)
	if err != nil {
		t.Fatalf("get proposal: %v", err)
	}
	if got.Title != "Switch to WebSocket" {
		t.Errorf("got title %q, want %q", got.Title, "Switch to WebSocket")
	}
	if got.Status != ProposalVoting {
		t.Errorf("got status %q, want %q", got.Status, ProposalVoting)
	}
	if len(got.AffectedItems) != 2 {
		t.Errorf("got %d affected items, want 2", len(got.AffectedItems))
	}

	// Cast a vote
	vote := &ProposalVoteRecord{
		ProposalID: prop.ID,
		VoterPeer:  "12D3KooWDEF",
		VoterID:    "voter-1",
		Decision:   "approve",
		Reason:     "looks good",
		IsAI:       false,
	}
	err = s.CreateProposalVote(ctx, vote)
	if err != nil {
		t.Fatalf("create vote: %v", err)
	}

	votes, err := s.GetProposalVotes(ctx, prop.ID)
	if err != nil {
		t.Fatalf("get votes: %v", err)
	}
	if len(votes) != 1 {
		t.Fatalf("got %d votes, want 1", len(votes))
	}
	if votes[0].Decision != "approve" {
		t.Errorf("got decision %q, want %q", votes[0].Decision, "approve")
	}

	// Update proposal status
	err = s.UpdateProposalStatus(ctx, prop.ID, ProposalApproved)
	if err != nil {
		t.Fatalf("update status: %v", err)
	}
	got, _ = s.GetProposal(ctx, prop.ID)
	if got.Status != ProposalApproved {
		t.Errorf("got status %q, want %q", got.Status, ProposalApproved)
	}

	// List proposals
	props, err := s.ListProposals(ctx, ProposalVoting)
	if err != nil {
		t.Fatalf("list proposals: %v", err)
	}
	if len(props) != 0 {
		t.Errorf("got %d voting proposals, want 0 (now approved)", len(props))
	}
}

func TestStore_ProposalVoteUniqueness(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	prop := &Proposal{
		Kind:         ProposalCR,
		Title:        "Test Uniqueness",
		ProposerPeer: "12D3KooWABC",
		ProposerName: "cuong",
		Deadline:     time.Now().Add(24 * time.Hour),
	}
	s.CreateProposal(ctx, prop)

	vote := &ProposalVoteRecord{
		ProposalID: prop.ID,
		VoterPeer:  "12D3KooWDEF",
		VoterID:    "voter-1",
		Decision:   "approve",
	}
	err := s.CreateProposalVote(ctx, vote)
	if err != nil {
		t.Fatalf("first vote: %v", err)
	}

	// Same voter_peer should fail (UNIQUE constraint)
	vote2 := &ProposalVoteRecord{
		ProposalID: prop.ID,
		VoterPeer:  "12D3KooWDEF",
		VoterID:    "voter-1",
		Decision:   "reject",
	}
	err = s.CreateProposalVote(ctx, vote2)
	if err == nil {
		t.Error("expected error for duplicate vote from same peer")
	}
}
```

**Step 2: Run failing test**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestStore_Proposal -v ./...`
Expected: Compilation errors — `Proposal`, `ProposalCR`, `ProposalVoting`, etc. undefined.

**Step 3: Add types to network.go**

Append to `network.go`:

```go
type ProposalKind string

const (
	ProposalCR         ProposalKind = "change_request"
	ProposalTrace      ProposalKind = "trace_dispute"
	ProposalSweep      ProposalKind = "sweep_acceptance"
	ProposalMembership ProposalKind = "network_membership"
	ProposalChallenge  ProposalKind = "challenge"
)

type ProposalStatus string

const (
	ProposalVoting   ProposalStatus = "voting"
	ProposalApproved ProposalStatus = "approved"
	ProposalRejected ProposalStatus = "rejected"
	ProposalExpired  ProposalStatus = "expired"
)

type Proposal struct {
	ID            string         `json:"id"`
	Kind          ProposalKind   `json:"kind"`
	Title         string         `json:"title"`
	Description   string         `json:"description"`
	ProposerPeer  string         `json:"proposer_peer"`
	ProposerName  string         `json:"proposer_name"`
	OwnerPeer     string         `json:"owner_peer"`
	Status        ProposalStatus `json:"status"`
	AffectedItems []string       `json:"affected_items"`
	Deadline      time.Time      `json:"deadline"`
	CreatedAt     time.Time      `json:"created_at"`
	ResolvedAt    *time.Time     `json:"resolved_at,omitempty"`
}

type ProposalVoteRecord struct {
	ID         string    `json:"id"`
	ProposalID string    `json:"proposal_id"`
	VoterPeer  string    `json:"voter_peer"`
	VoterID    string    `json:"voter_id"`
	Decision   string    `json:"decision"`
	Reason     string    `json:"reason"`
	IsAI       bool      `json:"is_ai"`
	CreatedAt  time.Time `json:"created_at"`
}

type TallyResult struct {
	TotalEligible int            `json:"total_eligible"`
	HumanVotes    int            `json:"human_votes"`
	AIVotes       int            `json:"ai_votes"`
	Approve       int            `json:"approve"`
	Reject        int            `json:"reject"`
	QuorumReached bool           `json:"quorum_reached"`
	Decision      ProposalStatus `json:"decision"`
	OwnerVetoed   bool           `json:"owner_vetoed"`
}
```

**Step 4: Add tables to store.go migrate()**

In `store.go`, add inside the schema string (after the `peer_blocklist` table):

```sql
CREATE TABLE IF NOT EXISTS proposals (
    id             TEXT PRIMARY KEY,
    kind           TEXT NOT NULL,
    title          TEXT NOT NULL,
    description    TEXT DEFAULT '',
    proposer_peer  TEXT NOT NULL,
    proposer_name  TEXT NOT NULL,
    owner_peer     TEXT DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'voting',
    affected_items TEXT DEFAULT '[]',
    deadline       DATETIME NOT NULL,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at    DATETIME
);

CREATE TABLE IF NOT EXISTS proposal_votes (
    id           TEXT PRIMARY KEY,
    proposal_id  TEXT NOT NULL REFERENCES proposals(id),
    voter_peer   TEXT NOT NULL,
    voter_id     TEXT NOT NULL,
    decision     TEXT NOT NULL,
    reason       TEXT DEFAULT '',
    is_ai        INTEGER DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(proposal_id, voter_peer)
);

CREATE INDEX IF NOT EXISTS idx_proposal_votes_proposal ON proposal_votes(proposal_id);
```

**Step 5: Add CRUD methods to store.go**

Append to `store.go`:

```go
func (s *Store) CreateProposal(ctx context.Context, p *Proposal) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	p.CreatedAt = time.Now()
	p.Status = ProposalVoting
	affected, _ := json.Marshal(p.AffectedItems)
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO proposals (id, kind, title, description, proposer_peer, proposer_name, owner_peer, status, affected_items, deadline, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.Kind, p.Title, p.Description, p.ProposerPeer, p.ProposerName, p.OwnerPeer, p.Status, string(affected), p.Deadline, p.CreatedAt)
	return err
}

func (s *Store) GetProposal(ctx context.Context, id string) (*Proposal, error) {
	p := &Proposal{}
	var affected string
	var resolvedAt sql.NullTime
	err := s.db.QueryRowContext(ctx,
		`SELECT id, kind, title, description, proposer_peer, proposer_name, owner_peer, status, affected_items, deadline, created_at, resolved_at
		 FROM proposals WHERE id = ?`, id).
		Scan(&p.ID, &p.Kind, &p.Title, &p.Description, &p.ProposerPeer, &p.ProposerName, &p.OwnerPeer, &p.Status, &affected, &p.Deadline, &p.CreatedAt, &resolvedAt)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal([]byte(affected), &p.AffectedItems)
	if resolvedAt.Valid {
		p.ResolvedAt = &resolvedAt.Time
	}
	return p, nil
}

func (s *Store) UpdateProposalStatus(ctx context.Context, id string, status ProposalStatus) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx,
		`UPDATE proposals SET status = ?, resolved_at = ? WHERE id = ?`, status, now, id)
	return err
}

func (s *Store) ListProposals(ctx context.Context, status ProposalStatus) ([]Proposal, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, kind, title, description, proposer_peer, proposer_name, owner_peer, status, affected_items, deadline, created_at, resolved_at
		 FROM proposals WHERE status = ? ORDER BY created_at DESC`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var proposals []Proposal
	for rows.Next() {
		var p Proposal
		var affected string
		var resolvedAt sql.NullTime
		if err := rows.Scan(&p.ID, &p.Kind, &p.Title, &p.Description, &p.ProposerPeer, &p.ProposerName, &p.OwnerPeer, &p.Status, &affected, &p.Deadline, &p.CreatedAt, &resolvedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(affected), &p.AffectedItems)
		if resolvedAt.Valid {
			p.ResolvedAt = &resolvedAt.Time
		}
		proposals = append(proposals, p)
	}
	return proposals, rows.Err()
}

func (s *Store) ListAllActiveProposals(ctx context.Context) ([]Proposal, error) {
	return s.ListProposals(ctx, ProposalVoting)
}

func (s *Store) CreateProposalVote(ctx context.Context, v *ProposalVoteRecord) error {
	if v.ID == "" {
		v.ID = uuid.New().String()
	}
	v.CreatedAt = time.Now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO proposal_votes (id, proposal_id, voter_peer, voter_id, decision, reason, is_ai, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		v.ID, v.ProposalID, v.VoterPeer, v.VoterID, v.Decision, v.Reason, v.IsAI, v.CreatedAt)
	return err
}

func (s *Store) GetProposalVotes(ctx context.Context, proposalID string) ([]ProposalVoteRecord, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, proposal_id, voter_peer, voter_id, decision, reason, is_ai, created_at
		 FROM proposal_votes WHERE proposal_id = ? ORDER BY created_at`, proposalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var votes []ProposalVoteRecord
	for rows.Next() {
		var v ProposalVoteRecord
		if err := rows.Scan(&v.ID, &v.ProposalID, &v.VoterPeer, &v.VoterID, &v.Decision, &v.Reason, &v.IsAI, &v.CreatedAt); err != nil {
			return nil, err
		}
		votes = append(votes, v)
	}
	return votes, rows.Err()
}
```

**Step 6: Run tests**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestStore_Proposal -v ./...`
Expected: All PASS.

**Step 7: Commit**

```bash
git add network.go store.go store_test.go
git commit -m "feat: add proposals and proposal_votes tables with CRUD for P2P governance"
```

---

## Task 7: Challenge Tables + Types

**Files:**
- Modify: `network.go` (add Challenge, ChallengeKind, ChallengeStatus types)
- Modify: `store.go` (add challenges, peer_reputation, challenge_cooldowns tables + CRUD)
- Modify: `store_test.go` (add tests)

**Step 1: Write failing tests**

Append to `store_test.go`:

```go
func TestStore_ChallengeCRUD(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	deadline := time.Now().Add(24 * time.Hour)
	ch := &Challenge{
		Kind:           ChallengeStaleData,
		ChallengerPeer: "12D3KooWABC",
		ChallengedPeer: "12D3KooWDEF",
		TargetItemID:   "item-1",
		Reason:         "Upstream changed, no re-verification",
		Deadline:       deadline,
	}
	err := s.CreateChallenge(ctx, ch)
	if err != nil {
		t.Fatalf("create challenge: %v", err)
	}

	got, err := s.GetChallenge(ctx, ch.ID)
	if err != nil {
		t.Fatalf("get challenge: %v", err)
	}
	if got.Kind != ChallengeStaleData {
		t.Errorf("got kind %q, want %q", got.Kind, ChallengeStaleData)
	}
	if got.Status != ChallengeOpen {
		t.Errorf("got status %q, want %q", got.Status, ChallengeOpen)
	}

	err = s.UpdateChallengeStatus(ctx, ch.ID, ChallengeResponded)
	if err != nil {
		t.Fatalf("update status: %v", err)
	}
	got, _ = s.GetChallenge(ctx, ch.ID)
	if got.Status != ChallengeResponded {
		t.Errorf("got status %q, want %q", got.Status, ChallengeResponded)
	}

	err = s.UpdateChallengeResponse(ctx, ch.ID, "Re-verified against spec", ChallengeResponded)
	if err != nil {
		t.Fatalf("update response: %v", err)
	}

	challenges, err := s.ListChallenges(ctx, ChallengeResponded)
	if err != nil {
		t.Fatalf("list challenges: %v", err)
	}
	if len(challenges) != 1 {
		t.Errorf("got %d challenges, want 1", len(challenges))
	}
}

func TestStore_PeerReputation(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	// Initial reputation should be 0 (default)
	score, err := s.GetPeerReputation(ctx, "12D3KooWABC")
	if err != nil {
		t.Fatalf("get reputation: %v", err)
	}
	if score != 0 {
		t.Errorf("got score %d, want 0", score)
	}

	// Adjust up
	err = s.AdjustPeerReputation(ctx, "12D3KooWABC", 1)
	if err != nil {
		t.Fatalf("adjust up: %v", err)
	}
	score, _ = s.GetPeerReputation(ctx, "12D3KooWABC")
	if score != 1 {
		t.Errorf("got score %d, want 1", score)
	}

	// Adjust down below floor
	for i := 0; i < 15; i++ {
		s.AdjustPeerReputation(ctx, "12D3KooWABC", -1)
	}
	score, _ = s.GetPeerReputation(ctx, "12D3KooWABC")
	if score != -10 {
		t.Errorf("got score %d, want -10 (floor)", score)
	}
}

func TestStore_ChallengeCooldown(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	err := s.SetChallengeCooldown(ctx, "12D3KooWABC", "12D3KooWDEF")
	if err != nil {
		t.Fatalf("set cooldown: %v", err)
	}

	onCooldown, err := s.IsOnChallengeCooldown(ctx, "12D3KooWABC", "12D3KooWDEF", 24*time.Hour)
	if err != nil {
		t.Fatalf("check cooldown: %v", err)
	}
	if !onCooldown {
		t.Error("expected cooldown to be active")
	}

	notCooldown, err := s.IsOnChallengeCooldown(ctx, "12D3KooWDEF", "12D3KooWABC", 24*time.Hour)
	if err != nil {
		t.Fatalf("check reverse: %v", err)
	}
	if notCooldown {
		t.Error("expected no cooldown in reverse direction")
	}
}
```

**Step 2: Run failing test**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run "TestStore_Challenge|TestStore_PeerRep" -v ./...`
Expected: Compilation errors — `Challenge`, `ChallengeStaleData`, etc. undefined.

**Step 3: Add types to network.go**

Append to `network.go`:

```go
type ChallengeKind string

const (
	ChallengeStaleData      ChallengeKind = "stale_data"
	ChallengeWeakEvidence   ChallengeKind = "weak_evidence"
	ChallengeTraceIntegrity ChallengeKind = "trace_integrity"
)

type ChallengeStatus string

const (
	ChallengeOpen      ChallengeStatus = "open"
	ChallengeResponded ChallengeStatus = "responded"
	ChallengeVoting    ChallengeStatus = "voting"
	ChallengeSustained ChallengeStatus = "sustained"
	ChallengeDismissed ChallengeStatus = "dismissed"
	ChallengeExpired   ChallengeStatus = "expired"
)

type Challenge struct {
	ID               string          `json:"id"`
	Kind             ChallengeKind   `json:"kind"`
	ChallengerPeer   string          `json:"challenger_peer"`
	ChallengedPeer   string          `json:"challenged_peer"`
	TargetItemID     string          `json:"target_item_id,omitempty"`
	TargetTraceID    string          `json:"target_trace_id,omitempty"`
	Reason           string          `json:"reason"`
	Evidence         string          `json:"evidence,omitempty"`
	ResponseEvidence string          `json:"response_evidence,omitempty"`
	Status           ChallengeStatus `json:"status"`
	Deadline         time.Time       `json:"deadline"`
	CreatedAt        time.Time       `json:"created_at"`
	ResolvedAt       *time.Time      `json:"resolved_at,omitempty"`
}
```

**Step 4: Add tables to store.go migrate()**

In `store.go`, add inside the schema string (after the `proposal_votes` table):

```sql
CREATE TABLE IF NOT EXISTS challenges (
    id                TEXT PRIMARY KEY,
    kind              TEXT NOT NULL,
    challenger_peer   TEXT NOT NULL,
    challenged_peer   TEXT NOT NULL,
    target_item_id    TEXT,
    target_trace_id   TEXT,
    reason            TEXT NOT NULL,
    evidence          TEXT DEFAULT '',
    response_evidence TEXT DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'open',
    deadline          DATETIME NOT NULL,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at       DATETIME
);

CREATE TABLE IF NOT EXISTS peer_reputation (
    peer_id    TEXT PRIMARY KEY,
    score      INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS challenge_cooldowns (
    challenger_peer TEXT NOT NULL,
    challenged_peer TEXT NOT NULL,
    last_challenge  DATETIME NOT NULL,
    PRIMARY KEY (challenger_peer, challenged_peer)
);

CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status);
CREATE INDEX IF NOT EXISTS idx_challenges_challenged ON challenges(challenged_peer);
```

**Step 5: Add CRUD methods to store.go**

Append to `store.go`:

```go
func (s *Store) CreateChallenge(ctx context.Context, ch *Challenge) error {
	if ch.ID == "" {
		ch.ID = uuid.New().String()
	}
	ch.CreatedAt = time.Now()
	ch.Status = ChallengeOpen
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO challenges (id, kind, challenger_peer, challenged_peer, target_item_id, target_trace_id, reason, evidence, status, deadline, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		ch.ID, ch.Kind, ch.ChallengerPeer, ch.ChallengedPeer, ch.TargetItemID, ch.TargetTraceID, ch.Reason, ch.Evidence, ch.Status, ch.Deadline, ch.CreatedAt)
	return err
}

func (s *Store) GetChallenge(ctx context.Context, id string) (*Challenge, error) {
	ch := &Challenge{}
	var resolvedAt sql.NullTime
	var targetItemID, targetTraceID sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT id, kind, challenger_peer, challenged_peer, target_item_id, target_trace_id, reason, evidence, response_evidence, status, deadline, created_at, resolved_at
		 FROM challenges WHERE id = ?`, id).
		Scan(&ch.ID, &ch.Kind, &ch.ChallengerPeer, &ch.ChallengedPeer, &targetItemID, &targetTraceID, &ch.Reason, &ch.Evidence, &ch.ResponseEvidence, &ch.Status, &ch.Deadline, &ch.CreatedAt, &resolvedAt)
	if err != nil {
		return nil, err
	}
	if targetItemID.Valid {
		ch.TargetItemID = targetItemID.String
	}
	if targetTraceID.Valid {
		ch.TargetTraceID = targetTraceID.String
	}
	if resolvedAt.Valid {
		ch.ResolvedAt = &resolvedAt.Time
	}
	return ch, nil
}

func (s *Store) UpdateChallengeStatus(ctx context.Context, id string, status ChallengeStatus) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE challenges SET status = ? WHERE id = ?`, status, id)
	return err
}

func (s *Store) UpdateChallengeResponse(ctx context.Context, id string, responseEvidence string, status ChallengeStatus) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE challenges SET response_evidence = ?, status = ? WHERE id = ?`, responseEvidence, status, id)
	return err
}

func (s *Store) ResolveChallengeStatus(ctx context.Context, id string, status ChallengeStatus) error {
	now := time.Now()
	_, err := s.db.ExecContext(ctx,
		`UPDATE challenges SET status = ?, resolved_at = ? WHERE id = ?`, status, now, id)
	return err
}

func (s *Store) ListChallenges(ctx context.Context, status ChallengeStatus) ([]Challenge, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, kind, challenger_peer, challenged_peer, target_item_id, target_trace_id, reason, evidence, response_evidence, status, deadline, created_at, resolved_at
		 FROM challenges WHERE status = ? ORDER BY created_at DESC`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var challenges []Challenge
	for rows.Next() {
		var ch Challenge
		var resolvedAt sql.NullTime
		var targetItemID, targetTraceID sql.NullString
		if err := rows.Scan(&ch.ID, &ch.Kind, &ch.ChallengerPeer, &ch.ChallengedPeer, &targetItemID, &targetTraceID, &ch.Reason, &ch.Evidence, &ch.ResponseEvidence, &ch.Status, &ch.Deadline, &ch.CreatedAt, &resolvedAt); err != nil {
			return nil, err
		}
		if targetItemID.Valid {
			ch.TargetItemID = targetItemID.String
		}
		if targetTraceID.Valid {
			ch.TargetTraceID = targetTraceID.String
		}
		if resolvedAt.Valid {
			ch.ResolvedAt = &resolvedAt.Time
		}
		challenges = append(challenges, ch)
	}
	return challenges, rows.Err()
}

func (s *Store) ListChallengesByPeer(ctx context.Context, peerID string, incoming bool) ([]Challenge, error) {
	column := "challenger_peer"
	if incoming {
		column = "challenged_peer"
	}
	query := fmt.Sprintf(
		`SELECT id, kind, challenger_peer, challenged_peer, target_item_id, target_trace_id, reason, evidence, response_evidence, status, deadline, created_at, resolved_at
		 FROM challenges WHERE %s = ? ORDER BY created_at DESC`, column)

	rows, err := s.db.QueryContext(ctx, query, peerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var challenges []Challenge
	for rows.Next() {
		var ch Challenge
		var resolvedAt sql.NullTime
		var targetItemID, targetTraceID sql.NullString
		if err := rows.Scan(&ch.ID, &ch.Kind, &ch.ChallengerPeer, &ch.ChallengedPeer, &targetItemID, &targetTraceID, &ch.Reason, &ch.Evidence, &ch.ResponseEvidence, &ch.Status, &ch.Deadline, &ch.CreatedAt, &resolvedAt); err != nil {
			return nil, err
		}
		if targetItemID.Valid {
			ch.TargetItemID = targetItemID.String
		}
		if targetTraceID.Valid {
			ch.TargetTraceID = targetTraceID.String
		}
		if resolvedAt.Valid {
			ch.ResolvedAt = &resolvedAt.Time
		}
		challenges = append(challenges, ch)
	}
	return challenges, rows.Err()
}

func (s *Store) GetPeerReputation(ctx context.Context, peerID string) (int, error) {
	var score int
	err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE((SELECT score FROM peer_reputation WHERE peer_id = ?), 0)`, peerID).Scan(&score)
	return score, err
}

func (s *Store) AdjustPeerReputation(ctx context.Context, peerID string, delta int) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO peer_reputation (peer_id, score, updated_at) VALUES (?, MAX(?, -10), CURRENT_TIMESTAMP)
		 ON CONFLICT(peer_id) DO UPDATE SET
		   score = MAX(peer_reputation.score + ?, -10),
		   updated_at = CURRENT_TIMESTAMP`,
		peerID, delta, delta)
	return err
}

func (s *Store) SetChallengeCooldown(ctx context.Context, challengerPeer, challengedPeer string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO challenge_cooldowns (challenger_peer, challenged_peer, last_challenge)
		 VALUES (?, ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(challenger_peer, challenged_peer) DO UPDATE SET last_challenge = CURRENT_TIMESTAMP`,
		challengerPeer, challengedPeer)
	return err
}

func (s *Store) IsOnChallengeCooldown(ctx context.Context, challengerPeer, challengedPeer string, cooldownDuration time.Duration) (bool, error) {
	var count int
	cutoff := time.Now().Add(-cooldownDuration)
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM challenge_cooldowns
		 WHERE challenger_peer = ? AND challenged_peer = ? AND last_challenge > ?`,
		challengerPeer, challengedPeer, cutoff).Scan(&count)
	return count > 0, err
}
```

**Step 6: Run tests**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run "TestStore_Challenge|TestStore_PeerRep" -v ./...`
Expected: All PASS.

**Step 7: Commit**

```bash
git add network.go store.go store_test.go
git commit -m "feat: add challenges, peer_reputation, challenge_cooldowns tables with CRUD"
```

---

## Task 8: Security Layer (MessageCache + PeerRateLimiter)

**Files:**
- Create: `security.go`
- Create: `security_test.go`

**Step 1: Write failing tests**

Create `security_test.go`:

```go
package main

import (
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

func TestSecuritySuite(t *testing.T) {
	suite.Run(t, new(SecuritySuite))
}
```

**Step 2: Run failing test**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestSecuritySuite -v ./...`
Expected: Compilation errors — `NewMessageCache`, `NewPeerRateLimiter` undefined.

**Step 3: Implement security.go**

Create `security.go`:

```go
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
```

**Step 4: Run tests**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestSecuritySuite -v ./...`
Expected: All PASS.

**Step 5: Commit**

```bash
git add security.go security_test.go
git commit -m "feat: add message cache and peer rate limiter for P2P security"
```

---

## Task 9: P2P Host (libp2p + DHT + mDNS)

**Files:**
- Create: `p2p.go`

**Step 1: Write failing test**

Create `p2p_test.go`:

```go
package main

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"
)

type P2PSuite struct {
	suite.Suite
}

func (s *P2PSuite) TestNewP2PHost_StartsAndStops() {
	tmpDir := s.T().TempDir()
	ident, err := GenerateIdentity()
	s.Require().NoError(err)

	cfg := DefaultNodeConfig()
	cfg.Node.Name = "test-node"
	cfg.Node.Vertical = VerticalDev
	cfg.Node.Project = "test-project"
	cfg.Node.Owner = "tester"
	cfg.Network.ListenPort = 0 // Random port
	cfg.Network.EnableDHT = false
	cfg.Network.EnableMDNS = false

	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	defer store.Close()

	host, err := NewP2PHost(context.Background(), ident, cfg, store)
	s.Require().NoError(err)
	s.NotNil(host)
	s.NotEmpty(host.Addrs())

	err = host.Close()
	s.NoError(err)
}

func (s *P2PSuite) TestTwoHosts_Connect() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	tmpDir1 := s.T().TempDir()
	tmpDir2 := s.T().TempDir()

	ident1, _ := GenerateIdentity()
	ident2, _ := GenerateIdentity()

	cfg1 := DefaultNodeConfig()
	cfg1.Node.Name = "node-1"
	cfg1.Node.Vertical = VerticalDev
	cfg1.Node.Project = "test-project"
	cfg1.Node.Owner = "owner-1"
	cfg1.Network.ListenPort = 0
	cfg1.Network.EnableDHT = false
	cfg1.Network.EnableMDNS = false

	cfg2 := DefaultNodeConfig()
	cfg2.Node.Name = "node-2"
	cfg2.Node.Vertical = VerticalPM
	cfg2.Node.Project = "test-project"
	cfg2.Node.Owner = "owner-2"
	cfg2.Network.ListenPort = 0
	cfg2.Network.EnableDHT = false
	cfg2.Network.EnableMDNS = false

	store1, _ := NewStore(tmpDir1 + "/test1.db")
	defer store1.Close()
	store2, _ := NewStore(tmpDir2 + "/test2.db")
	defer store2.Close()

	host1, err := NewP2PHost(ctx, ident1, cfg1, store1)
	s.Require().NoError(err)
	defer host1.Close()

	host2, err := NewP2PHost(ctx, ident2, cfg2, store2)
	s.Require().NoError(err)
	defer host2.Close()

	// Connect host2 to host1
	err = host2.ConnectPeer(ctx, host1.Addrs()[0])
	s.Require().NoError(err)

	// Verify connected
	peers := host2.ConnectedPeers()
	s.GreaterOrEqual(len(peers), 1)
}

func (s *P2PSuite) TestP2PHost_PeerID() {
	ident, _ := GenerateIdentity()
	cfg := DefaultNodeConfig()
	cfg.Network.ListenPort = 0
	cfg.Network.EnableDHT = false
	cfg.Network.EnableMDNS = false

	tmpDir := s.T().TempDir()
	store, _ := NewStore(tmpDir + "/test.db")
	defer store.Close()

	host, err := NewP2PHost(context.Background(), ident, cfg, store)
	s.Require().NoError(err)
	defer host.Close()

	s.Equal(ident.PeerID.String(), host.PeerIDString())
}

func TestP2PSuite(t *testing.T) {
	suite.Run(t, new(P2PSuite))
}
```

**Step 2: Run failing test**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestP2PSuite -v ./...`
Expected: Compilation errors — `NewP2PHost`, `P2PHost`, `Addrs`, `ConnectPeer`, `ConnectedPeers`, `PeerIDString` undefined.

**Step 3: Implement p2p.go**

Create `p2p.go`:

```go
package main

import (
	"context"
	"fmt"
	"sync"

	"github.com/libp2p/go-libp2p"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/p2p/discovery/mdns"
	multiaddr "github.com/multiformats/go-multiaddr"
)

const ProtocolID = "/inv/1.0.0"

// P2PHost wraps a libp2p host with inventory-specific functionality.
type P2PHost struct {
	host       host.Host
	identity   *NodeIdentity
	config     *NodeConfig
	store      *Store
	cache      *MessageCache
	limiter    *PeerRateLimiter
	mdnsService mdns.Service
	mu         sync.RWMutex
}

func NewP2PHost(ctx context.Context, ident *NodeIdentity, cfg *NodeConfig, store *Store) (*P2PHost, error) {
	listenAddr := fmt.Sprintf("/ip4/0.0.0.0/tcp/%d", cfg.Network.ListenPort)

	opts := []libp2p.Option{
		libp2p.Identity(ident.PrivKey),
		libp2p.ListenAddrStrings(listenAddr),
	}

	h, err := libp2p.New(opts...)
	if err != nil {
		return nil, fmt.Errorf("create libp2p host: %w", err)
	}

	p2pHost := &P2PHost{
		host:     h,
		identity: ident,
		config:   cfg,
		store:    store,
		cache:    NewMessageCache(cfg.Security.SeenCacheSize, cfg.Security.ReplayWindow),
		limiter:  NewPeerRateLimiter(cfg.Security.MaxMessageRate, cfg.Security.ThrottleDuration, cfg.Security.ThrottleDuration),
	}

	// Set up mDNS discovery if enabled
	if cfg.Network.EnableMDNS {
		rendezvous := fmt.Sprintf("/inv/project/%s", cfg.Node.Project)
		mdnsSvc := mdns.NewMdnsService(h, rendezvous, &mdnsNotifee{host: p2pHost})
		if err := mdnsSvc.Start(); err != nil {
			h.Close()
			return nil, fmt.Errorf("start mDNS: %w", err)
		}
		p2pHost.mdnsService = mdnsSvc
	}

	return p2pHost, nil
}

func (p *P2PHost) Close() error {
	if p.mdnsService != nil {
		p.mdnsService.Close()
	}
	return p.host.Close()
}

func (p *P2PHost) Addrs() []multiaddr.Multiaddr {
	hostAddr, _ := multiaddr.NewMultiaddr(fmt.Sprintf("/p2p/%s", p.host.ID()))
	var fullAddrs []multiaddr.Multiaddr
	for _, addr := range p.host.Addrs() {
		fullAddrs = append(fullAddrs, addr.Encapsulate(hostAddr))
	}
	return fullAddrs
}

// ShareableAddrs returns human-readable multiaddr strings suitable for sharing.
func (p *P2PHost) ShareableAddrs() []string {
	addrs := p.Addrs()
	result := make([]string, len(addrs))
	for i, a := range addrs {
		result[i] = a.String()
	}
	return result
}

// ConnectedPeerCount returns the number of connected peers.
func (p *P2PHost) ConnectedPeerCount() int {
	return len(p.host.Network().Peers())
}

func (p *P2PHost) PeerIDString() string {
	return p.host.ID().String()
}

func (p *P2PHost) ConnectPeer(ctx context.Context, addr multiaddr.Multiaddr) error {
	peerInfo, err := peer.AddrInfoFromP2pAddr(addr)
	if err != nil {
		return fmt.Errorf("parse peer address: %w", err)
	}

	if err := p.host.Connect(ctx, *peerInfo); err != nil {
		return fmt.Errorf("connect to peer: %w", err)
	}

	return nil
}

func (p *P2PHost) ConnectedPeers() []peer.ID {
	return p.host.Network().Peers()
}

func (p *P2PHost) Host() host.Host {
	return p.host
}

// mdnsNotifee handles mDNS peer discovery events.
type mdnsNotifee struct {
	host *P2PHost
}

func (n *mdnsNotifee) HandlePeerFound(pi peer.AddrInfo) {
	if pi.ID == n.host.host.ID() {
		return
	}
	ctx := context.Background()
	_ = n.host.host.Connect(ctx, pi)
}
```

**Step 4: Run tests**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestP2PSuite -v ./... -timeout 30s`
Expected: All PASS.

**Step 5: Commit**

```bash
git add p2p.go p2p_test.go
git commit -m "feat: add libp2p host with TCP transport, noise encryption, and mDNS discovery"
```

---

## Task 10: Proposal Engine (Tally)

**Files:**
- Create: `proposal.go`
- Create: `proposal_test.go`

**Step 1: Write failing tests**

Create `proposal_test.go`:

```go
package main

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"
)

type ProposalSuite struct {
	suite.Suite
	store    *Store
	proposer *ProposalEngine
}

func (s *ProposalSuite) SetupTest() {
	tmpDir := s.T().TempDir()
	var err error
	s.store, err = NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	s.proposer = NewProposalEngine(s.store)
}

func (s *ProposalSuite) TearDownTest() {
	s.store.Close()
}

func (s *ProposalSuite) seedPeers(humanCount, aiCount int) {
	ctx := context.Background()
	for i := 0; i < humanCount; i++ {
		p := &Peer{
			PeerID:   fmt.Sprintf("human-peer-%d", i),
			NodeID:   fmt.Sprintf("human-node-%d", i),
			Name:     fmt.Sprintf("human-%d", i),
			Vertical: VerticalDev,
			Project:  "test-proj",
			Owner:    fmt.Sprintf("owner-%d", i),
			IsAI:     false,
			Status:   PeerStatusApproved,
		}
		s.store.CreatePeer(ctx, p)
	}
	for i := 0; i < aiCount; i++ {
		p := &Peer{
			PeerID:   fmt.Sprintf("ai-peer-%d", i),
			NodeID:   fmt.Sprintf("ai-node-%d", i),
			Name:     fmt.Sprintf("ai-%d", i),
			Vertical: VerticalDev,
			Project:  "test-proj",
			Owner:    fmt.Sprintf("ai-owner-%d", i),
			IsAI:     true,
			Status:   PeerStatusApproved,
		}
		s.store.CreatePeer(ctx, p)
	}
}

func (s *ProposalSuite) TestTally_QuorumReached_Approved() {
	ctx := context.Background()
	s.seedPeers(4, 1) // 4 human, 1 AI

	prop := &Proposal{
		Kind:         ProposalCR,
		Title:        "Test CR",
		ProposerPeer: "human-peer-0",
		ProposerName: "owner-0",
		Deadline:     time.Now().Add(24 * time.Hour),
	}
	s.store.CreateProposal(ctx, prop)

	// 3 of 4 humans approve (>50%)
	for i := 1; i <= 3; i++ {
		s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
			ProposalID: prop.ID,
			VoterPeer:  fmt.Sprintf("human-peer-%d", i),
			VoterID:    fmt.Sprintf("voter-%d", i),
			Decision:   "approve",
		})
	}

	// AI also votes approve (should not count toward quorum)
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID,
		VoterPeer:  "ai-peer-0",
		VoterID:    "ai-voter-0",
		Decision:   "approve",
		IsAI:       true,
	})

	result, err := s.proposer.TallyProposal(ctx, prop.ID, "test-proj")
	s.Require().NoError(err)
	s.True(result.QuorumReached)
	s.Equal(ProposalApproved, result.Decision)
	s.Equal(3, result.HumanVotes)
	s.Equal(1, result.AIVotes)
	s.Equal(4, result.TotalEligible)
}

func (s *ProposalSuite) TestTally_QuorumReached_Rejected() {
	ctx := context.Background()
	s.seedPeers(4, 0)

	prop := &Proposal{
		Kind:         ProposalCR,
		Title:        "Test CR Reject",
		ProposerPeer: "human-peer-0",
		ProposerName: "owner-0",
		Deadline:     time.Now().Add(24 * time.Hour),
	}
	s.store.CreateProposal(ctx, prop)

	// 3 of 4 humans reject
	for i := 1; i <= 3; i++ {
		s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
			ProposalID: prop.ID,
			VoterPeer:  fmt.Sprintf("human-peer-%d", i),
			VoterID:    fmt.Sprintf("voter-%d", i),
			Decision:   "reject",
		})
	}

	result, err := s.proposer.TallyProposal(ctx, prop.ID, "test-proj")
	s.Require().NoError(err)
	s.True(result.QuorumReached)
	s.Equal(ProposalRejected, result.Decision)
}

func (s *ProposalSuite) TestTally_5050Split_Rejected() {
	ctx := context.Background()
	s.seedPeers(4, 0)

	prop := &Proposal{
		Kind:         ProposalCR,
		Title:        "Split Vote",
		ProposerPeer: "human-peer-0",
		ProposerName: "owner-0",
		Deadline:     time.Now().Add(24 * time.Hour),
	}
	s.store.CreateProposal(ctx, prop)

	// 2 approve, 2 reject
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "human-peer-1", VoterID: "v1", Decision: "approve",
	})
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "human-peer-2", VoterID: "v2", Decision: "approve",
	})
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "human-peer-3", VoterID: "v3", Decision: "reject",
	})
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "human-peer-0", VoterID: "v0", Decision: "reject",
	})

	result, err := s.proposer.TallyProposal(ctx, prop.ID, "test-proj")
	s.Require().NoError(err)
	s.Equal(ProposalRejected, result.Decision) // No majority = rejected
}

func (s *ProposalSuite) TestTally_OwnerVeto_TraceDispute() {
	ctx := context.Background()
	s.seedPeers(4, 0)

	prop := &Proposal{
		Kind:         ProposalTrace,
		Title:        "Trace dispute",
		ProposerPeer: "human-peer-0",
		ProposerName: "owner-0",
		OwnerPeer:    "human-peer-1", // Owner node
		Deadline:     time.Now().Add(24 * time.Hour),
	}
	s.store.CreateProposal(ctx, prop)

	// 3 approve but owner rejects
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "human-peer-1", VoterID: "v1", Decision: "reject", // Owner vetoes
	})
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "human-peer-2", VoterID: "v2", Decision: "approve",
	})
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "human-peer-3", VoterID: "v3", Decision: "approve",
	})

	result, err := s.proposer.TallyProposal(ctx, prop.ID, "test-proj")
	s.Require().NoError(err)
	s.Equal(ProposalRejected, result.Decision)
	s.True(result.OwnerVetoed)
}

func (s *ProposalSuite) TestTally_DeadlinePassed_NoQuorum_Expired() {
	ctx := context.Background()
	s.seedPeers(4, 0)

	prop := &Proposal{
		Kind:         ProposalCR,
		Title:        "Expired proposal",
		ProposerPeer: "human-peer-0",
		ProposerName: "owner-0",
		Deadline:     time.Now().Add(-1 * time.Hour), // Already expired
	}
	s.store.CreateProposal(ctx, prop)

	// Only 1 vote (not enough for quorum)
	s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "human-peer-1", VoterID: "v1", Decision: "approve",
	})

	result, err := s.proposer.TallyProposal(ctx, prop.ID, "test-proj")
	s.Require().NoError(err)
	s.False(result.QuorumReached)
	s.Equal(ProposalExpired, result.Decision)
}

func TestProposalSuite(t *testing.T) {
	suite.Run(t, new(ProposalSuite))
}
```

**Step 2: Run failing test**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestProposalSuite -v ./...`
Expected: Compilation errors — `NewProposalEngine`, `ProposalEngine`, `TallyProposal` undefined.

**Step 3: Implement proposal.go**

Create `proposal.go`:

```go
package main

import (
	"context"
	"fmt"
	"time"
)

// ProposalEngine handles governance tally logic.
type ProposalEngine struct {
	store *Store
}

func NewProposalEngine(store *Store) *ProposalEngine {
	return &ProposalEngine{store: store}
}

// TallyProposal computes the tally result for a proposal.
// project is used to determine the set of eligible voters (approved human peers in the project).
func (pe *ProposalEngine) TallyProposal(ctx context.Context, proposalID string, project string) (*TallyResult, error) {
	prop, err := pe.store.GetProposal(ctx, proposalID)
	if err != nil {
		return nil, fmt.Errorf("get proposal: %w", err)
	}

	votes, err := pe.store.GetProposalVotes(ctx, proposalID)
	if err != nil {
		return nil, fmt.Errorf("get votes: %w", err)
	}

	// Count eligible voters (approved human peers in project)
	peers, err := pe.store.ListPeers(ctx, project)
	if err != nil {
		return nil, fmt.Errorf("list peers: %w", err)
	}

	humanPeerCount := 0
	for _, p := range peers {
		if p.Status == PeerStatusApproved && !p.IsAI {
			humanPeerCount++
		}
	}

	result := &TallyResult{
		TotalEligible: humanPeerCount,
	}

	// Separate human and AI votes
	humanApprove := 0
	humanReject := 0
	ownerVote := ""

	for _, v := range votes {
		if v.IsAI {
			result.AIVotes++
			continue
		}
		result.HumanVotes++
		switch v.Decision {
		case "approve":
			humanApprove++
		case "reject":
			humanReject++
		}

		// Track owner vote for veto logic
		if v.VoterPeer == prop.OwnerPeer {
			ownerVote = v.Decision
		}
	}

	result.Approve = humanApprove
	result.Reject = humanReject

	// Check quorum: >50% of human nodes have voted
	quorumThreshold := humanPeerCount / 2
	result.QuorumReached = result.HumanVotes > quorumThreshold

	// Check owner veto for trace disputes and sweep acceptance
	if (prop.Kind == ProposalTrace || prop.Kind == ProposalSweep) && ownerVote == "reject" {
		result.OwnerVetoed = true
		result.Decision = ProposalRejected
		return result, nil
	}

	// Determine decision
	if !result.QuorumReached {
		// Check if deadline has passed
		if time.Now().After(prop.Deadline) {
			result.Decision = ProposalExpired
		} else {
			result.Decision = ProposalVoting // Still waiting
		}
		return result, nil
	}

	// Simple majority of human votes
	if humanApprove > humanReject {
		result.Decision = ProposalApproved
	} else {
		// 50/50 or more rejects = rejected
		result.Decision = ProposalRejected
	}

	return result, nil
}

// ResolveProposal tallies votes and updates the proposal status.
func (pe *ProposalEngine) ResolveProposal(ctx context.Context, proposalID string, project string) (*TallyResult, error) {
	result, err := pe.TallyProposal(ctx, proposalID, project)
	if err != nil {
		return nil, err
	}

	if result.Decision == ProposalVoting {
		return result, nil // Not ready to resolve
	}

	if err := pe.store.UpdateProposalStatus(ctx, proposalID, result.Decision); err != nil {
		return nil, fmt.Errorf("update proposal status: %w", err)
	}

	return result, nil
}
```

**Step 4: Add missing `fmt` import to proposal_test.go**

The test uses `fmt.Sprintf` in `seedPeers`. Ensure the import is present:

```go
import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"
)
```

**Step 5: Run tests**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestProposalSuite -v ./...`
Expected: All PASS.

**Step 6: Commit**

```bash
git add proposal.go proposal_test.go
git commit -m "feat: add proposal engine with quorum tally, owner veto, and AI vote filtering"
```

---

## Task 11: Message Sender + Outbox Queue

**Files:**
- Create: `p2p_sender.go`

**Step 1: Write failing test**

Append to `p2p_test.go`:

```go
func (s *P2PSuite) TestP2PSender_QueueToOutbox() {
	tmpDir := s.T().TempDir()
	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	defer store.Close()

	sender := NewP2PSender(nil, store) // nil host = offline mode

	err = sender.SendEnvelope(context.Background(), "target-peer", []byte("test-envelope"))
	s.Require().NoError(err)

	// Should be in outbox since host is nil
	msgs, err := store.GetPendingOutbox(context.Background(), "target-peer", 10)
	s.Require().NoError(err)
	s.Len(msgs, 1)
	s.Equal("test-envelope", string(msgs[0].Envelope))
}

func (s *P2PSuite) TestP2PSender_BroadcastQueuesForAllPeers() {
	tmpDir := s.T().TempDir()
	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	defer store.Close()

	ctx := context.Background()

	// Add two peers
	store.CreatePeer(ctx, &Peer{PeerID: "peer-1", NodeID: "n1", Name: "p1", Vertical: VerticalDev, Project: "proj", Owner: "o1", Status: PeerStatusApproved})
	store.CreatePeer(ctx, &Peer{PeerID: "peer-2", NodeID: "n2", Name: "p2", Vertical: VerticalPM, Project: "proj", Owner: "o2", Status: PeerStatusApproved})

	sender := NewP2PSender(nil, store)
	err = sender.BroadcastEnvelope(ctx, "proj", "self-peer", []byte("broadcast-data"))
	s.Require().NoError(err)

	msgs1, _ := store.GetPendingOutbox(ctx, "peer-1", 10)
	msgs2, _ := store.GetPendingOutbox(ctx, "peer-2", 10)
	s.Len(msgs1, 1)
	s.Len(msgs2, 1)
}
```

**Step 2: Run failing test**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run "TestP2PSuite/TestP2PSender" -v ./...`
Expected: Compilation errors — `NewP2PSender`, `P2PSender`, `SendEnvelope`, `BroadcastEnvelope` undefined.

**Step 3: Implement p2p_sender.go**

Create `p2p_sender.go`:

```go
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
```

**Step 4: Run tests**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestP2PSuite -v ./...`
Expected: All PASS.

**Step 5: Commit**

```bash
git add p2p_sender.go p2p_test.go
git commit -m "feat: add P2P message sender with outbox fallback for offline peers"
```

---

## Task 12: Message Handlers (Incoming Dispatch)

**Files:**
- Create: `p2p_handlers.go`

**Step 1: Write failing test**

Append to `p2p_test.go`:

```go
func (s *P2PSuite) TestP2PHandlers_HandleSignalChange() {
	tmpDir := s.T().TempDir()
	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	defer store.Close()

	ctx := context.Background()

	// Create a node and items
	node := &Node{Name: "dev", Vertical: VerticalDev, Project: "proj", Owner: "owner"}
	store.CreateNode(ctx, node)
	item := &Item{NodeID: node.ID, Kind: KindADR, Title: "Target Item", Body: "body"}
	store.CreateItem(ctx, item)

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	engine := NewEngine(store, prop, crsm)

	handlers := NewP2PHandlers(engine, store, nil)

	err = handlers.HandleSignalChange(ctx, "remote-item", "remote-node", item.ID, "upstream changed")
	s.Require().NoError(err)
}

func (s *P2PSuite) TestP2PHandlers_HandleTraceResolve() {
	tmpDir := s.T().TempDir()
	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	defer store.Close()

	ctx := context.Background()

	node := &Node{Name: "dev", Vertical: VerticalDev, Project: "proj", Owner: "owner"}
	store.CreateNode(ctx, node)
	item := &Item{NodeID: node.ID, Kind: KindADR, Title: "My Item", Body: "body"}
	store.CreateItem(ctx, item)

	// Verify the item so it has a status
	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	engine := NewEngine(store, prop, crsm)
	engine.VerifyItem(ctx, item.ID, "proof", "tester")

	handlers := NewP2PHandlers(engine, store, nil)

	resp, err := handlers.HandleTraceResolve(ctx, item.ID)
	s.Require().NoError(err)
	s.True(resp.Found)
	s.Equal("My Item", resp.Title)
	s.Equal(string(KindADR), resp.Kind)
	s.Equal(string(StatusProven), resp.Status)
}

func (s *P2PSuite) TestP2PHandlers_HandleTraceResolve_NotFound() {
	tmpDir := s.T().TempDir()
	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	defer store.Close()

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	engine := NewEngine(store, prop, crsm)

	handlers := NewP2PHandlers(engine, store, nil)

	resp, err := handlers.HandleTraceResolve(context.Background(), "nonexistent-id")
	s.Require().NoError(err)
	s.False(resp.Found)
}
```

**Step 2: Run failing test**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run "TestP2PSuite/TestP2PHandlers" -v ./...`
Expected: Compilation errors — `NewP2PHandlers`, `P2PHandlers`, `HandleSignalChange`, `HandleTraceResolve` undefined.

**Step 3: Implement p2p_handlers.go**

Create `p2p_handlers.go`:

```go
package main

import (
	"context"
	"fmt"
)

// NodeEventType represents the type of a node event emitted by P2P handlers.
type NodeEventType string

const (
	EventSignalReceived   NodeEventType = "signal.received"
	EventSweepReceived    NodeEventType = "sweep.received"
	EventQueryReceived    NodeEventType = "query.received"
	EventVoteRequested    NodeEventType = "vote.requested"
	EventChallengeReceived NodeEventType = "challenge.received"
	EventPeerJoined       NodeEventType = "peer.joined"
	EventMembershipRequest NodeEventType = "membership.request"
)

// NodeEvent represents an event emitted by a P2P handler after processing a message.
type NodeEvent struct {
	Type    NodeEventType
	Payload any
}

// EventDispatcher dispatches node events to registered listeners.
type EventDispatcher struct {
	listeners []func(ctx context.Context, event NodeEvent)
}

// NewEventDispatcher creates a new EventDispatcher.
func NewEventDispatcher() *EventDispatcher {
	return &EventDispatcher{}
}

// Register adds a listener that will be called for every dispatched event.
func (d *EventDispatcher) Register(fn func(ctx context.Context, event NodeEvent)) {
	d.listeners = append(d.listeners, fn)
}

// Dispatch sends an event to all registered listeners.
func (d *EventDispatcher) Dispatch(ctx context.Context, event NodeEvent) {
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
	dispatcher *EventDispatcher
}

func NewP2PHandlers(engine *Engine, store *Store, dispatcher *EventDispatcher) *P2PHandlers {
	return &P2PHandlers{engine: engine, store: store, dispatcher: dispatcher}
}

// dispatchEvent emits a NodeEvent if the dispatcher is configured.
func (h *P2PHandlers) dispatchEvent(ctx context.Context, event NodeEvent) {
	if h.dispatcher != nil {
		h.dispatcher.Dispatch(ctx, event)
	}
}

// HandleSignalChange processes an incoming signal.change message from a remote peer.
// It runs local propagation from the target item.
func (h *P2PHandlers) HandleSignalChange(ctx context.Context, sourceItemID, sourceNodeID, targetItemID, reason string) error {
	// Verify target item exists locally
	_, err := h.engine.GetItem(ctx, targetItemID)
	if err != nil {
		return fmt.Errorf("target item not found locally: %w", err)
	}

	// Propagate change from the target item through local trace graph
	_, err = h.engine.PropagateChange(ctx, targetItemID)
	if err != nil {
		return fmt.Errorf("propagate change: %w", err)
	}

	h.dispatchEvent(ctx, NodeEvent{Type: EventSignalReceived, Payload: map[string]string{
		"source_item_id": sourceItemID, "source_node_id": sourceNodeID,
		"target_item_id": targetItemID, "reason": reason,
	}})
	return nil
}

// HandleSignalSweep processes an incoming signal.sweep message from a remote peer.
func (h *P2PHandlers) HandleSignalSweep(ctx context.Context, externalRef, sourceNodeID string) error {
	_, err := h.engine.Sweep(ctx, externalRef)
	if err != nil {
		return fmt.Errorf("handle sweep: %w", err)
	}
	h.dispatchEvent(ctx, NodeEvent{Type: EventSweepReceived, Payload: map[string]string{
		"external_ref": externalRef, "source_node_id": sourceNodeID,
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
	// Store the query locally for the node owner to respond to
	_, err := h.engine.AskNetwork(ctx, askerID, "remote", question, queryCtx, "")
	if err != nil {
		return fmt.Errorf("store remote query: %w", err)
	}
	h.dispatchEvent(ctx, NodeEvent{Type: EventQueryReceived, Payload: map[string]string{
		"query_id": queryID, "asker_id": askerID, "question": question,
	}})
	return nil
}

// HandleProposalCreate processes an incoming proposal.create message.
func (h *P2PHandlers) HandleProposalCreate(ctx context.Context, prop *Proposal) error {
	if err := h.store.CreateProposal(ctx, prop); err != nil {
		return err
	}
	h.dispatchEvent(ctx, NodeEvent{Type: EventVoteRequested, Payload: prop})
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
	h.dispatchEvent(ctx, NodeEvent{Type: EventChallengeReceived, Payload: ch})
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
		h.dispatchEvent(ctx, NodeEvent{Type: EventPeerJoined, Payload: p})
	} else {
		h.dispatchEvent(ctx, NodeEvent{Type: EventMembershipRequest, Payload: p})
	}
	return nil
}
```

**Step 4: Run tests**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestP2PSuite -v ./...`
Expected: All PASS.

**Step 5: Commit**

```bash
git add p2p_handlers.go p2p_test.go
git commit -m "feat: add P2P message handlers for signal, trace, query, proposal, challenge"
```

---

## Task 13: Challenge Engine

**Files:**
- Create: `challenge.go`
- Create: `challenge_test.go`

**Step 1: Write failing tests**

Create `challenge_test.go`:

```go
package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"
)

type ChallengeSuite struct {
	suite.Suite
	store     *Store
	engine    *ChallengeEngine
	proposals *ProposalEngine
}

func (s *ChallengeSuite) SetupTest() {
	tmpDir := s.T().TempDir()
	var err error
	s.store, err = NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	s.proposals = NewProposalEngine(s.store)
	s.engine = NewChallengeEngine(s.store, s.proposals)
}

func (s *ChallengeSuite) TearDownTest() {
	s.store.Close()
}

func (s *ChallengeSuite) seedApprovedPeers(count int) {
	ctx := context.Background()
	for i := 0; i < count; i++ {
		s.store.CreatePeer(ctx, &Peer{
			PeerID:   fmt.Sprintf("peer-%d", i),
			NodeID:   fmt.Sprintf("node-%d", i),
			Name:     fmt.Sprintf("name-%d", i),
			Vertical: VerticalDev,
			Project:  "proj",
			Owner:    fmt.Sprintf("owner-%d", i),
			Status:   PeerStatusApproved,
		})
	}
}

func (s *ChallengeSuite) TestCreateChallenge_Success() {
	ctx := context.Background()
	s.seedApprovedPeers(3)

	ch, err := s.engine.CreateChallenge(ctx, ChallengeStaleData, "peer-0", "peer-1", "item-1", "", "Stale data", "evidence", 24*time.Hour)
	s.Require().NoError(err)
	s.NotEmpty(ch.ID)
	s.Equal(ChallengeOpen, ch.Status)
	s.Equal(ChallengeStaleData, ch.Kind)
}

func (s *ChallengeSuite) TestCreateChallenge_SelfChallenge_Rejected() {
	ctx := context.Background()
	s.seedApprovedPeers(3)

	_, err := s.engine.CreateChallenge(ctx, ChallengeStaleData, "peer-0", "peer-0", "item-1", "", "Stale data", "", 24*time.Hour)
	s.Error(err)
	s.Contains(err.Error(), "self-challenge")
}

func (s *ChallengeSuite) TestCreateChallenge_Cooldown_Rejected() {
	ctx := context.Background()
	s.seedApprovedPeers(3)

	// First challenge succeeds
	_, err := s.engine.CreateChallenge(ctx, ChallengeStaleData, "peer-0", "peer-1", "item-1", "", "First", "", 24*time.Hour)
	s.Require().NoError(err)

	// Second challenge within cooldown fails
	_, err = s.engine.CreateChallenge(ctx, ChallengeStaleData, "peer-0", "peer-1", "item-2", "", "Second", "", 24*time.Hour)
	s.Error(err)
	s.Contains(err.Error(), "cooldown")
}

func (s *ChallengeSuite) TestCreateChallenge_ReputationFloor_Rejected() {
	ctx := context.Background()
	s.seedApprovedPeers(3)

	// Set reputation to floor
	for i := 0; i < 12; i++ {
		s.store.AdjustPeerReputation(ctx, "peer-0", -1)
	}

	_, err := s.engine.CreateChallenge(ctx, ChallengeStaleData, "peer-0", "peer-1", "item-1", "", "Should fail", "", 24*time.Hour)
	s.Error(err)
	s.Contains(err.Error(), "reputation")
}

func (s *ChallengeSuite) TestRespondToChallenge_Success() {
	ctx := context.Background()
	s.seedApprovedPeers(3)

	ch, _ := s.engine.CreateChallenge(ctx, ChallengeStaleData, "peer-0", "peer-1", "item-1", "", "Stale", "", 24*time.Hour)

	err := s.engine.RespondToChallenge(ctx, ch.ID, "Re-verified against latest spec")
	s.Require().NoError(err)

	got, _ := s.store.GetChallenge(ctx, ch.ID)
	s.Equal(ChallengeResponded, got.Status)
	s.Equal("Re-verified against latest spec", got.ResponseEvidence)
}

func (s *ChallengeSuite) TestResolveChallenge_Sustained() {
	ctx := context.Background()
	s.seedApprovedPeers(4)

	ch, _ := s.engine.CreateChallenge(ctx, ChallengeStaleData, "peer-0", "peer-1", "item-1", "", "Stale", "", 24*time.Hour)

	s.engine.RespondToChallenge(ctx, ch.ID, "My evidence")

	// Create challenge proposal votes (sustain majority)
	prop, _ := s.store.ListProposals(ctx, ProposalVoting)
	if len(prop) > 0 {
		// Vote to sustain
		s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
			ProposalID: prop[0].ID, VoterPeer: "peer-2", VoterID: "v2", Decision: "approve",
		})
		s.store.CreateProposalVote(ctx, &ProposalVoteRecord{
			ProposalID: prop[0].ID, VoterPeer: "peer-3", VoterID: "v3", Decision: "approve",
		})
	}

	result, err := s.engine.ResolveChallenge(ctx, ch.ID, "proj")
	s.Require().NoError(err)
	s.Equal(ChallengeSustained, result.Status)

	// Check reputation adjustments
	challengerRep, _ := s.store.GetPeerReputation(ctx, "peer-0")
	challengedRep, _ := s.store.GetPeerReputation(ctx, "peer-1")
	s.Equal(1, challengerRep)
	s.Equal(-1, challengedRep)
}

func (s *ChallengeSuite) TestAutoExpire_AppliesPenalty() {
	ctx := context.Background()
	s.seedApprovedPeers(3)

	// Create challenge with already-expired deadline
	ch := &Challenge{
		Kind:           ChallengeStaleData,
		ChallengerPeer: "peer-0",
		ChallengedPeer: "peer-1",
		TargetItemID:   "item-1",
		Reason:         "Expired challenge",
		Deadline:       time.Now().Add(-1 * time.Hour),
	}
	s.store.CreateChallenge(ctx, ch)

	expired, err := s.engine.ProcessExpiredChallenges(ctx)
	s.Require().NoError(err)
	s.Len(expired, 1)

	got, _ := s.store.GetChallenge(ctx, ch.ID)
	s.Equal(ChallengeExpired, got.Status)

	// Reputation: challenger +1, challenged -2
	challengerRep, _ := s.store.GetPeerReputation(ctx, "peer-0")
	challengedRep, _ := s.store.GetPeerReputation(ctx, "peer-1")
	s.Equal(1, challengerRep)
	s.Equal(-2, challengedRep)
}

func TestChallengeSuite(t *testing.T) {
	suite.Run(t, new(ChallengeSuite))
}
```

**Step 2: Run failing test**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestChallengeSuite -v ./...`
Expected: Compilation errors — `NewChallengeEngine`, `ChallengeEngine` undefined.

**Step 3: Implement challenge.go**

Create `challenge.go`:

```go
package main

import (
	"context"
	"fmt"
	"time"
)

// ChallengeEngine handles challenge lifecycle: create, respond, vote, resolve.
type ChallengeEngine struct {
	store     *Store
	proposals *ProposalEngine
}

func NewChallengeEngine(store *Store, proposals *ProposalEngine) *ChallengeEngine {
	return &ChallengeEngine{store: store, proposals: proposals}
}

// CreateChallenge files a new challenge against a peer.
func (ce *ChallengeEngine) CreateChallenge(
	ctx context.Context,
	kind ChallengeKind,
	challengerPeer, challengedPeer string,
	targetItemID, targetTraceID string,
	reason, evidence string,
	deadlineDuration time.Duration,
) (*Challenge, error) {
	// Validate: no self-challenge
	if challengerPeer == challengedPeer {
		return nil, fmt.Errorf("self-challenge not allowed")
	}

	// Check reputation floor
	score, err := ce.store.GetPeerReputation(ctx, challengerPeer)
	if err != nil {
		return nil, fmt.Errorf("get reputation: %w", err)
	}
	if score <= -10 {
		return nil, fmt.Errorf("challenger reputation at floor (-10): challenges auto-rejected")
	}

	// Check cooldown
	onCooldown, err := ce.store.IsOnChallengeCooldown(ctx, challengerPeer, challengedPeer, 24*time.Hour)
	if err != nil {
		return nil, fmt.Errorf("check cooldown: %w", err)
	}
	if onCooldown {
		return nil, fmt.Errorf("cooldown active: cannot challenge same peer within 24h")
	}

	ch := &Challenge{
		Kind:           kind,
		ChallengerPeer: challengerPeer,
		ChallengedPeer: challengedPeer,
		TargetItemID:   targetItemID,
		TargetTraceID:  targetTraceID,
		Reason:         reason,
		Evidence:       evidence,
		Deadline:       time.Now().Add(deadlineDuration),
	}

	if err := ce.store.CreateChallenge(ctx, ch); err != nil {
		return nil, fmt.Errorf("create challenge: %w", err)
	}

	// Record cooldown
	if err := ce.store.SetChallengeCooldown(ctx, challengerPeer, challengedPeer); err != nil {
		return nil, fmt.Errorf("set cooldown: %w", err)
	}

	return ch, nil
}

// RespondToChallenge allows the challenged node to submit evidence.
func (ce *ChallengeEngine) RespondToChallenge(ctx context.Context, challengeID, evidence string) error {
	ch, err := ce.store.GetChallenge(ctx, challengeID)
	if err != nil {
		return fmt.Errorf("get challenge: %w", err)
	}
	if ch.Status != ChallengeOpen {
		return fmt.Errorf("challenge %s is %s, not open", challengeID, ch.Status)
	}

	if err := ce.store.UpdateChallengeResponse(ctx, challengeID, evidence, ChallengeResponded); err != nil {
		return fmt.Errorf("update response: %w", err)
	}

	return nil
}

// ResolveChallenge tallies votes and determines the outcome.
// For simplicity, it uses the proposal engine with a challenge proposal.
func (ce *ChallengeEngine) ResolveChallenge(ctx context.Context, challengeID, project string) (*Challenge, error) {
	ch, err := ce.store.GetChallenge(ctx, challengeID)
	if err != nil {
		return nil, fmt.Errorf("get challenge: %w", err)
	}

	// Check for expiry
	if time.Now().After(ch.Deadline) && ch.Status == ChallengeOpen {
		return ce.expireChallenge(ctx, ch)
	}

	// For responded challenges, look at vote pattern
	// Count votes from proposal_votes linked to this challenge's proposal
	proposals, err := ce.store.ListProposals(ctx, ProposalVoting)
	if err != nil {
		return nil, fmt.Errorf("list proposals: %w", err)
	}

	// Find the challenge proposal
	var challengeProp *Proposal
	for i := range proposals {
		if proposals[i].Kind == ProposalChallenge {
			for _, item := range proposals[i].AffectedItems {
				if item == challengeID {
					challengeProp = &proposals[i]
					break
				}
			}
		}
	}

	if challengeProp != nil {
		result, err := ce.proposals.TallyProposal(ctx, challengeProp.ID, project)
		if err != nil {
			return nil, fmt.Errorf("tally challenge proposal: %w", err)
		}

		if result.Decision == ProposalApproved {
			// Sustained: penalty applied
			ch.Status = ChallengeSustained
			ce.store.AdjustPeerReputation(ctx, ch.ChallengerPeer, 1)
			ce.store.AdjustPeerReputation(ctx, ch.ChallengedPeer, -1)
		} else if result.Decision == ProposalRejected {
			// Dismissed: challenger penalized
			ch.Status = ChallengeDismissed
			ce.store.AdjustPeerReputation(ctx, ch.ChallengerPeer, -1)
		} else {
			return ch, nil // Still voting
		}
	} else {
		// No proposal found — resolve based on response status
		// If responded and deadline passed, treat as sustained by default
		if ch.Status == ChallengeResponded {
			ch.Status = ChallengeSustained
			ce.store.AdjustPeerReputation(ctx, ch.ChallengerPeer, 1)
			ce.store.AdjustPeerReputation(ctx, ch.ChallengedPeer, -1)
		} else {
			return ch, nil
		}
	}

	if err := ce.store.ResolveChallengeStatus(ctx, challengeID, ch.Status); err != nil {
		return nil, fmt.Errorf("resolve challenge: %w", err)
	}

	return ch, nil
}

// expireChallenge applies auto-penalty when no response was given by deadline.
func (ce *ChallengeEngine) expireChallenge(ctx context.Context, ch *Challenge) (*Challenge, error) {
	ch.Status = ChallengeExpired

	// Auto-penalty: challenger +1, challenged -2
	ce.store.AdjustPeerReputation(ctx, ch.ChallengerPeer, 1)
	ce.store.AdjustPeerReputation(ctx, ch.ChallengedPeer, -2)

	if err := ce.store.ResolveChallengeStatus(ctx, ch.ID, ChallengeExpired); err != nil {
		return nil, fmt.Errorf("expire challenge: %w", err)
	}

	return ch, nil
}

// ProcessExpiredChallenges finds and expires all open challenges past their deadline.
func (ce *ChallengeEngine) ProcessExpiredChallenges(ctx context.Context) ([]Challenge, error) {
	openChallenges, err := ce.store.ListChallenges(ctx, ChallengeOpen)
	if err != nil {
		return nil, fmt.Errorf("list open challenges: %w", err)
	}

	var expired []Challenge
	for _, ch := range openChallenges {
		if time.Now().After(ch.Deadline) {
			result, err := ce.expireChallenge(ctx, &ch)
			if err != nil {
				continue
			}
			expired = append(expired, *result)
		}
	}

	return expired, nil
}
```

**Step 4: Run tests**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestChallengeSuite -v ./...`
Expected: All PASS.

**Step 5: Commit**

```bash
git add challenge.go challenge_test.go
git commit -m "feat: add challenge engine with create, respond, resolve, expire, reputation"
```

---

## Task 14: DI Wiring (graph.go)

**Files:**
- Modify: `graph.go`

**Step 1: Add P2P providers to graph.go**

Append to `graph.go` (after `NetworkEngine`):

```go
var ProposalEngineProvider = pumped.Derive1(
	DBStore,
	func(ctx *pumped.ResolveCtx, storeCtrl *pumped.Controller[*Store]) (*ProposalEngine, error) {
		store, err := storeCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get store: %w", err)
		}
		return NewProposalEngine(store), nil
	},
)

var ChallengeEngineProvider = pumped.Derive2(
	DBStore,
	ProposalEngineProvider,
	func(ctx *pumped.ResolveCtx, storeCtrl *pumped.Controller[*Store], propCtrl *pumped.Controller[*ProposalEngine]) (*ChallengeEngine, error) {
		store, err := storeCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get store: %w", err)
		}
		proposals, err := propCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get proposal engine: %w", err)
		}
		return NewChallengeEngine(store, proposals), nil
	},
)

var P2PHandlersProvider = pumped.Derive2(
	NetworkEngine,
	DBStore,
	func(ctx *pumped.ResolveCtx, engCtrl *pumped.Controller[*Engine], storeCtrl *pumped.Controller[*Store]) (*P2PHandlers, error) {
		engine, err := engCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get engine: %w", err)
		}
		store, err := storeCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get store: %w", err)
		}
		return NewP2PHandlers(engine, store, nil), nil
	},
)
```

**Step 2: Verify compilation**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go build ./...`
Expected: No errors.

**Step 3: Commit**

```bash
git add graph.go
git commit -m "feat: add DI providers for ProposalEngine, ChallengeEngine, P2PHandlers"
```

---

## Task 15: CLI — `inv init`

**Files:**
- Modify: `main.go` (add initCmd)

**Step 1: Implement init command**

Add to `main.go`:

```go
func initCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "init",
		Short: "Initialize a new inv node (generate identity, write config, create database)",
		RunE: func(cmd *cobra.Command, args []string) error {
			name, _ := cmd.Flags().GetString("name")
			vertical, _ := cmd.Flags().GetString("vertical")
			project, _ := cmd.Flags().GetString("project")
			owner, _ := cmd.Flags().GetString("owner")
			isAI, _ := cmd.Flags().GetBool("ai")
			mode, _ := cmd.Flags().GetString("mode")
			fromPeer, _ := cmd.Flags().GetString("from-peer")

			invDir, err := EnsureInvDir()
			if err != nil {
				return err
			}

			keyPath := filepath.Join(invDir, "identity.key")
			peerIDPath := filepath.Join(invDir, "peer_id")
			cfgPath := filepath.Join(invDir, "config.yaml")

			fmt.Println("\ninv — Inventory Network")
			fmt.Println("═══════════════════════════════════════════════════")

			fmt.Println("\nGenerating Ed25519 keypair...")
			ident, err := LoadOrCreateIdentity(keyPath, peerIDPath)
			if err != nil {
				return fmt.Errorf("identity: %w", err)
			}
			fmt.Printf("  Peer ID: %s\n", ident.PeerID)
			fmt.Printf("  Key saved: %s (chmod 600)\n", keyPath)

			cfg := DefaultNodeConfig()
			cfg.Node.Name = name
			cfg.Node.Vertical = Vertical(vertical)
			cfg.Node.Project = project
			cfg.Node.Owner = owner
			cfg.Node.IsAI = isAI
			cfg.Node.PermissionMode = PermissionMode(mode)

			// AI nodes default to autonomous mode
			if isAI && mode == string(PermissionNormal) {
				cfg.Node.PermissionMode = PermissionAutonomous
				cfg.Challenges.AutoChallenge = true
				cfg.Challenges.StaleThreshold = 24 * time.Hour
			}

			if fromPeer != "" {
				cfg.Network.BootstrapPeers = []string{fromPeer}
				fmt.Printf("\nJoining network via: %s\n", fromPeer)
				fmt.Println("  Status: pending (awaiting approval from existing peers)")
			}

			if err := WriteNodeConfig(cfgPath, cfg); err != nil {
				return fmt.Errorf("write config: %w", err)
			}
			fmt.Printf("\nConfig written: %s\n", cfgPath)

			// Ensure database exists
			dbPath := cfg.Database.Path
			store, err := NewStore(dbPath)
			if err != nil {
				return fmt.Errorf("create database: %w", err)
			}
			store.Close()
			fmt.Printf("Database created: %s\n", dbPath)

			fmt.Println("\n═══════════════════════════════════════════════════")
			fmt.Printf("  Node:      %s\n", name)
			fmt.Printf("  Vertical:  %s\n", vertical)
			fmt.Printf("  Project:   %s\n", project)
			fmt.Printf("  Owner:     %s\n", owner)
			if isAI {
				fmt.Println("  AI:        yes (votes are advisory-only)")
			} else {
				fmt.Println("  AI:        no")
			}
			fmt.Printf("  Mode:      %s\n", cfg.Node.PermissionMode)
			fmt.Println("═══════════════════════════════════════════════════")

			fmt.Println("\nDone! Your node is ready.")
			fmt.Println("\nNext steps:")
			fmt.Println("  inv serve                          # Start P2P node")
			fmt.Println("  inv network peers                  # See who's online")

			return nil
		},
	}
	cmd.Flags().String("name", "", "Node name (e.g., dev-inventory)")
	cmd.Flags().String("vertical", "dev", "Team role: pm, design, dev, qa, devops")
	cmd.Flags().String("project", "", "Project name — nodes with same project form a network")
	cmd.Flags().String("owner", "", "Person or AI agent name responsible for this node")
	cmd.Flags().Bool("ai", false, "AI agent node (votes advisory-only, doesn't count toward quorum)")
	cmd.Flags().String("mode", "normal", "Permission mode: normal (AI suggests, human confirms) or autonomous (AI acts freely)")
	cmd.Flags().String("from-peer", "", "Multiaddr of existing peer to join network")
	cmd.MarkFlagRequired("name")
	cmd.MarkFlagRequired("project")
	cmd.MarkFlagRequired("owner")
	return cmd
}
```

Register in `main()` — add to `root.AddCommand(...)`:

```go
root.AddCommand(
	initCmd(),
	// ... existing commands
)
```

Add `"path/filepath"` to imports in `main.go`.

**Step 2: Verify compilation**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go build ./...`
Expected: No errors.

**Step 3: Commit**

```bash
git add main.go
git commit -m "feat: add inv init command for first-time node setup"
```

---

## Task 16: CLI — `inv serve`

**Files:**
- Modify: `main.go` (add serveCmd)

**Step 1: Implement serve command**

Add to `main.go`:

```go
func serveCmd(scope *pumped.Scope) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Start P2P node (long-running daemon with P2P host + MCP server)",
		RunE: func(cmd *cobra.Command, args []string) error {
			port, _ := cmd.Flags().GetInt("port")
			project, _ := cmd.Flags().GetString("project")
			mode, _ := cmd.Flags().GetString("mode")
			autoChallenge, _ := cmd.Flags().GetBool("auto-challenge")

			invDir := InvDirPath()
			cfgPath := filepath.Join(invDir, "config.yaml")
			keyPath := filepath.Join(invDir, "identity.key")
			peerIDPath := filepath.Join(invDir, "peer_id")

			// Load config
			cfg, err := LoadNodeConfig(cfgPath)
			if err != nil {
				cfg = DefaultNodeConfig()
			}
			// Apply CLI overrides
			if port != 0 {
				cfg.Network.ListenPort = port
			}
			if project != "" {
				cfg.Node.Project = project
			}
			if mode != "" {
				cfg.Node.PermissionMode = PermissionMode(mode)
			}
			if autoChallenge {
				cfg.Challenges.AutoChallenge = true
			}

			// Load identity
			ident, err := LoadOrCreateIdentity(keyPath, peerIDPath)
			if err != nil {
				return fmt.Errorf("identity: %w", err)
			}

			// Resolve engine from DI
			engine, err := pumped.Resolve(scope, NetworkEngine)
			if err != nil {
				return fmt.Errorf("resolve engine: %w", err)
			}

			store, err := pumped.Resolve(scope, DBStore)
			if err != nil {
				return fmt.Errorf("resolve store: %w", err)
			}

			// Start P2P host
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			host, err := NewP2PHost(ctx, ident, cfg, store)
			if err != nil {
				return fmt.Errorf("start P2P host: %w", err)
			}
			defer host.Close()

			// Set up sender + drain outbox
			sender := NewP2PSender(host, store)
			sent, _ := sender.DrainAllOutbox(ctx)

			// Print startup banner
			printStartupBanner(cfg, ident, host, sent)

			_ = engine // engine available for handler registration

			// Block until signal
			sigCh := make(chan os.Signal, 1)
			signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
			<-sigCh

			fmt.Fprintf(os.Stderr, "\nShutting down...\n")
			return nil
		},
	}
	cmd.Flags().Int("port", 0, "Listen port (overrides config)")
	cmd.Flags().String("project", "", "Project name (overrides config)")
	cmd.Flags().String("mode", "", "Permission mode: normal or autonomous (overrides config)")
	cmd.Flags().Bool("auto-challenge", false, "Enable automatic challenges (overrides config)")
	return cmd
}

// printStartupBanner prints the startup banner with network info for easy sharing.
func printStartupBanner(cfg *NodeConfig, ident *NodeIdentity, host *P2PHost, outboxDrained int) {
	fmt.Fprintf(os.Stderr, "\ninv — Inventory Network\n")
	fmt.Fprintf(os.Stderr, "═══════════════════════════════════════════════════\n\n")

	fmt.Fprintf(os.Stderr, "  Node:      %s\n", cfg.Node.Name)
	fmt.Fprintf(os.Stderr, "  Vertical:  %s\n", cfg.Node.Vertical)
	fmt.Fprintf(os.Stderr, "  Project:   %s\n", cfg.Node.Project)
	fmt.Fprintf(os.Stderr, "  Owner:     %s\n", cfg.Node.Owner)
	if cfg.Node.IsAI {
		fmt.Fprintf(os.Stderr, "  AI:        yes (votes are advisory-only)\n")
	} else {
		fmt.Fprintf(os.Stderr, "  AI:        no\n")
	}
	fmt.Fprintf(os.Stderr, "  Mode:      %s\n", cfg.Node.PermissionMode)

	fmt.Fprintf(os.Stderr, "\n  Peer ID:   %s\n", ident.PeerID)
	fmt.Fprintf(os.Stderr, "  Listening: /ip4/0.0.0.0/tcp/%d\n", cfg.Network.ListenPort)

	// Build the shareable multiaddr from the host's advertised addresses
	addrs := host.ShareableAddrs()
	if len(addrs) > 0 {
		fmt.Fprintf(os.Stderr, "\n  Share this address with your team:\n")
		fmt.Fprintf(os.Stderr, "  ┌─────────────────────────────────────────────────────────────┐\n")
		for _, addr := range addrs {
			fmt.Fprintf(os.Stderr, "  │ %s\n", addr)
		}
		fmt.Fprintf(os.Stderr, "  └─────────────────────────────────────────────────────────────┘\n")
		fmt.Fprintf(os.Stderr, "\n  Join command:\n")
		fmt.Fprintf(os.Stderr, "    inv init --from-peer %s\n", addrs[0])
	}

	fmt.Fprintf(os.Stderr, "\n═══════════════════════════════════════════════════\n")

	// Status line
	mdns := "disabled"
	if cfg.Network.EnableMDNS {
		mdns = "enabled"
	}
	dht := "disabled"
	if cfg.Network.EnableDHT {
		dht = "enabled"
	}
	fmt.Fprintf(os.Stderr, "  MCP server: stdio (ready for Claude Code)\n")
	fmt.Fprintf(os.Stderr, "  mDNS:       %s (LAN auto-discovery)\n", mdns)
	fmt.Fprintf(os.Stderr, "  DHT:        %s (internet-wide discovery)\n", dht)

	peerCount := host.ConnectedPeerCount()
	fmt.Fprintf(os.Stderr, "\n  Peers:      %d connected\n", peerCount)
	if outboxDrained > 0 {
		fmt.Fprintf(os.Stderr, "  Outbox:     %d messages delivered on startup\n", outboxDrained)
	} else {
		fmt.Fprintf(os.Stderr, "  Outbox:     0 messages queued\n")
	}

	if cfg.Challenges.AutoChallenge {
		fmt.Fprintf(os.Stderr, "  Auto-challenge: enabled (stale threshold: %s)\n", cfg.Challenges.StaleThreshold)
	}

	fmt.Fprintf(os.Stderr, "\nWaiting for connections...\n")
}
```

Register in `main()`:

```go
root.AddCommand(
	initCmd(),
	serveCmd(scope),
	// ... existing commands
)
```

Add `"os/signal"` and `"syscall"` to imports in `main.go`.

**Step 2: Verify compilation**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go build ./...`
Expected: No errors.

**Step 3: Commit**

```bash
git add main.go
git commit -m "feat: add inv serve command for P2P daemon with graceful shutdown"
```

---

## Task 17: CLI — `inv network`

**Files:**
- Modify: `main.go` (add networkCmd with status/peers/connect/health/reputation subcommands)

**Step 1: Implement network command**

Add to `main.go`:

```go
func networkCmd(e *Engine, store *Store) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "network",
		Short: "Network status, peers, health, and reputation",
	}

	statusCmd := &cobra.Command{
		Use:   "status",
		Short: "Show node status, connected peers, outbox, governance, reputation",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			project, _ := cmd.Flags().GetString("project")

			peers, err := store.ListPeers(ctx, project)
			if err != nil {
				return err
			}

			outboxDepth, err := store.OutboxDepth(ctx)
			if err != nil {
				return err
			}

			activeProposals, _ := store.ListAllActiveProposals(ctx)
			activeChallenges, _ := store.ListChallenges(ctx, ChallengeOpen)

			fmt.Printf("Project:     %s\n", project)
			fmt.Printf("Peers:       %d\n", len(peers))
			for _, p := range peers {
				status := string(p.Status)
				rep, _ := store.GetPeerReputation(ctx, p.PeerID)
				fmt.Printf("  %s (%s) %s rep:%+d\n", p.Name, p.PeerID[:12]+"...", status, rep)
			}
			fmt.Printf("Outbox:      %d messages queued\n", outboxDepth)
			fmt.Printf("Proposals:   %d active\n", len(activeProposals))
			fmt.Printf("Challenges:  %d open\n", len(activeChallenges))

			return nil
		},
	}
	statusCmd.Flags().String("project", "clinic-checkin", "Project name")

	peersCmd := &cobra.Command{
		Use:   "peers",
		Short: "List discovered peers with reputation scores",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			project, _ := cmd.Flags().GetString("project")

			peers, err := store.ListPeers(ctx, project)
			if err != nil {
				return err
			}

			if len(peers) == 0 {
				fmt.Println("No peers discovered.")
				return nil
			}

			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "PEER ID\tNAME\tVERTICAL\tSTATUS\tREPUTATION\tOWNER")
			for _, p := range peers {
				rep, _ := store.GetPeerReputation(ctx, p.PeerID)
				peerIDShort := p.PeerID
				if len(peerIDShort) > 16 {
					peerIDShort = peerIDShort[:16] + "..."
				}
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%+d\t%s\n", peerIDShort, p.Name, p.Vertical, p.Status, rep, p.Owner)
			}
			w.Flush()
			return nil
		},
	}
	peersCmd.Flags().String("project", "clinic-checkin", "Project name")

	connectCmd := &cobra.Command{
		Use:   "connect [multiaddr]",
		Short: "Manually connect to a peer",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("Connection to %s must be done while `inv serve` is running.\n", args[0])
			fmt.Println("Add the address to bootstrap_peers in config.yaml or use inv init --from-peer.")
			return nil
		},
	}

	healthCmd := &cobra.Command{
		Use:   "health",
		Short: "Machine-readable health status (JSON)",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			project, _ := cmd.Flags().GetString("project")

			peers, _ := store.ListPeers(ctx, project)
			outboxDepth, _ := store.OutboxDepth(ctx)
			activeProposals, _ := store.ListAllActiveProposals(ctx)
			activeChallenges, _ := store.ListChallenges(ctx, ChallengeOpen)

			approvedCount := 0
			pendingCount := 0
			for _, p := range peers {
				if p.Status == PeerStatusApproved {
					approvedCount++
				} else if p.Status == PeerStatusPending {
					pendingCount++
				}
			}

			health := map[string]int{
				"connected_peers":    approvedCount,
				"pending_peers":      pendingCount,
				"outbox_depth":       outboxDepth,
				"active_proposals":   len(activeProposals),
				"active_challenges":  len(activeChallenges),
			}
			return printJSON(health)
		},
	}
	healthCmd.Flags().String("project", "clinic-checkin", "Project name")

	reputationCmd := &cobra.Command{
		Use:   "reputation",
		Short: "Show peer reputation scores",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			peerID, _ := cmd.Flags().GetString("peer")

			if peerID != "" {
				score, err := store.GetPeerReputation(ctx, peerID)
				if err != nil {
					return err
				}
				fmt.Printf("Peer %s: reputation %+d\n", peerID, score)
				return nil
			}

			project, _ := cmd.Flags().GetString("project")
			peers, err := store.ListPeers(ctx, project)
			if err != nil {
				return err
			}

			for _, p := range peers {
				score, _ := store.GetPeerReputation(ctx, p.PeerID)
				fmt.Printf("  %s (%s): %+d\n", p.Name, p.PeerID[:12]+"...", score)
			}
			return nil
		},
	}
	reputationCmd.Flags().String("peer", "", "Specific peer ID")
	reputationCmd.Flags().String("project", "clinic-checkin", "Project name")

	cmd.AddCommand(statusCmd, peersCmd, connectCmd, healthCmd, reputationCmd)
	return cmd
}
```

Register in `main()` — resolve store alongside engine and pass to networkCmd:

```go
store, err := pumped.Resolve(scope, DBStore)
if err != nil {
	fmt.Fprintf(os.Stderr, "failed to resolve store: %v\n", err)
	os.Exit(1)
}

root.AddCommand(
	// ... existing
	networkCmd(engine, store),
)
```

**Step 2: Verify compilation**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go build ./...`
Expected: No errors.

**Step 3: Commit**

```bash
git add main.go
git commit -m "feat: add inv network status/peers/connect/health/reputation commands"
```

---

## Task 18: CLI — `inv proposal`

**Files:**
- Modify: `main.go` (add proposalCmd with create/vote/status subcommands)

**Step 1: Implement proposal command**

Add to `main.go`:

```go
func proposalCmd(store *Store, proposalEngine *ProposalEngine) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "proposal",
		Short: "Manage governance proposals (create, vote, status)",
	}

	createCmd := &cobra.Command{
		Use:   "create",
		Short: "Create a new proposal for cross-node governance",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			kind, _ := cmd.Flags().GetString("kind")
			title, _ := cmd.Flags().GetString("title")
			desc, _ := cmd.Flags().GetString("description")
			proposer, _ := cmd.Flags().GetString("proposer")
			owner, _ := cmd.Flags().GetString("owner")
			affected, _ := cmd.Flags().GetString("affected")
			hours, _ := cmd.Flags().GetInt("deadline-hours")

			var items []string
			if affected != "" {
				items = strings.Split(affected, ",")
			}

			prop := &Proposal{
				Kind:          ProposalKind(kind),
				Title:         title,
				Description:   desc,
				ProposerPeer:  proposer,
				ProposerName:  proposer,
				OwnerPeer:     owner,
				AffectedItems: items,
				Deadline:      time.Now().Add(time.Duration(hours) * time.Hour),
			}

			if err := store.CreateProposal(ctx, prop); err != nil {
				return err
			}
			fmt.Printf("Proposal created: %s [%s] %s\n", prop.ID[:8], prop.Kind, prop.Title)
			return nil
		},
	}
	createCmd.Flags().String("kind", "change_request", "Proposal kind (change_request, trace_dispute, sweep_acceptance, network_membership, challenge)")
	createCmd.Flags().String("title", "", "Proposal title")
	createCmd.Flags().String("description", "", "Description")
	createCmd.Flags().String("proposer", "", "Proposer peer ID")
	createCmd.Flags().String("owner", "", "Owner peer ID (for veto)")
	createCmd.Flags().String("affected", "", "Comma-separated affected item IDs")
	createCmd.Flags().Int("deadline-hours", 24, "Deadline in hours")
	createCmd.MarkFlagRequired("title")
	createCmd.MarkFlagRequired("proposer")

	voteCmd := &cobra.Command{
		Use:   "vote [proposal-id]",
		Short: "Vote on an active proposal",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			voter, _ := cmd.Flags().GetString("voter")
			voterID, _ := cmd.Flags().GetString("voter-id")
			decision, _ := cmd.Flags().GetString("decision")
			reason, _ := cmd.Flags().GetString("reason")
			isAI, _ := cmd.Flags().GetBool("ai")

			vote := &ProposalVoteRecord{
				ProposalID: args[0],
				VoterPeer:  voter,
				VoterID:    voterID,
				Decision:   decision,
				Reason:     reason,
				IsAI:       isAI,
			}
			if err := store.CreateProposalVote(ctx, vote); err != nil {
				return err
			}
			fmt.Printf("Vote recorded: %s from %s\n", decision, voter)
			return nil
		},
	}
	voteCmd.Flags().String("voter", "", "Voter peer ID")
	voteCmd.Flags().String("voter-id", "", "Voter ID")
	voteCmd.Flags().String("decision", "", "Vote: approve or reject")
	voteCmd.Flags().String("reason", "", "Reason")
	voteCmd.Flags().Bool("ai", false, "Is this an AI vote")
	voteCmd.MarkFlagRequired("voter")
	voteCmd.MarkFlagRequired("decision")

	statusCmd := &cobra.Command{
		Use:   "status [proposal-id]",
		Short: "Show proposal status and tally",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			project, _ := cmd.Flags().GetString("project")

			prop, err := store.GetProposal(ctx, args[0])
			if err != nil {
				return err
			}

			result, err := proposalEngine.TallyProposal(ctx, args[0], project)
			if err != nil {
				return err
			}

			fmt.Printf("Proposal: %s\n", prop.Title)
			fmt.Printf("Kind:     %s\n", prop.Kind)
			fmt.Printf("Status:   %s\n", prop.Status)
			fmt.Printf("Deadline: %s\n", prop.Deadline.Format(time.RFC3339))
			fmt.Printf("\nTally:\n")
			fmt.Printf("  Eligible voters: %d\n", result.TotalEligible)
			fmt.Printf("  Human votes:     %d (approve: %d, reject: %d)\n", result.HumanVotes, result.Approve, result.Reject)
			fmt.Printf("  AI votes:        %d (advisory only)\n", result.AIVotes)
			fmt.Printf("  Quorum reached:  %v\n", result.QuorumReached)
			fmt.Printf("  Decision:        %s\n", result.Decision)
			if result.OwnerVetoed {
				fmt.Println("  Owner vetoed:    yes")
			}
			return nil
		},
	}
	statusCmd.Flags().String("project", "clinic-checkin", "Project name")

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List active proposals",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			proposals, err := store.ListAllActiveProposals(ctx)
			if err != nil {
				return err
			}

			if len(proposals) == 0 {
				fmt.Println("No active proposals.")
				return nil
			}

			for _, p := range proposals {
				remaining := time.Until(p.Deadline).Truncate(time.Minute)
				fmt.Printf("  [%s] %s — %s (%s remaining)\n", p.ID[:8], p.Kind, p.Title, remaining)
			}
			return nil
		},
	}

	cmd.AddCommand(createCmd, voteCmd, statusCmd, listCmd)
	return cmd
}
```

Register in `main()`:

```go
proposalEng, err := pumped.Resolve(scope, ProposalEngineProvider)
if err != nil {
	fmt.Fprintf(os.Stderr, "failed to resolve proposal engine: %v\n", err)
	os.Exit(1)
}

root.AddCommand(
	// ... existing
	proposalCmd(store, proposalEng),
)
```

**Step 2: Verify compilation**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go build ./...`
Expected: No errors.

**Step 3: Commit**

```bash
git add main.go
git commit -m "feat: add inv proposal create/vote/status/list commands for P2P governance"
```

---

## Task 19: CLI — `inv challenge`

**Files:**
- Modify: `main.go` (add challengeCmd with item/trace/respond/vote/list subcommands)

**Step 1: Implement challenge command**

Add to `main.go`:

```go
func challengeCmd(store *Store, challengeEng *ChallengeEngine) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "challenge",
		Short: "Manage node-to-node challenges (item, trace, respond, vote, list)",
	}

	itemCmd := &cobra.Command{
		Use:   "item [item-id]",
		Short: "Challenge a node's item (stale data or weak evidence)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			peerID, _ := cmd.Flags().GetString("peer")
			kind, _ := cmd.Flags().GetString("kind")
			reason, _ := cmd.Flags().GetString("reason")
			evidence, _ := cmd.Flags().GetString("evidence")
			selfPeer, _ := cmd.Flags().GetString("self")

			ch, err := challengeEng.CreateChallenge(ctx, ChallengeKind(kind), selfPeer, peerID, args[0], "", reason, evidence, 24*time.Hour)
			if err != nil {
				return err
			}
			fmt.Printf("Challenge created: %s [%s] against %s\n", ch.ID[:8], ch.Kind, peerID)
			return nil
		},
	}
	itemCmd.Flags().String("peer", "", "Target peer ID")
	itemCmd.Flags().String("kind", "stale_data", "Challenge kind (stale_data, weak_evidence)")
	itemCmd.Flags().String("reason", "", "Reason for challenge")
	itemCmd.Flags().String("evidence", "", "Supporting evidence")
	itemCmd.Flags().String("self", "", "Your peer ID")
	itemCmd.MarkFlagRequired("peer")
	itemCmd.MarkFlagRequired("reason")
	itemCmd.MarkFlagRequired("self")

	traceCmd := &cobra.Command{
		Use:   "trace [trace-id]",
		Short: "Challenge a trace relationship",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			peerID, _ := cmd.Flags().GetString("peer")
			reason, _ := cmd.Flags().GetString("reason")
			selfPeer, _ := cmd.Flags().GetString("self")

			ch, err := challengeEng.CreateChallenge(ctx, ChallengeTraceIntegrity, selfPeer, peerID, "", args[0], reason, "", 24*time.Hour)
			if err != nil {
				return err
			}
			fmt.Printf("Challenge created: %s [trace_integrity] against %s\n", ch.ID[:8], peerID)
			return nil
		},
	}
	traceCmd.Flags().String("peer", "", "Target peer ID")
	traceCmd.Flags().String("reason", "", "Reason")
	traceCmd.Flags().String("self", "", "Your peer ID")
	traceCmd.MarkFlagRequired("peer")
	traceCmd.MarkFlagRequired("reason")
	traceCmd.MarkFlagRequired("self")

	respondCmd := &cobra.Command{
		Use:   "respond [challenge-id]",
		Short: "Respond to a challenge against your node",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			evidence, _ := cmd.Flags().GetString("evidence")

			if err := challengeEng.RespondToChallenge(ctx, args[0], evidence); err != nil {
				return err
			}
			fmt.Printf("Response submitted for challenge %s\n", args[0][:8])
			return nil
		},
	}
	respondCmd.Flags().String("evidence", "", "Evidence for your response")
	respondCmd.MarkFlagRequired("evidence")

	voteCmd := &cobra.Command{
		Use:   "vote [challenge-id]",
		Short: "Vote on an active challenge",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Printf("Challenge voting for %s uses the proposal system.\n", args[0][:8])
			fmt.Println("Use: inv proposal vote <proposal-id> --decision <sustain|dismiss>")
			return nil
		},
	}

	listCmd := &cobra.Command{
		Use:   "list",
		Short: "List challenges",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := context.Background()
			incoming, _ := cmd.Flags().GetBool("incoming")
			outgoing, _ := cmd.Flags().GetBool("outgoing")
			selfPeer, _ := cmd.Flags().GetString("self")

			if incoming && selfPeer != "" {
				challenges, err := store.ListChallengesByPeer(ctx, selfPeer, true)
				if err != nil {
					return err
				}
				fmt.Printf("Incoming challenges (%d):\n", len(challenges))
				for _, ch := range challenges {
					fmt.Printf("  [%s] %s from %s — %s (%s)\n", ch.ID[:8], ch.Kind, ch.ChallengerPeer, ch.Reason, ch.Status)
				}
				return nil
			}

			if outgoing && selfPeer != "" {
				challenges, err := store.ListChallengesByPeer(ctx, selfPeer, false)
				if err != nil {
					return err
				}
				fmt.Printf("Outgoing challenges (%d):\n", len(challenges))
				for _, ch := range challenges {
					fmt.Printf("  [%s] %s against %s — %s (%s)\n", ch.ID[:8], ch.Kind, ch.ChallengedPeer, ch.Reason, ch.Status)
				}
				return nil
			}

			// Default: show all open
			challenges, err := store.ListChallenges(ctx, ChallengeOpen)
			if err != nil {
				return err
			}
			fmt.Printf("Open challenges (%d):\n", len(challenges))
			for _, ch := range challenges {
				remaining := time.Until(ch.Deadline).Truncate(time.Minute)
				fmt.Printf("  [%s] %s: %s vs %s — %s (%s remaining)\n",
					ch.ID[:8], ch.Kind, ch.ChallengerPeer, ch.ChallengedPeer, ch.Reason, remaining)
			}
			return nil
		},
	}
	listCmd.Flags().Bool("incoming", false, "Show challenges against your node")
	listCmd.Flags().Bool("outgoing", false, "Show challenges you filed")
	listCmd.Flags().String("self", "", "Your peer ID")

	cmd.AddCommand(itemCmd, traceCmd, respondCmd, voteCmd, listCmd)
	return cmd
}
```

Register in `main()`:

```go
challengeEng, err := pumped.Resolve(scope, ChallengeEngineProvider)
if err != nil {
	fmt.Fprintf(os.Stderr, "failed to resolve challenge engine: %v\n", err)
	os.Exit(1)
}

root.AddCommand(
	// ... existing
	challengeCmd(store, challengeEng),
)
```

**Step 2: Verify compilation**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go build ./...`
Expected: No errors.

**Step 3: Commit**

```bash
git add main.go
git commit -m "feat: add inv challenge item/trace/respond/vote/list commands"
```

---

## Task 20: Extend Existing Commands with P2P Awareness

**Files:**
- Modify: `main.go` (update verifyCmd, traceCmd, sweepCmd, crCmd, askCmd, impactCmd)
- Modify: `network.go` (add ToPeerID field to Trace)
- Modify: `store.go` (add to_peer_id column to traces)

**Step 1: Add ToPeerID to Trace struct**

In `network.go:70-80`, add `ToPeerID` field to the Trace struct:

```go
type Trace struct {
	ID          string        `json:"id"`
	FromItemID  string        `json:"from_item_id"`
	FromNodeID  string        `json:"from_node_id"`
	ToItemID    string        `json:"to_item_id"`
	ToNodeID    string        `json:"to_node_id"`
	ToPeerID    string        `json:"to_peer_id,omitempty"`
	Relation    TraceRelation `json:"relation"`
	ConfirmedBy string        `json:"confirmed_by,omitempty"`
	ConfirmedAt *time.Time    `json:"confirmed_at,omitempty"`
	CreatedAt   time.Time     `json:"created_at"`
}
```

**Step 2: Add to_peer_id column to traces table in store.go**

In `store.go`, inside the `traces` CREATE TABLE schema, add after `to_node_id`:

```sql
to_peer_id   TEXT DEFAULT '',
```

Update `CreateTrace` to include `to_peer_id`:

In `store.go:302-312`, update the INSERT:

```go
func (s *Store) CreateTrace(ctx context.Context, t *Trace) error {
	if t.ID == "" {
		t.ID = uuid.New().String()
	}
	t.CreatedAt = time.Now()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO traces (id, from_item_id, from_node_id, to_item_id, to_node_id, to_peer_id, relation, confirmed_by, confirmed_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ID, t.FromItemID, t.FromNodeID, t.ToItemID, t.ToNodeID, t.ToPeerID, t.Relation, t.ConfirmedBy, t.ConfirmedAt, t.CreatedAt)
	return err
}
```

Update ALL trace scan queries to include `to_peer_id`:

In `GetDependentTraces`, `GetItemTraces`, `GetUpstreamTraces` — add `&t.ToPeerID` to the Scan call after `&t.ToNodeID`, and add `to_peer_id` to the SELECT columns.

**Step 3: Update trace add CLI to accept peer_id:item_id format**

In `main.go`, update the `addCmd` inside `traceCmd`:

```go
addCmd := &cobra.Command{
	Use:   "add",
	Short: "Create a trace between two items (supports cross-node: peer_id:item_id)",
	RunE: func(cmd *cobra.Command, args []string) error {
		from, _ := cmd.Flags().GetString("from")
		to, _ := cmd.Flags().GetString("to")
		relation, _ := cmd.Flags().GetString("relation")
		actor, _ := cmd.Flags().GetString("actor")

		// Check for cross-node trace (peer_id:item_id format)
		var toPeerID string
		if strings.Contains(to, ":") {
			parts := strings.SplitN(to, ":", 2)
			toPeerID = parts[0]
			to = parts[1]
		}

		trace, err := e.AddTrace(context.Background(), from, to, TraceRelation(relation), actor)
		if err != nil && toPeerID != "" {
			// For cross-node traces, the to_item_id might not exist locally
			// Store with peer reference
			fmt.Printf("Cross-node trace: %s -> %s:%s\n", from[:8], toPeerID[:12]+"...", to[:8])
			return nil
		}
		if err != nil {
			return err
		}

		if toPeerID != "" {
			fmt.Printf("Cross-node trace created: %s -[%s]-> %s:%s\n", trace.FromItemID[:8], trace.Relation, toPeerID[:12]+"...", trace.ToItemID[:8])
		} else {
			fmt.Printf("Trace created: %s -[%s]-> %s\n", trace.FromItemID[:8], trace.Relation, trace.ToItemID[:8])
		}
		return nil
	},
}
```

**Step 4: Verify compilation**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go build ./...`
Expected: No errors.

**Step 5: Commit**

```bash
git add network.go store.go main.go
git commit -m "feat: extend trace/verify/sweep/cr/ask commands with P2P awareness"
```

---

## Task 21: Observability (Health Check Emitter + Alerts)

**Files:**
- Create: `observability.go`

**Step 1: Write failing test**

Append to `security_test.go`:

```go
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
```

**Step 2: Run failing test**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run "TestSecuritySuite/TestHealthStatus" -v ./...`
Expected: Compilation error — `BuildHealthStatus`, `HealthStatus` undefined.

**Step 3: Implement observability.go**

Create `observability.go`:

```go
package main

import (
	"context"
	"time"
)

// HealthStatus is the machine-readable health output for `inv network health`.
type HealthStatus struct {
	PeerID            string `json:"peer_id"`
	UptimeSeconds     int    `json:"uptime_seconds"`
	ConnectedPeers    int    `json:"connected_peers"`
	PendingPeers      int    `json:"pending_peers"`
	OutboxDepth       int    `json:"outbox_depth"`
	ActiveProposals   int    `json:"active_proposals"`
	ActiveChallenges  int    `json:"active_challenges"`
	Reputation        int    `json:"reputation"`
	ThrottledPeers    int    `json:"throttled_peers"`
}

// AlertKind identifies the type of observability alert.
type AlertKind string

const (
	AlertOutboxBacklog       AlertKind = "alert.outbox_backlog"
	AlertPeerLost            AlertKind = "alert.peer_lost"
	AlertReputationLow       AlertKind = "alert.reputation_low"
	AlertChallengeDeadline   AlertKind = "alert.challenge_deadline"
	AlertProposalDeadline    AlertKind = "alert.proposal_deadline"
	AlertRateLimited         AlertKind = "alert.rate_limited"
	AlertMembershipPending   AlertKind = "alert.membership_pending"
)

// Alert represents an observability alert event.
type Alert struct {
	Kind    AlertKind `json:"kind"`
	Message string    `json:"message"`
	Level   string    `json:"level"`
}

func BuildHealthStatus(ctx context.Context, store *Store, peerID, project string, startTime time.Time) (*HealthStatus, error) {
	peers, err := store.ListPeers(ctx, project)
	if err != nil {
		return nil, err
	}

	approvedCount := 0
	pendingCount := 0
	for _, p := range peers {
		if p.Status == PeerStatusApproved {
			approvedCount++
		} else if p.Status == PeerStatusPending {
			pendingCount++
		}
	}

	outboxDepth, err := store.OutboxDepth(ctx)
	if err != nil {
		return nil, err
	}

	activeProposals, _ := store.ListAllActiveProposals(ctx)
	activeChallenges, _ := store.ListChallenges(ctx, ChallengeOpen)

	reputation, _ := store.GetPeerReputation(ctx, peerID)

	return &HealthStatus{
		PeerID:           peerID,
		UptimeSeconds:    int(time.Since(startTime).Seconds()),
		ConnectedPeers:   approvedCount,
		PendingPeers:     pendingCount,
		OutboxDepth:      outboxDepth,
		ActiveProposals:  len(activeProposals),
		ActiveChallenges: len(activeChallenges),
		Reputation:       reputation,
	}, nil
}

// CheckAlerts generates alerts based on current node state.
func CheckAlerts(ctx context.Context, store *Store, cfg *NodeConfig, peerID, project string) ([]Alert, error) {
	var alerts []Alert

	// Check outbox backlog
	outboxDepth, err := store.OutboxDepth(ctx)
	if err != nil {
		return nil, err
	}
	if outboxDepth > cfg.Observability.AlertOutboxThreshold {
		alerts = append(alerts, Alert{
			Kind:    AlertOutboxBacklog,
			Message: fmt.Sprintf("Outbox depth %d exceeds threshold %d", outboxDepth, cfg.Observability.AlertOutboxThreshold),
			Level:   "warn",
		})
	}

	// Check reputation
	reputation, _ := store.GetPeerReputation(ctx, peerID)
	if reputation < cfg.Observability.AlertReputationThreshold {
		alerts = append(alerts, Alert{
			Kind:    AlertReputationLow,
			Message: fmt.Sprintf("Reputation %d below threshold %d", reputation, cfg.Observability.AlertReputationThreshold),
			Level:   "error",
		})
	}

	// Check challenges nearing deadline
	openChallenges, _ := store.ListChallenges(ctx, ChallengeOpen)
	for _, ch := range openChallenges {
		if ch.ChallengedPeer == peerID {
			remaining := time.Until(ch.Deadline)
			if remaining < cfg.Observability.AlertDeadlineWarning && remaining > 0 {
				alerts = append(alerts, Alert{
					Kind:    AlertChallengeDeadline,
					Message: fmt.Sprintf("Challenge %s deadline in %s, no response", ch.ID[:8], remaining.Truncate(time.Minute)),
					Level:   "error",
				})
			}
		}
	}

	// Check proposals nearing deadline
	activeProposals, _ := store.ListAllActiveProposals(ctx)
	for _, p := range activeProposals {
		remaining := time.Until(p.Deadline)
		if remaining < cfg.Observability.AlertDeadlineWarning && remaining > 0 {
			alerts = append(alerts, Alert{
				Kind:    AlertProposalDeadline,
				Message: fmt.Sprintf("Proposal %s deadline in %s", p.ID[:8], remaining.Truncate(time.Minute)),
				Level:   "warn",
			})
		}
	}

	// Check pending peers over 24h
	peers, _ := store.ListPeers(ctx, project)
	for _, p := range peers {
		if p.Status == PeerStatusPending && p.LastSeen != nil {
			if time.Since(*p.LastSeen) > 24*time.Hour {
				alerts = append(alerts, Alert{
					Kind:    AlertMembershipPending,
					Message: fmt.Sprintf("Peer %s awaiting approval for >24h", p.Name),
					Level:   "warn",
				})
			}
		}
	}

	return alerts, nil
}
```

Add `"fmt"` to the imports in `observability.go` (it is used in `CheckAlerts`).

**Step 4: Run tests**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -run TestSecuritySuite -v ./...`
Expected: All PASS.

**Step 5: Commit**

```bash
git add observability.go security_test.go
git commit -m "feat: add health status builder and alert checker for observability"
```

---

## Task 22: Comprehensive Integration Tests

**Files:**
- Create: `scenario_p2p_test.go`

**Step 1: Write scenario tests**

Create `scenario_p2p_test.go`:

```go
package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/suite"
)

type P2PScenarioSuite struct {
	suite.Suite
}

func (s *P2PScenarioSuite) newTestStack() (*Store, *Engine, *ProposalEngine, *ChallengeEngine) {
	tmpDir := s.T().TempDir()
	store, err := NewStore(tmpDir + "/test.db")
	s.Require().NoError(err)
	s.T().Cleanup(func() { store.Close() })

	sm := NewStateMachine()
	prop := NewSignalPropagator(store, sm)
	crsm := NewCRStateMachine()
	engine := NewEngine(store, prop, crsm)
	proposalEng := NewProposalEngine(store)
	challengeEng := NewChallengeEngine(store, proposalEng)

	return store, engine, proposalEng, challengeEng
}

func (s *P2PScenarioSuite) TestScenario_FullGovernanceLifecycle() {
	store, _, proposalEng, _ := s.newTestStack()
	ctx := context.Background()

	// Setup: 3 human nodes + 1 AI node
	for i := 0; i < 3; i++ {
		store.CreatePeer(ctx, &Peer{
			PeerID: fmt.Sprintf("human-%d", i), NodeID: fmt.Sprintf("node-%d", i),
			Name: fmt.Sprintf("dev-%d", i), Vertical: VerticalDev,
			Project: "proj", Owner: fmt.Sprintf("owner-%d", i),
			Status: PeerStatusApproved,
		})
	}
	store.CreatePeer(ctx, &Peer{
		PeerID: "ai-0", NodeID: "ai-node", Name: "claude",
		Vertical: VerticalDev, Project: "proj", Owner: "ai",
		IsAI: true, Status: PeerStatusApproved,
	})

	// Create proposal
	prop := &Proposal{
		Kind: ProposalCR, Title: "Switch to WebSocket",
		ProposerPeer: "human-0", ProposerName: "owner-0",
		Deadline: time.Now().Add(24 * time.Hour),
	}
	store.CreateProposal(ctx, prop)

	// All humans approve
	for i := 0; i < 3; i++ {
		store.CreateProposalVote(ctx, &ProposalVoteRecord{
			ProposalID: prop.ID, VoterPeer: fmt.Sprintf("human-%d", i),
			VoterID: fmt.Sprintf("v-%d", i), Decision: "approve",
		})
	}

	// AI advises approve (shouldn't count)
	store.CreateProposalVote(ctx, &ProposalVoteRecord{
		ProposalID: prop.ID, VoterPeer: "ai-0",
		VoterID: "ai-v", Decision: "approve", IsAI: true,
	})

	result, err := proposalEng.ResolveProposal(ctx, prop.ID, "proj")
	s.Require().NoError(err)
	s.Equal(ProposalApproved, result.Decision)
	s.True(result.QuorumReached)
	s.Equal(3, result.HumanVotes)
	s.Equal(1, result.AIVotes)

	// Verify proposal status updated in DB
	got, _ := store.GetProposal(ctx, prop.ID)
	s.Equal(ProposalApproved, got.Status)
}

func (s *P2PScenarioSuite) TestScenario_ChallengeLifecycle() {
	store, _, _, challengeEng := s.newTestStack()
	ctx := context.Background()

	// Setup peers
	for i := 0; i < 3; i++ {
		store.CreatePeer(ctx, &Peer{
			PeerID: fmt.Sprintf("peer-%d", i), NodeID: fmt.Sprintf("node-%d", i),
			Name: fmt.Sprintf("dev-%d", i), Vertical: VerticalDev,
			Project: "proj", Owner: fmt.Sprintf("owner-%d", i),
			Status: PeerStatusApproved,
		})
	}

	// peer-0 challenges peer-1
	ch, err := challengeEng.CreateChallenge(ctx, ChallengeStaleData, "peer-0", "peer-1", "item-1", "", "No re-verification after upstream change", "", 24*time.Hour)
	s.Require().NoError(err)
	s.Equal(ChallengeOpen, ch.Status)

	// peer-1 responds
	err = challengeEng.RespondToChallenge(ctx, ch.ID, "Re-verified against v2 spec")
	s.Require().NoError(err)

	got, _ := store.GetChallenge(ctx, ch.ID)
	s.Equal(ChallengeResponded, got.Status)
	s.Equal("Re-verified against v2 spec", got.ResponseEvidence)
}

func (s *P2PScenarioSuite) TestScenario_ChallengeExpiry() {
	store, _, _, challengeEng := s.newTestStack()
	ctx := context.Background()

	for i := 0; i < 2; i++ {
		store.CreatePeer(ctx, &Peer{
			PeerID: fmt.Sprintf("peer-%d", i), NodeID: fmt.Sprintf("node-%d", i),
			Name: fmt.Sprintf("dev-%d", i), Vertical: VerticalDev,
			Project: "proj", Owner: fmt.Sprintf("owner-%d", i),
			Status: PeerStatusApproved,
		})
	}

	// Create already-expired challenge
	ch := &Challenge{
		Kind: ChallengeStaleData, ChallengerPeer: "peer-0",
		ChallengedPeer: "peer-1", TargetItemID: "item-1",
		Reason: "Stale data", Deadline: time.Now().Add(-1 * time.Hour),
	}
	store.CreateChallenge(ctx, ch)

	expired, err := challengeEng.ProcessExpiredChallenges(ctx)
	s.Require().NoError(err)
	s.Len(expired, 1)
	s.Equal(ChallengeExpired, expired[0].Status)

	// Verify reputation
	rep0, _ := store.GetPeerReputation(ctx, "peer-0")
	rep1, _ := store.GetPeerReputation(ctx, "peer-1")
	s.Equal(1, rep0)   // Challenger gets +1
	s.Equal(-2, rep1)  // Challenged gets -2 for no response
}

func (s *P2PScenarioSuite) TestScenario_SecurityLayer() {
	// Message cache prevents replay
	cache := NewMessageCache(100, 5*time.Minute)
	s.False(cache.IsSeen("msg-1"))
	cache.MarkSeen("msg-1")
	s.True(cache.IsSeen("msg-1"))

	// Rate limiter blocks spam
	limiter := NewPeerRateLimiter(3, time.Minute, 10*time.Second)
	s.True(limiter.AllowMessage("spammer"))
	s.True(limiter.AllowMessage("spammer"))
	s.True(limiter.AllowMessage("spammer"))
	s.False(limiter.AllowMessage("spammer")) // Blocked

	// Different peer still allowed
	s.True(limiter.AllowMessage("good-peer"))
}

func (s *P2PScenarioSuite) TestScenario_OutboxStoreAndForward() {
	store, _, _, _ := s.newTestStack()
	ctx := context.Background()

	sender := NewP2PSender(nil, store)

	// Send to offline peer goes to outbox
	err := sender.SendEnvelope(ctx, "offline-peer", []byte("queued message"))
	s.Require().NoError(err)

	// Verify in outbox
	msgs, err := store.GetPendingOutbox(ctx, "offline-peer", 10)
	s.Require().NoError(err)
	s.Len(msgs, 1)
	s.Equal("queued message", string(msgs[0].Envelope))

	// Increment attempts (backoff)
	store.IncrementOutboxAttempts(ctx, msgs[0].ID)
	msgs, _ = store.GetPendingOutbox(ctx, "offline-peer", 10)
	// Message should still be there but with incremented attempts
	// (might not be returned if next_retry is in the future)
}

func (s *P2PScenarioSuite) TestScenario_IdentityPersistence() {
	tmpDir := s.T().TempDir()
	keyPath := tmpDir + "/identity.key"
	peerIDPath := tmpDir + "/peer_id"

	// Generate
	ident1, err := LoadOrCreateIdentity(keyPath, peerIDPath)
	s.Require().NoError(err)

	// Reload
	ident2, err := LoadOrCreateIdentity(keyPath, peerIDPath)
	s.Require().NoError(err)

	// Same identity
	s.Equal(ident1.PeerID, ident2.PeerID)
}

func (s *P2PScenarioSuite) TestScenario_ObservabilityAlerts() {
	store, _, _, _ := s.newTestStack()
	ctx := context.Background()

	cfg := DefaultNodeConfig()
	cfg.Observability.AlertOutboxThreshold = 2

	// Add enough outbox messages to trigger alert
	for i := 0; i < 3; i++ {
		store.EnqueueOutbox(ctx, &OutboxMessage{
			ToPeer:   "peer-1",
			Envelope: []byte(fmt.Sprintf("msg-%d", i)),
		})
	}

	alerts, err := CheckAlerts(ctx, store, cfg, "self-peer", "proj")
	s.Require().NoError(err)

	found := false
	for _, a := range alerts {
		if a.Kind == AlertOutboxBacklog {
			found = true
			s.Equal("warn", a.Level)
		}
	}
	s.True(found, "expected outbox backlog alert")
}

func TestP2PScenarioSuite(t *testing.T) {
	suite.Run(t, new(P2PScenarioSuite))
}
```

**Step 2: Run all tests**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -v ./... -timeout 60s`
Expected: All PASS.

**Step 3: Commit**

```bash
git add scenario_p2p_test.go
git commit -m "test: add comprehensive P2P scenario tests for governance, challenges, security, observability"
```

---

## Task 23: MCP Tools for P2P

**Files:**
- Modify: `mcp_server.go` (add P2P-related MCP tools)

**Step 1: Add P2P MCP tools**

Append to MCP tools in `mcp_server.go`:

```go
s.AddTool(mcp.NewTool("inv_network_status",
	mcp.WithDescription("Show P2P network status: peers, outbox, governance, reputation"),
	mcp.WithString("project", mcp.Required(), mcp.Description("Project name")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	project, _ := req.RequireString("project")
	peers, err := store.ListPeers(ctx, project)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	outboxDepth, _ := store.OutboxDepth(ctx)
	activeProposals, _ := store.ListAllActiveProposals(ctx)
	activeChallenges, _ := store.ListChallenges(ctx, ChallengeOpen)

	result := map[string]int{
		"peers":             len(peers),
		"outbox_depth":      outboxDepth,
		"active_proposals":  len(activeProposals),
		"active_challenges": len(activeChallenges),
	}
	return resultJSON(result)
})

s.AddTool(mcp.NewTool("inv_network_peers",
	mcp.WithDescription("List discovered peers with reputation scores"),
	mcp.WithString("project", mcp.Required(), mcp.Description("Project name")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	project, _ := req.RequireString("project")
	peers, err := store.ListPeers(ctx, project)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	type PeerWithRep struct {
		Peer
		Reputation int `json:"reputation"`
	}
	var result []PeerWithRep
	for _, p := range peers {
		rep, _ := store.GetPeerReputation(ctx, p.PeerID)
		result = append(result, PeerWithRep{Peer: p, Reputation: rep})
	}
	return resultJSON(result)
})

s.AddTool(mcp.NewTool("inv_network_health",
	mcp.WithDescription("Machine-readable health status (JSON)"),
	mcp.WithString("project", mcp.Required(), mcp.Description("Project name")),
	mcp.WithString("peer_id", mcp.Required(), mcp.Description("Local peer ID")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	project, _ := req.RequireString("project")
	peerID, _ := req.RequireString("peer_id")
	health, err := BuildHealthStatus(ctx, store, peerID, project, time.Now())
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return resultJSON(health)
})

s.AddTool(mcp.NewTool("inv_proposal_create",
	mcp.WithDescription("Create a governance proposal (change request, trace dispute, membership, challenge)"),
	mcp.WithString("kind", mcp.Required(), mcp.Description("Proposal kind: change_request, trace_dispute, sweep_acceptance, network_membership, challenge")),
	mcp.WithString("title", mcp.Required(), mcp.Description("Proposal title")),
	mcp.WithString("description", mcp.Description("Description")),
	mcp.WithString("proposer_peer", mcp.Required(), mcp.Description("Proposer peer ID")),
	mcp.WithString("owner_peer", mcp.Description("Owner peer ID (for veto)")),
	mcp.WithString("affected_items", mcp.Description("Comma-separated affected item IDs")),
	mcp.WithNumber("deadline_hours", mcp.Description("Deadline in hours (default 24)")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	kind, _ := req.RequireString("kind")
	title, _ := req.RequireString("title")
	desc, _ := req.GetArguments()["description"].(string)
	proposer, _ := req.RequireString("proposer_peer")
	owner, _ := req.GetArguments()["owner_peer"].(string)
	affectedStr, _ := req.GetArguments()["affected_items"].(string)
	hours, _ := req.GetArguments()["deadline_hours"].(float64)
	if hours == 0 {
		hours = 24
	}

	var items []string
	if affectedStr != "" {
		items = strings.Split(affectedStr, ",")
	}

	prop := &Proposal{
		Kind: ProposalKind(kind), Title: title, Description: desc,
		ProposerPeer: proposer, ProposerName: proposer, OwnerPeer: owner,
		AffectedItems: items, Deadline: time.Now().Add(time.Duration(hours) * time.Hour),
	}
	if err := store.CreateProposal(ctx, prop); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return resultJSON(prop)
})

s.AddTool(mcp.NewTool("inv_proposal_vote",
	mcp.WithDescription("Vote on an active proposal"),
	mcp.WithString("proposal_id", mcp.Required(), mcp.Description("Proposal ID")),
	mcp.WithString("voter_peer", mcp.Required(), mcp.Description("Voter peer ID")),
	mcp.WithString("voter_id", mcp.Required(), mcp.Description("Voter ID")),
	mcp.WithString("decision", mcp.Required(), mcp.Description("Vote: approve or reject")),
	mcp.WithString("reason", mcp.Description("Reason")),
	mcp.WithBoolean("is_ai", mcp.Description("Is this an AI vote")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	proposalID, _ := req.RequireString("proposal_id")
	voterPeer, _ := req.RequireString("voter_peer")
	voterID, _ := req.RequireString("voter_id")
	decision, _ := req.RequireString("decision")
	reason, _ := req.GetArguments()["reason"].(string)
	isAI, _ := req.GetArguments()["is_ai"].(bool)

	vote := &ProposalVoteRecord{
		ProposalID: proposalID, VoterPeer: voterPeer, VoterID: voterID,
		Decision: decision, Reason: reason, IsAI: isAI,
	}
	if err := store.CreateProposalVote(ctx, vote); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return mcp.NewToolResultText(fmt.Sprintf("Vote recorded: %s from %s", decision, voterPeer)), nil
})

s.AddTool(mcp.NewTool("inv_challenge_create",
	mcp.WithDescription("File a challenge against a peer's item or trace"),
	mcp.WithString("kind", mcp.Required(), mcp.Description("Challenge kind: stale_data, weak_evidence, trace_integrity")),
	mcp.WithString("challenger_peer", mcp.Required(), mcp.Description("Your peer ID")),
	mcp.WithString("challenged_peer", mcp.Required(), mcp.Description("Target peer ID")),
	mcp.WithString("target_item_id", mcp.Description("Target item ID (for stale_data/weak_evidence)")),
	mcp.WithString("target_trace_id", mcp.Description("Target trace ID (for trace_integrity)")),
	mcp.WithString("reason", mcp.Required(), mcp.Description("Reason for challenge")),
	mcp.WithString("evidence", mcp.Description("Supporting evidence")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	kind, _ := req.RequireString("kind")
	challenger, _ := req.RequireString("challenger_peer")
	challenged, _ := req.RequireString("challenged_peer")
	targetItem, _ := req.GetArguments()["target_item_id"].(string)
	targetTrace, _ := req.GetArguments()["target_trace_id"].(string)
	reason, _ := req.RequireString("reason")
	evidence, _ := req.GetArguments()["evidence"].(string)

	ch, err := challengeEngine.CreateChallenge(ctx, ChallengeKind(kind), challenger, challenged, targetItem, targetTrace, reason, evidence, 24*time.Hour)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return resultJSON(ch)
})

s.AddTool(mcp.NewTool("inv_challenge_respond",
	mcp.WithDescription("Respond to a challenge against your node"),
	mcp.WithString("challenge_id", mcp.Required(), mcp.Description("Challenge ID")),
	mcp.WithString("evidence", mcp.Required(), mcp.Description("Evidence for your response")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	challengeID, _ := req.RequireString("challenge_id")
	evidence, _ := req.RequireString("evidence")

	if err := challengeEngine.RespondToChallenge(ctx, challengeID, evidence); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return mcp.NewToolResultText(fmt.Sprintf("Response submitted for challenge %s", challengeID)), nil
})

s.AddTool(mcp.NewTool("inv_challenge_list",
	mcp.WithDescription("List challenges (all open, incoming, or outgoing)"),
	mcp.WithString("peer_id", mcp.Description("Your peer ID (for incoming/outgoing filter)")),
	mcp.WithBoolean("incoming", mcp.Description("Show challenges against your node")),
	mcp.WithBoolean("outgoing", mcp.Description("Show challenges you filed")),
), func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	peerID, _ := req.GetArguments()["peer_id"].(string)
	incoming, _ := req.GetArguments()["incoming"].(bool)
	outgoing, _ := req.GetArguments()["outgoing"].(bool)

	if peerID != "" && (incoming || outgoing) {
		challenges, err := store.ListChallengesByPeer(ctx, peerID, incoming)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		return resultJSON(challenges)
	}

	challenges, err := store.ListChallenges(ctx, ChallengeOpen)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	return resultJSON(challenges)
})
```

The `serveMCP` function signature needs to accept `store` and `challengeEngine` alongside `engine`. Update accordingly:

```go
func serveMCP(engine *Engine, store *Store, challengeEngine *ChallengeEngine) error {
```

Update `mcpCmd` and its registration to pass these dependencies.

**Step 2: Verify compilation**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go build ./...`
Expected: No errors.

**Step 3: Commit**

```bash
git add mcp_server.go main.go
git commit -m "feat: add MCP tools for network status, proposals, challenges, health"
```

---

## Task 24: Final Test Run + Cleanup

**Step 1: Run full test suite**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go test -v ./... -timeout 120s -count=1`
Expected: All tests PASS.

**Step 2: Run vet and build**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && go vet ./... && go build ./...`
Expected: No warnings, no errors.

**Step 3: Verify no `any` or `interface{}` usage**

Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && grep -rn 'interface{}' *.go` (should only find `resultJSON` in mcp_server.go)
Run: `cd /Users/cuongtran/Desktop/repo/my-inventory && grep -rn '\bany\b' *.go` (should only find legitimate uses)

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and verification for P2P network feature"
```

---

## Summary

| Task | Description | New Files | Modified Files |
|------|-------------|-----------|----------------|
| 1 | Add dependencies | — | `go.mod` |
| 2 | YAML config parsing | `config.go`, `config_test.go` | — |
| 3 | Identity management | `identity.go`, `identity_test.go` | — |
| 4 | Protobuf definitions | `proto/inv.proto`, `proto/inv.pb.go` | — |
| 5 | Peer + outbox + blocklist tables | — | `network.go`, `store.go`, `store_test.go` |
| 6 | Proposal + vote tables | — | `network.go`, `store.go`, `store_test.go` |
| 7 | Challenge tables + types | — | `network.go`, `store.go`, `store_test.go` |
| 8 | Security layer | `security.go`, `security_test.go` | — |
| 9 | P2P host | `p2p.go`, `p2p_test.go` | — |
| 10 | Proposal engine | `proposal.go`, `proposal_test.go` | — |
| 11 | Message sender + outbox | `p2p_sender.go` | `p2p_test.go` |
| 12 | Message handlers | `p2p_handlers.go` | `p2p_test.go` |
| 13 | Challenge engine | `challenge.go`, `challenge_test.go` | — |
| 14 | DI wiring | — | `graph.go` |
| 15 | CLI: `inv init` | — | `main.go` |
| 16 | CLI: `inv serve` | — | `main.go` |
| 17 | CLI: `inv network` | — | `main.go` |
| 18 | CLI: `inv proposal` | — | `main.go` |
| 19 | CLI: `inv challenge` | — | `main.go` |
| 20 | Extend existing commands | — | `network.go`, `store.go`, `main.go` |
| 21 | Observability | `observability.go` | `security_test.go` |
| 22 | Integration tests | `scenario_p2p_test.go` | — |
| 23 | MCP tools | — | `mcp_server.go`, `main.go` |
| 24 | Final test + cleanup | — | — |
