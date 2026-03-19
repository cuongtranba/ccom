package main

func IsValidPermissionMode(mode PermissionMode) bool {
	return mode == PermissionNormal || mode == PermissionAutonomous
}

type ActionKind string

const (
	ActionFileChallenge    ActionKind = "file_challenge"
	ActionVoteHuman        ActionKind = "vote_human"
	ActionRespondChallenge ActionKind = "respond_challenge"
	ActionAcceptMembership ActionKind = "accept_membership"
	ActionAddItem          ActionKind = "add_item"
	ActionVerifyItem       ActionKind = "verify_item"
	ActionMarkBroken       ActionKind = "mark_broken"
	ActionCreateTrace      ActionKind = "create_trace"
	ActionRespondQuery     ActionKind = "respond_query"
	ActionPropagateSignal  ActionKind = "propagate_signal"
	ActionCastAIVote       ActionKind = "cast_ai_vote"
	ActionAskNetwork       ActionKind = "ask_network"
)

var governanceActions = map[ActionKind]bool{
	ActionFileChallenge:    true,
	ActionVoteHuman:        true,
	ActionRespondChallenge: true,
	ActionAcceptMembership: true,
}

var alwaysAutonomousActions = map[ActionKind]bool{
	ActionPropagateSignal: true,
	ActionCastAIVote:      true,
	ActionAskNetwork:      true,
}

func RequiresHumanConfirmation(mode PermissionMode, action ActionKind) bool {
	if governanceActions[action] {
		return true
	}
	if alwaysAutonomousActions[action] {
		return false
	}
	return mode == PermissionNormal
}

type ConfigModeResponse struct {
	CurrentMode       PermissionMode   `json:"current_mode"`
	AvailableModes    []PermissionMode `json:"available_modes"`
	RequiresHumanFor  []string         `json:"requires_human_for"`
	AutonomousActions []string         `json:"autonomous_actions"`
	AlwaysAutonomous  []string         `json:"always_autonomous"`
}

func BuildConfigModeResponse(mode PermissionMode) ConfigModeResponse {
	resp := ConfigModeResponse{
		CurrentMode:    mode,
		AvailableModes: []PermissionMode{PermissionNormal, PermissionAutonomous},
	}
	allActions := []ActionKind{
		ActionFileChallenge, ActionVoteHuman, ActionRespondChallenge, ActionAcceptMembership,
		ActionAddItem, ActionVerifyItem, ActionMarkBroken, ActionCreateTrace, ActionRespondQuery,
		ActionPropagateSignal, ActionCastAIVote, ActionAskNetwork,
	}
	for _, action := range allActions {
		if governanceActions[action] {
			resp.RequiresHumanFor = append(resp.RequiresHumanFor, string(action))
		} else if alwaysAutonomousActions[action] {
			resp.AlwaysAutonomous = append(resp.AlwaysAutonomous, string(action))
		} else if mode == PermissionAutonomous {
			resp.AutonomousActions = append(resp.AutonomousActions, string(action))
		} else {
			resp.RequiresHumanFor = append(resp.RequiresHumanFor, string(action))
		}
	}
	return resp
}
