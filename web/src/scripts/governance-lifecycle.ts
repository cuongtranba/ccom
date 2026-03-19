import { setupDemoButtons } from './demo-utils';

// ---------------------------------------------------------------------------
// Governance Lifecycle — CR card lifecycle demo
// Animates a Change Request through 5 stages:
// draft → voting → votes arrive → approved → archived
// ---------------------------------------------------------------------------

interface Vote {
  node: string;
  icon: string;
  iconClass: 'approve' | 'revise';
  reason: string;
  isAI: boolean;
}

const VOTES: Vote[] = [
  { node: 'PM Node', icon: '✓', iconClass: 'approve', reason: 'Aligns with mobile check-in epic', isAI: false },
  { node: 'Design Node', icon: '↻', iconClass: 'revise', reason: 'Need loading state for async', isAI: true },
  { node: 'QA Node', icon: '✓', iconClass: 'approve', reason: 'Can update test suites', isAI: true },
  { node: 'DevOps Node', icon: '✓', iconClass: 'approve', reason: 'Monitoring covers async patterns', isAI: false },
  { node: 'Arch Lead', icon: '✓', iconClass: 'approve', reason: 'Consistent with async-first strategy', isAI: false },
];

const badge = document.getElementById('cr-badge');
const votesContainer = document.getElementById('cr-votes');
const quorumEl = document.getElementById('cr-quorum');
const quorumFill = document.getElementById('quorum-fill') as HTMLElement | null;
const quorumText = document.getElementById('quorum-text');
const lifecycle = document.getElementById('cr-lifecycle');
const output = document.getElementById('gov-output');

if (badge && votesContainer && quorumEl && quorumFill && quorumText && lifecycle && output) {
  const INITIAL_TERMINAL = `<span class="prompt">$</span> <span class="cmd">inv cr show CR-042</span>
<span class="out">CR-042  Change check-in API from sync to async
Status: </span><span class="s-muted">DRAFT</span>
<span class="out">Votes:  none</span>

<span class="prompt">$</span> <span class="cmd">_</span>`;

  let voteTimeouts: number[] = [];

  function clearVoteTimeouts(): void {
    for (const t of voteTimeouts) {
      clearTimeout(t);
    }
    voteTimeouts = [];
  }

  function resetAll(): void {
    clearVoteTimeouts();

    // Badge
    badge.textContent = 'DRAFT';
    badge.className = 'cr-badge draft';

    // Card state
    lifecycle.classList.remove('approved', 'archived');

    // Votes
    votesContainer.innerHTML = '';

    // Quorum
    quorumEl.classList.remove('visible');
    quorumFill.style.width = '0%';
    quorumFill.setAttribute('aria-valuenow', '0');
    quorumText.textContent = '0/3 human votes (need >50%)';

    // Terminal
    output.innerHTML = INITIAL_TERMINAL;
  }

  function setDraft(): void {
    resetAll();
  }

  function openVoting(): void {
    clearVoteTimeouts();

    // Badge
    badge.textContent = 'VOTING';
    badge.className = 'cr-badge voting';

    // Card state
    lifecycle.classList.remove('approved', 'archived');

    // Clear votes
    votesContainer.innerHTML = '';

    // Show quorum
    quorumEl.classList.add('visible');
    quorumFill.style.width = '0%';
    quorumFill.setAttribute('aria-valuenow', '0');
    quorumText.textContent = '0/3 human votes (need >50%)';

    // Terminal
    output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv cr open CR-042 --voting</span>
<span class="out">CR-042 status: DRAFT -> </span><span class="s-proven">VOTING</span>
<span class="out">Quorum required: >50% human votes (3 of 5 nodes are human)</span>
<span class="out">Waiting for votes...</span>

<span class="prompt">$</span> <span class="cmd">_</span>`;
  }

  function castVotes(): void {
    clearVoteTimeouts();
    votesContainer.innerHTML = '';

    // Ensure we're in voting state
    badge.textContent = 'VOTING';
    badge.className = 'cr-badge voting';
    lifecycle.classList.remove('approved', 'archived');
    quorumEl.classList.add('visible');
    quorumFill.style.width = '0%';
    quorumFill.setAttribute('aria-valuenow', '0');

    output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv cr vote CR-042 --all</span>
<span class="out">Broadcasting vote request to all nodes...</span>`;

    let humanVotes = 0;
    const totalHuman = 3; // PM, DevOps, Arch Lead

    VOTES.forEach((vote, i) => {
      const timeout = window.setTimeout(() => {
        // Build vote row DOM
        const row = document.createElement('div');
        row.className = 'vote-row';

        const nodeSpan = document.createElement('span');
        nodeSpan.className = 'vote-node';
        nodeSpan.textContent = vote.node;
        row.appendChild(nodeSpan);

        const iconSpan = document.createElement('span');
        iconSpan.className = `vote-icon ${vote.iconClass}`;
        iconSpan.textContent = vote.icon;
        row.appendChild(iconSpan);

        const reasonSpan = document.createElement('span');
        reasonSpan.className = 'vote-reason';
        reasonSpan.textContent = vote.reason;
        row.appendChild(reasonSpan);

        if (vote.isAI) {
          const aiTag = document.createElement('span');
          aiTag.className = 'vote-ai-tag';
          aiTag.textContent = 'AI';
          row.appendChild(aiTag);

          const advisory = document.createElement('span');
          advisory.className = 'vote-advisory';
          advisory.textContent = '(advisory)';
          row.appendChild(advisory);
        }

        votesContainer.appendChild(row);

        // Update quorum for human votes
        if (!vote.isAI) {
          humanVotes++;
          const pct = Math.round((humanVotes / totalHuman) * 100);
          quorumFill.style.width = `${pct}%`;
          quorumFill.setAttribute('aria-valuenow', String(humanVotes));
          quorumText.textContent = `${humanVotes}/${totalHuman} human votes (need >50%)`;
        }

        // Terminal output
        const voteType = vote.iconClass === 'approve' ? 'approve' : 'revise';
        const voteColor = vote.iconClass === 'approve' ? 's-proven' : 's-suspect';
        const aiNote = vote.isAI ? ' <span class="out">(AI advisory)</span>' : '';

        // Remove trailing prompt before appending
        const currentHtml = output.innerHTML.replace(/\n\n<span class="prompt">\$<\/span> <span class="cmd">_<\/span>$/, '');
        output.innerHTML = currentHtml +
          `\n<span class="out">  [${vote.node}] </span><span class="${voteColor}">${voteType}</span><span class="out"> — "${vote.reason}"</span>${aiNote}`;

        // After last vote, add final line
        if (i === VOTES.length - 1) {
          output.innerHTML += `\n\n<span class="out">All votes received. ${humanVotes}/${totalHuman} human votes cast.</span>\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
        }
      }, 600 * (i + 1));

      voteTimeouts.push(timeout);
    });
  }

  function approveCard(): void {
    clearVoteTimeouts();

    // Badge
    badge.textContent = 'APPROVED';
    badge.className = 'cr-badge approved';

    // Card state
    lifecycle.classList.add('approved');
    lifecycle.classList.remove('archived');

    // Quorum — full
    quorumEl.classList.add('visible');
    quorumFill.style.width = '100%';
    quorumFill.setAttribute('aria-valuenow', '3');
    quorumText.textContent = '3/3 human votes — approved';

    // Terminal
    output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv cr approve CR-042</span>
<span class="out">Quorum check: 3/3 human votes (100%) — threshold met</span>
<span class="out">CR-042 status: VOTING -> </span><span class="s-proven">APPROVED</span>
<span class="out">Change request approved. Propagating to all nodes...</span>

<span class="prompt">$</span> <span class="cmd">_</span>`;
  }

  function archiveCard(): void {
    clearVoteTimeouts();

    // Badge
    badge.textContent = 'ARCHIVED';
    badge.className = 'cr-badge archived';

    // Card state
    lifecycle.classList.remove('approved');
    lifecycle.classList.add('archived');

    // Terminal
    output.innerHTML = `<span class="prompt">$</span> <span class="cmd">inv cr archive CR-042</span>
<span class="out">CR-042 status: APPROVED -> </span><span class="s-muted">ARCHIVED</span>
<span class="out">Change request archived. Read-only from this point.</span>

<span class="prompt">$</span> <span class="cmd">_</span>`;
  }

  function runAction(action: string): void {
    switch (action) {
      case 'draft': setDraft(); break;
      case 'open': openVoting(); break;
      case 'vote': castVotes(); break;
      case 'approve': approveCard(); break;
      case 'archive': archiveCard(); break;
      case 'reset': resetAll(); break;
    }
  }

  setupDemoButtons(document, '[data-gov]', 'gov', runAction);
}
