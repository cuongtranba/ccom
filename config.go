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
	PermissionNormal     PermissionMode = "normal"
	PermissionAutonomous PermissionMode = "autonomous"
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
	EnableRelay    bool     `yaml:"enable_relay"`
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
	HealthInterval           time.Duration `yaml:"health_interval"`
	AlertOutboxThreshold     int           `yaml:"alert_outbox_threshold"`
	AlertReputationThreshold int           `yaml:"alert_reputation_threshold"`
	AlertDeadlineWarning     time.Duration `yaml:"alert_deadline_warning"`
}

type NodeConfig struct {
	Node          NodeConfigNode          `yaml:"node"`
	Database      NodeConfigDatabase      `yaml:"database"`
	Network       NodeConfigNetwork       `yaml:"network"`
	Security      NodeConfigSecurity      `yaml:"security"`
	Challenges    NodeConfigChallenges    `yaml:"challenges"`
	Logging       NodeConfigLogging       `yaml:"logging"`
	Observability NodeConfigObservability `yaml:"observability"`
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
			EnableRelay:    true,
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
