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
