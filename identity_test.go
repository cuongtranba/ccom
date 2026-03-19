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
