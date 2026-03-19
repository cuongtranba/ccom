package main

import (
	"testing"

	"github.com/stretchr/testify/suite"
)

type KindMappingSuite struct {
	suite.Suite
}

func TestKindMappingSuite(t *testing.T) {
	suite.Run(t, new(KindMappingSuite))
}

func (s *KindMappingSuite) TestGoTestFiles() {
	s.Equal(KindTestCase, DetectItemKind("auth_handler_test.go"))
	s.Equal(KindTestCase, DetectItemKind("store_test.go"))
	s.Equal(KindTestCase, DetectItemKind("pkg/handlers/user_test.go"))
}

func (s *KindMappingSuite) TestProtoFiles() {
	s.Equal(KindAPISpec, DetectItemKind("proto/inv.proto"))
	s.Equal(KindAPISpec, DetectItemKind("api/service.proto"))
}

func (s *KindMappingSuite) TestDockerfile() {
	s.Equal(KindRunbook, DetectItemKind("Dockerfile"))
	s.Equal(KindRunbook, DetectItemKind("docker-compose.yml"))
}

func (s *KindMappingSuite) TestMigrationFiles() {
	s.Equal(KindDataModel, DetectItemKind("migrations/001_initial.sql"))
}

func (s *KindMappingSuite) TestGoHandlerFiles() {
	s.Equal(KindAPISpec, DetectItemKind("auth_handler.go"))
	s.Equal(KindAPISpec, DetectItemKind("handlers/user_handler.go"))
}

func (s *KindMappingSuite) TestGoModelFiles() {
	s.Equal(KindDataModel, DetectItemKind("user_model.go"))
	s.Equal(KindDataModel, DetectItemKind("models/patient.go"))
}

func (s *KindMappingSuite) TestDefaultsToCustom() {
	s.Equal(KindCustom, DetectItemKind("main.go"))
	s.Equal(KindCustom, DetectItemKind("README.md"))
}

func (s *KindMappingSuite) TestListKindMappings() {
	mappings := ListKindMappings()
	s.NotEmpty(mappings)
	for _, m := range mappings {
		s.NotEmpty(m.Pattern)
		s.NotEmpty(m.Kind)
		s.NotEmpty(m.Description)
	}
}
