import { setupDemoButtons } from './demo-utils';

const humanTerminal = document.getElementById('human-terminal') as HTMLPreElement | null;
const aiTerminal = document.getElementById('ai-terminal') as HTMLPreElement | null;

if (humanTerminal && aiTerminal) {
  const HUMAN_PROMPT = '<span class="prompt">$</span> <span class="cmd">_</span>';
  const AI_PROMPT = '<span class="prompt">⟩</span> <span class="cmd">_</span>';

  function resetTerminals(): void {
    humanTerminal!.innerHTML = HUMAN_PROMPT;
    aiTerminal!.innerHTML = AI_PROMPT;
  }

  function runClaudeDemo(action: string): void {
    if (action === 'reset') {
      resetTerminals();
      return;
    }

    if (action === 'start') {
      humanTerminal!.innerHTML = '<span class="prompt">$</span> <span class="cmd">inv item list --node dev</span>';
      aiTerminal!.innerHTML = '<span class="prompt">⟩</span> <span class="cmd">inv_session_status</span>';

      setTimeout(() => {
        humanTerminal!.innerHTML = '<span class="prompt">$</span> <span class="cmd">inv item list --node dev</span>\n<span class="out">ID        KIND      TITLE                    STATUS</span>\n<span class="out">e8def515  api-spec  API-001: POST /check-in  </span><span class="s-proven">proven</span>\n<span class="out">c65ae3eb  adr       ADR-001: WebSocket sync  </span><span class="s-proven">proven</span>\n\n' + HUMAN_PROMPT;
      }, 400);

      setTimeout(() => {
        aiTerminal!.innerHTML = '<span class="prompt">⟩</span> <span class="cmd">inv_session_status</span>\n<span class="out">node: dev-inventory (0fb8353f)</span>\n<span class="out">owner: cuong</span>\n<span class="out">items: 2 </span><span class="s-proven">proven</span>\n<span class="out">pending CRs: 0</span>\n<span class="ai-mode">[mode: autonomous]</span>\n\n' + AI_PROMPT;
      }, 600);
      return;
    }

    if (action === 'edit') {
      humanTerminal!.innerHTML = '<span class="prompt">$</span> <span class="cmd">vim api/checkin.go</span>';

      setTimeout(() => {
        humanTerminal!.innerHTML = '<span class="prompt">$</span> <span class="cmd">vim api/checkin.go</span>\n<span class="out">[dev 3a8f2c1] feat: add async handler to checkin</span>\n<span class="out"> 1 file changed, 24 insertions(+), 3 deletions(-)</span>\n\n' + HUMAN_PROMPT;
      }, 800);

      setTimeout(() => {
        aiTerminal!.innerHTML = '<span class="event">[event]</span> <span class="out">file changed: api/checkin.go</span>';
      }, 1000);

      setTimeout(() => {
        aiTerminal!.innerHTML += '\n<span class="ai-mode">[auto-detect]</span> <span class="out">api/checkin.go → kind: api-spec</span>';
      }, 1400);

      setTimeout(() => {
        aiTerminal!.innerHTML += '\n<span class="ai-mode">[suggest]</span> <span class="out">verify API-001 with evidence</span>\n<span class="out">  "checkin.go: async handler added"</span>\n\n' + AI_PROMPT;
      }, 1800);
      return;
    }

    if (action === 'ai') {
      aiTerminal!.innerHTML = '<span class="ai-mode">[mode: autonomous]</span> <span class="out">acting on own node...</span>';

      setTimeout(() => {
        aiTerminal!.innerHTML += '\n<span class="prompt">⟩</span> <span class="cmd">inv verify API-001 --evidence "checkin.go: async handler added" --actor ai-agent</span>';
      }, 400);

      setTimeout(() => {
        aiTerminal!.innerHTML += '\n<span class="out">Item e8def515 verified → </span><span class="s-proven">proven</span>';
      }, 800);

      setTimeout(() => {
        aiTerminal!.innerHTML += '\n<span class="event">[broadcast]</span> <span class="out">signal sent to 2 dependent nodes</span>\n\n' + AI_PROMPT;
      }, 1200);

      setTimeout(() => {
        humanTerminal!.innerHTML = '<span class="event">[network]</span> <span class="out">Dev node verified API-001</span>\n<span class="out">  evidence: "checkin.go: async handler added"</span>\n<span class="out">  actor: ai-agent</span>\n<span class="out">  status: </span><span class="s-proven">proven</span>\n\n' + HUMAN_PROMPT;
      }, 1400);
      return;
    }

    if (action === 'cross') {
      aiTerminal!.innerHTML = '<span class="event">[event]</span> <span class="out">challenge received</span>\n<span class="out">  from: QA node (qa-bot)</span>\n<span class="out">  target: API-001</span>\n<span class="out">  reason: </span><span class="s-suspect">weak-evidence</span>\n<span class="out">  "API-001 tests not updated"</span>';

      setTimeout(() => {
        aiTerminal!.innerHTML += '\n\n<span class="warn">⚠ [mode: normal]</span> <span class="out">cross-node governance,</span>\n<span class="out">  requires human confirmation</span>';
      }, 800);

      setTimeout(() => {
        humanTerminal!.innerHTML = '<span class="event">[challenge]</span> <span class="out">QA challenges API-001</span>\n<span class="out">  reason: "API-001 tests not updated"</span>\n\n<span class="prompt">$</span> <span class="cmd">inv challenge respond API-001 --action update-evidence --evidence "integration tests added in test/checkin_test.go"</span>';
      }, 1200);

      setTimeout(() => {
        humanTerminal!.innerHTML += '\n<span class="out">Challenge response submitted.</span>\n<span class="out">  API-001 status: </span><span class="s-proven">proven</span>\n<span class="out">  Challenge: resolved</span>\n\n' + HUMAN_PROMPT;
      }, 2200);

      setTimeout(() => {
        aiTerminal!.innerHTML += '\n\n<span class="event">[resolved]</span> <span class="out">challenge from QA dismissed</span>\n<span class="out">  API-001 remains </span><span class="s-proven">proven</span>\n<span class="out">  evidence updated</span>\n\n' + AI_PROMPT;
      }, 2200);
      return;
    }
  }

  setupDemoButtons(document, '[data-claude]', 'claude', runClaudeDemo);
}
