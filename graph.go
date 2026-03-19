package main

import (
	"fmt"
	"os"

	pumped "github.com/pumped-fn/pumped-go"
	"github.com/rs/zerolog"
)

type AppConfig struct {
	DBPath      string
	Project     string
	SystemLevel zerolog.Level
	AgentLevel  zerolog.Level
}

var Config = pumped.Provide(func(ctx *pumped.ResolveCtx) (*AppConfig, error) {
	cfg := &AppConfig{
		DBPath:      "inventory.db",
		Project:     "clinic-checkin",
		SystemLevel: zerolog.InfoLevel,
		AgentLevel:  zerolog.InfoLevel,
	}
	// Use the node config database path if available
	configPath := InvDirPath() + "/config.yaml"
	if nodeCfg, err := LoadNodeConfig(configPath); err == nil && nodeCfg.Database.Path != "" {
		cfg.DBPath = nodeCfg.Database.Path
		cfg.Project = nodeCfg.Node.Project
	}
	return cfg, nil
})

var SystemLog = pumped.Derive1(
	Config,
	func(ctx *pumped.ResolveCtx, cfgCtrl *pumped.Controller[*AppConfig]) (*zerolog.Logger, error) {
		cfg, err := cfgCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get config: %w", err)
		}
		logger := zerolog.New(os.Stderr).With().Timestamp().Str("source", "system").Logger().Level(cfg.SystemLevel)
		return &logger, nil
	},
)

var AgentLog = pumped.Derive1(
	Config,
	func(ctx *pumped.ResolveCtx, cfgCtrl *pumped.Controller[*AppConfig]) (*zerolog.Logger, error) {
		cfg, err := cfgCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get config: %w", err)
		}
		logger := zerolog.New(os.Stdout).With().Str("source", "agent").Logger().Level(cfg.AgentLevel)
		return &logger, nil
	},
)

var DBStore = pumped.Derive1(
	Config,
	func(ctx *pumped.ResolveCtx, cfgCtrl *pumped.Controller[*AppConfig]) (*Store, error) {
		cfg, err := cfgCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get config: %w", err)
		}

		store, err := NewStore(cfg.DBPath)
		if err != nil {
			return nil, fmt.Errorf("failed to open store: %w", err)
		}

		ctx.OnCleanup(func() error {
			return store.Close()
		})

		return store, nil
	},
)

var ItemStateMachine = pumped.Provide(func(ctx *pumped.ResolveCtx) (*StateMachine, error) {
	return NewStateMachine(), nil
})

var CRStateMachineExec = pumped.Provide(func(ctx *pumped.ResolveCtx) (*CRStateMachine, error) {
	return NewCRStateMachine(), nil
})

var Propagator = pumped.Derive2(
	DBStore,
	ItemStateMachine,
	func(ctx *pumped.ResolveCtx, storeCtrl *pumped.Controller[*Store], smCtrl *pumped.Controller[*StateMachine]) (*SignalPropagator, error) {
		store, err := storeCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get store: %w", err)
		}
		sm, err := smCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get state machine: %w", err)
		}
		return NewSignalPropagator(store, sm), nil
	},
)

var NetworkEngine = pumped.Derive3(
	DBStore,
	Propagator,
	CRStateMachineExec,
	func(ctx *pumped.ResolveCtx, storeCtrl *pumped.Controller[*Store], propCtrl *pumped.Controller[*SignalPropagator], crsmCtrl *pumped.Controller[*CRStateMachine]) (*Engine, error) {
		store, err := storeCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get store: %w", err)
		}
		prop, err := propCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get propagator: %w", err)
		}
		crsm, err := crsmCtrl.Get()
		if err != nil {
			return nil, fmt.Errorf("failed to get CR state machine: %w", err)
		}
		return NewEngine(store, prop, crsm), nil
	},
)

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
		bus := NewP2PEventBus()
		return NewP2PHandlers(engine, store, bus), nil
	},
)
