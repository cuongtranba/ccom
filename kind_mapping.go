package main

import (
	"path/filepath"
	"strings"
)

type KindMappingRule struct {
	Pattern     string   `json:"pattern"`
	Kind        ItemKind `json:"kind"`
	Description string   `json:"description"`
}

var kindMappingRules = []KindMappingRule{
	{Pattern: "*_test.go", Kind: KindTestCase, Description: "Go test files"},
	{Pattern: "*.proto", Kind: KindAPISpec, Description: "Protocol buffer definitions"},
	{Pattern: "docs/plans/*.md", Kind: KindDecision, Description: "Architecture decision records and plans"},
	{Pattern: "Dockerfile", Kind: KindRunbook, Description: "Docker build configuration"},
	{Pattern: "docker-compose.yml", Kind: KindRunbook, Description: "Docker Compose configuration"},
	{Pattern: "docker-compose.yaml", Kind: KindRunbook, Description: "Docker Compose configuration"},
	{Pattern: "*.sql", Kind: KindDataModel, Description: "SQL migration files"},
	{Pattern: "*_handler.go", Kind: KindAPISpec, Description: "Go HTTP/API handler files"},
	{Pattern: "*_model.go", Kind: KindDataModel, Description: "Go data model files"},
}

// DetectItemKind determines the item kind for a given file path.
func DetectItemKind(filePath string) ItemKind {
	base := filepath.Base(filePath)
	for _, rule := range kindMappingRules {
		if strings.Contains(rule.Pattern, "/") {
			normalized := filepath.ToSlash(filePath)
			if matched, _ := filepath.Match(rule.Pattern, normalized); matched {
				return rule.Kind
			}
			parts := strings.Split(normalized, "/")
			patternParts := strings.Split(rule.Pattern, "/")
			if len(parts) >= len(patternParts) {
				suffix := strings.Join(parts[len(parts)-len(patternParts):], "/")
				if matched, _ := filepath.Match(rule.Pattern, suffix); matched {
					return rule.Kind
				}
			}
		} else {
			if matched, _ := filepath.Match(rule.Pattern, base); matched {
				return rule.Kind
			}
		}
	}
	if strings.Contains(filepath.ToSlash(filePath), "models/") && strings.HasSuffix(base, ".go") {
		return KindDataModel
	}
	if strings.Contains(filepath.ToSlash(filePath), "handlers/") && strings.HasSuffix(base, ".go") {
		return KindAPISpec
	}
	return KindCustom
}

// ListKindMappings returns a copy of the configured kind mapping rules.
func ListKindMappings() []KindMappingRule {
	result := make([]KindMappingRule, len(kindMappingRules))
	copy(result, kindMappingRules)
	return result
}
