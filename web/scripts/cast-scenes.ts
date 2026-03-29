// web/scripts/cast-scenes.ts
import type { SceneAction } from './cast-writer';
import { grid2x2 } from './cast-writer';
import { RESET, BOLD, FG } from './cast-colors';

const PROJECT = 'pvs-core';

// ── Helper to build common output patterns ──
function toolCall(tool: string): string {
  return `${FG.secondary}> Calling${RESET} ${FG.pulse}${tool}${RESET}`;
}

function success(msg: string): string {
  return `${FG.proven}ok${RESET} ${msg}`;
}

function notification(icon: string, msg: string): string {
  return `${FG.pulse}${icon}${RESET} ${FG.text}${msg}${RESET}`;
}

function tableHeader(text: string): string {
  return `${FG.secondary}${text}${RESET}`;
}

// ═══════════════════════════════════════════
// Scene 1: Network Setup
// ═══════════════════════════════════════════
export function networkSetupScene(): { panes: Pane[]; actions: SceneAction[] } {
  const [dev, pm, qa, designer] = grid2x2(['dev', 'pm', 'qa', 'designer'], PROJECT);
  const panes = [dev, pm, qa, designer];

  const actions: SceneAction[] = [
    // All nodes check online status — staggered
    { kind: 'type', pane: dev, text: 'inv_online_nodes', charDelay: 40 },
    { kind: 'pause', duration: 0.3 },
    { kind: 'type', pane: pm, text: 'inv_online_nodes', charDelay: 40 },
    { kind: 'pause', duration: 0.3 },
    { kind: 'type', pane: qa, text: 'inv_online_nodes', charDelay: 40 },
    { kind: 'pause', duration: 0.3 },
    { kind: 'type', pane: designer, text: 'inv_online_nodes', charDelay: 40 },
    { kind: 'pause', duration: 0.5 },

    // Output: each sees the growing network
    { kind: 'output', pane: dev, lines: [
      toolCall('inv_online_nodes'),
      success(`${BOLD}4 nodes${RESET} online:`),
      `  ${FG.green}dev${RESET}  ${FG.orange}pm${RESET}  ${FG.red}qa${RESET}  ${FG.blue}designer${RESET}`,
    ]},
    { kind: 'pause', duration: 0.4 },
    { kind: 'output', pane: pm, lines: [
      toolCall('inv_online_nodes'),
      success(`${BOLD}4 nodes${RESET} online:`),
      `  ${FG.green}dev${RESET}  ${FG.orange}pm${RESET}  ${FG.red}qa${RESET}  ${FG.blue}designer${RESET}`,
    ]},
    { kind: 'output', pane: qa, lines: [
      toolCall('inv_online_nodes'),
      success(`${BOLD}4 nodes${RESET} online:`),
      `  ${FG.green}dev${RESET}  ${FG.orange}pm${RESET}  ${FG.red}qa${RESET}  ${FG.blue}designer${RESET}`,
    ]},
    { kind: 'output', pane: designer, lines: [
      toolCall('inv_online_nodes'),
      success(`${BOLD}4 nodes${RESET} online:`),
      `  ${FG.green}dev${RESET}  ${FG.orange}pm${RESET}  ${FG.red}qa${RESET}  ${FG.blue}designer${RESET}`,
    ]},
    { kind: 'pause', duration: 1.0 },

    // Each node creates their signature item
    { kind: 'type', pane: dev, text: 'inv_add_item tech-design "Auth Flow OAuth2+JWT"', charDelay: 35 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: dev, lines: [
      toolCall('inv_add_item'),
      success(`Created ${BOLD}tech-design${RESET}: Auth Flow with OAuth2 + JWT`),
      `  ${FG.secondary}id: ${FG.muted}5ed3360c${RESET}  ${FG.secondary}state: ${FG.muted}unverified${RESET}`,
    ]},

    { kind: 'pause', duration: 0.3 },
    { kind: 'type', pane: pm, text: 'inv_add_item prd "PVS Core v2.0 Requirements"', charDelay: 35 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: pm, lines: [
      toolCall('inv_add_item'),
      success(`Created ${BOLD}prd${RESET}: PVS Core v2.0 Requirements`),
      `  ${FG.secondary}id: ${FG.muted}2099d58c${RESET}  ${FG.secondary}state: ${FG.muted}unverified${RESET}`,
    ]},

    { kind: 'pause', duration: 0.3 },
    { kind: 'type', pane: qa, text: 'inv_add_item test-plan "Auth Test Plan"', charDelay: 35 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: qa, lines: [
      toolCall('inv_add_item'),
      success(`Created ${BOLD}test-plan${RESET}: Auth Integration Test Plan`),
      `  ${FG.secondary}id: ${FG.muted}63ec2aa2${RESET}  ${FG.secondary}state: ${FG.muted}unverified${RESET}`,
    ]},

    { kind: 'pause', duration: 0.3 },
    { kind: 'type', pane: designer, text: 'inv_add_item tech-design "UI Auth Module"', charDelay: 35 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: designer, lines: [
      toolCall('inv_add_item'),
      success(`Created ${BOLD}tech-design${RESET}: UI Authentication Module`),
      `  ${FG.secondary}id: ${FG.muted}034e51df${RESET}  ${FG.secondary}state: ${FG.muted}unverified${RESET}`,
    ]},

    { kind: 'pause', duration: 1.5 },
  ];

  return { panes, actions };
}

// ═══════════════════════════════════════════
// Scene 2: Cross-Node Query
// ═══════════════════════════════════════════
export function crossNodeQueryScene(): { panes: Pane[]; actions: SceneAction[] } {
  const [pm, dev, qa, designer] = grid2x2(['pm', 'dev', 'qa', 'designer'], PROJECT);
  const panes = [pm, dev, qa, designer];

  const actions: SceneAction[] = [
    // PM asks dev for inventory
    { kind: 'type', pane: pm, text: 'inv_ask target:dev "List your inventory items"', charDelay: 40 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: pm, lines: [
      toolCall('inv_ask'),
      success('Query sent to dev'),
    ]},

    // Dev receives notification
    { kind: 'pause', duration: 0.6 },
    { kind: 'output', pane: dev, lines: [
      notification('<<', 'Query from pm@pvs-core:'),
      `  ${FG.secondary}"List your inventory items"${RESET}`,
    ]},

    // Dev replies
    { kind: 'pause', duration: 0.8 },
    { kind: 'type', pane: dev, text: 'inv_reply "Here are my items:"', charDelay: 40 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: dev, lines: [
      toolCall('inv_reply'),
      success('Reply sent to pm'),
    ]},

    // PM receives reply
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: pm, lines: [
      notification('>>', 'Reply from dev@pvs-core:'),
      '',
      tableHeader('  KIND          TITLE'),
      `  tech-design   Auth Flow OAuth2 + JWT`,
      `  epic          User Onboarding Flow`,
      `  api-spec      REST API v1 - Users`,
      `  adr           Use PostgreSQL as primary DB`,
    ]},

    { kind: 'pause', duration: 1.0 },

    // QA asks about the epic
    { kind: 'type', pane: qa, text: 'inv_ask target:dev "Status of User Onboarding epic?"', charDelay: 40 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: qa, lines: [
      toolCall('inv_ask'),
      success('Query sent to dev'),
    ]},

    // Dev receives
    { kind: 'pause', duration: 0.6 },
    { kind: 'output', pane: dev, lines: [
      '',
      notification('<<', 'Query from qa@pvs-core:'),
      `  ${FG.secondary}"Status of User Onboarding epic?"${RESET}`,
    ]},

    // Dev replies
    { kind: 'pause', duration: 0.6 },
    { kind: 'type', pane: dev, text: 'inv_reply "Unverified — no linked test cases yet"', charDelay: 40 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: dev, lines: [
      toolCall('inv_reply'),
      success('Reply sent to qa'),
    ]},

    // QA receives
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: qa, lines: [
      notification('>>', 'Reply from dev@pvs-core:'),
      `  ${FG.muted}state:${RESET} unverified`,
      `  ${FG.muted}tests:${RESET} none linked`,
    ]},

    // Designer observes silently — show idle prompt
    { kind: 'output', pane: designer, lines: [
      `${FG.muted}listening to network events...${RESET}`,
      '',
      notification('--', 'pm queried dev'),
      notification('--', 'qa queried dev'),
    ]},

    { kind: 'pause', duration: 1.5 },
  ];

  return { panes, actions };
}

// ═══════════════════════════════════════════
// Scene 3: Proposal & Vote
// ═══════════════════════════════════════════
export function proposalVoteScene(): { panes: Pane[]; actions: SceneAction[] } {
  const [pm, dev, qa, designer] = grid2x2(['pm', 'dev', 'qa', 'designer'], PROJECT);
  const panes = [pm, dev, qa, designer];

  const crId = 'aef6ada7';

  const actions: SceneAction[] = [
    // PM creates proposal
    { kind: 'type', pane: pm, text: 'inv_proposal_create 034e51df "UI Auth: JWT+OAuth2+MFA"', charDelay: 30 },
    { kind: 'pause', duration: 0.6 },
    { kind: 'output', pane: pm, lines: [
      toolCall('inv_proposal_create'),
      success(`Proposal ${BOLD}${crId}${RESET} created`),
      `  ${FG.secondary}target:${RESET} UI Authentication Module`,
      `  ${FG.secondary}status:${RESET} ${FG.pulse}voting${RESET}`,
    ]},

    // All other nodes receive notification
    { kind: 'pause', duration: 0.8 },
    { kind: 'output', pane: dev, lines: [
      notification('!!', 'New proposal from pm@pvs-core'),
      `  ${FG.secondary}"Redesign UI Auth: JWT +${RESET}`,
      `  ${FG.secondary} OAuth2 + MFA + RBAC"${RESET}`,
      `  ${FG.muted}CR: ${crId}${RESET}`,
    ]},
    { kind: 'pause', duration: 0.3 },
    { kind: 'output', pane: qa, lines: [
      notification('!!', 'New proposal from pm@pvs-core'),
      `  ${FG.secondary}"Redesign UI Auth: JWT +${RESET}`,
      `  ${FG.secondary} OAuth2 + MFA + RBAC"${RESET}`,
      `  ${FG.muted}CR: ${crId}${RESET}`,
    ]},
    { kind: 'pause', duration: 0.3 },
    { kind: 'output', pane: designer, lines: [
      notification('!!', 'New proposal from pm@pvs-core'),
      `  ${FG.secondary}"Redesign UI Auth: JWT +${RESET}`,
      `  ${FG.secondary} OAuth2 + MFA + RBAC"${RESET}`,
      `  ${FG.muted}CR: ${crId}${RESET}`,
    ]},

    // Dev votes
    { kind: 'pause', duration: 1.0 },
    { kind: 'type', pane: dev, text: `inv_proposal_vote ${crId} approve`, charDelay: 30 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: dev, lines: [
      toolCall('inv_proposal_vote'),
      success(`Vote: ${FG.proven}approve${RESET}`),
    ]},

    // QA votes
    { kind: 'pause', duration: 0.8 },
    { kind: 'type', pane: qa, text: `inv_proposal_vote ${crId} approve`, charDelay: 30 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: qa, lines: [
      toolCall('inv_proposal_vote'),
      success(`Vote: ${FG.proven}approve${RESET}`),
    ]},

    // Designer votes
    { kind: 'pause', duration: 0.8 },
    { kind: 'type', pane: designer, text: `inv_proposal_vote ${crId} approve`, charDelay: 30 },
    { kind: 'pause', duration: 0.5 },
    { kind: 'output', pane: designer, lines: [
      toolCall('inv_proposal_vote'),
      success(`Vote: ${FG.proven}approve${RESET}`),
    ]},

    // PM sees tally
    { kind: 'pause', duration: 1.0 },
    { kind: 'output', pane: pm, lines: [
      '',
      notification('>>', `Vote tally for ${crId}:`),
      `  ${FG.green}dev${RESET}      ${FG.proven}approve${RESET}`,
      `  ${FG.red}qa${RESET}       ${FG.proven}approve${RESET}`,
      `  ${FG.blue}designer${RESET} ${FG.proven}approve${RESET}`,
      '',
      `  ${FG.proven}\u2713 3/3 approved${RESET} \u2014 status: ${BOLD}${FG.proven}approved${RESET}`,
    ]},

    { kind: 'pause', duration: 2.0 },
  ];

  return { panes, actions };
}
