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
