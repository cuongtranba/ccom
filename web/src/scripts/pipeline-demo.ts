interface CheckItem {
  label: string;
  checked: boolean;
}

interface VerticalState {
  traces: string[];
  items: CheckItem[];
}

const pmCard = document.getElementById('pm-card');
const designCard = document.getElementById('design-card');
const devCard = document.getElementById('dev-card');
const auditBar = document.getElementById('audit-bar');
const pipelineOutput = document.getElementById('pipeline-output');

if (pmCard && designCard && devCard && auditBar && pipelineOutput) {

  function renderCard(el: HTMLElement, state: VerticalState, active: boolean): void {
    el.innerHTML = '';

    if (active) {
      el.classList.add('active');
    }

    // Render trace reference badges
    if (state.traces.length > 0) {
      const tracesContainer = document.createElement('div');
      for (const trace of state.traces) {
        const badge = document.createElement('span');
        badge.className = 'trace-ref';
        badge.textContent = trace;
        tracesContainer.appendChild(badge);
      }
      el.appendChild(tracesContainer);
    }

    // Render checklist items with staggered animation
    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '0.5rem';

    for (const item of state.items) {
      const row = document.createElement('div');
      row.className = 'check-item';

      const box = document.createElement('span');
      box.className = 'check-box';
      if (item.checked) {
        box.classList.add('checked');
        box.textContent = '\u2713';
      }

      const label = document.createElement('span');
      label.textContent = item.label;

      row.appendChild(box);
      row.appendChild(label);
      list.appendChild(row);
    }

    el.appendChild(list);
  }

  function activateArrow(id: string): void {
    const arrow = document.getElementById(id);
    if (arrow) {
      arrow.classList.add('active');
    }
  }

  function resetArrow(id: string): void {
    const arrow = document.getElementById(id);
    if (arrow) {
      arrow.classList.remove('active');
    }
  }

  function runPipeline(action: string): void {
    if (action === 'pm') {
      renderCard(pmCard!, {
        traces: [],
        items: [
          { label: 'User story written', checked: true },
          { label: 'Acceptance criteria defined', checked: true },
          { label: 'Compliance reviewed', checked: true },
        ],
      }, true);

      pipelineOutput!.innerHTML =
        `<span class="prompt">$</span> <span class="cmd">inv checklist complete --node pm --item US-001</span>\n` +
        `<span class="out">Checklist items:</span>\n` +
        `<span class="out">  [x] User story written</span>\n` +
        `<span class="out">  [x] Acceptance criteria defined</span>\n` +
        `<span class="out">  [x] Compliance reviewed</span>\n` +
        `<span class="out">Checklist complete. Item US-001 -> </span><span class="s-proven">proven</span>\n\n` +
        `<span class="prompt">$</span> <span class="cmd">_</span>`;
      return;
    }

    if (action === 'design') {
      activateArrow('arrow-pm-design');

      renderCard(designCard!, {
        traces: ['US-001 (PM)'],
        items: [
          { label: 'Screen spec', checked: true },
          { label: 'Mobile variant', checked: true },
          { label: 'Accessibility reviewed', checked: false },
        ],
      }, true);

      pipelineOutput!.innerHTML =
        `<span class="prompt">$</span> <span class="cmd">inv trace add S-001 --refs US-001 --vertical design</span>\n` +
        `<span class="out">Trace S-001 -> US-001 (PM) created.</span>\n\n` +
        `<span class="prompt">$</span> <span class="cmd">inv checklist status --node design --item S-001</span>\n` +
        `<span class="out">  [x] Screen spec</span>\n` +
        `<span class="out">  [x] Mobile variant</span>\n` +
        `<span class="out">  [ ] Accessibility reviewed</span>\n` +
        `<span class="out">Checklist incomplete. 2/3 items done.</span>\n\n` +
        `<span class="prompt">$</span> <span class="cmd">_</span>`;
      return;
    }

    if (action === 'dev') {
      activateArrow('arrow-pm-design');
      activateArrow('arrow-design-dev');

      renderCard(devCard!, {
        traces: ['US-001 (PM)', 'S-001 (Design)'],
        items: [
          { label: 'API endpoint', checked: true },
          { label: 'Tests passing', checked: true },
          { label: 'ADR documented', checked: false },
        ],
      }, true);

      pipelineOutput!.innerHTML =
        `<span class="prompt">$</span> <span class="cmd">inv trace add API-001 --refs US-001,S-001 --vertical dev</span>\n` +
        `<span class="out">Trace API-001 -> US-001 (PM), S-001 (Design) created.</span>\n\n` +
        `<span class="prompt">$</span> <span class="cmd">inv checklist status --node dev --item API-001</span>\n` +
        `<span class="out">  [x] API endpoint</span>\n` +
        `<span class="out">  [x] Tests passing</span>\n` +
        `<span class="out">  [ ] ADR documented</span>\n\n` +
        `<span class="prompt">$</span> <span class="cmd">inv audit check --pipeline clinic-checkin</span>\n` +
        `<span class="out">Checking trace integrity across verticals...</span>\n` +
        `<span class="out">All traces valid. 2 items have incomplete checklists.</span>\n\n` +
        `<span class="prompt">$</span> <span class="cmd">_</span>`;
      return;
    }

    if (action === 'audit') {
      auditBar!.classList.add('scanning');

      setTimeout(() => {
        // Mark unchecked boxes as missing
        const allBoxes = document.querySelectorAll('.check-box:not(.checked)');
        for (const box of allBoxes) {
          box.classList.add('missing');
        }
      }, 800);

      setTimeout(() => {
        const allChecked = document.querySelectorAll('.check-box.checked').length;
        const allMissing = document.querySelectorAll('.check-box.missing').length;

        pipelineOutput!.innerHTML =
          `<span class="prompt">$</span> <span class="cmd">inv audit summary --pipeline clinic-checkin</span>\n` +
          `<span class="out">Audit sweep complete.</span>\n\n` +
          `<span class="out">  Checklist items passed:  </span><span class="s-proven">${allChecked}</span>\n` +
          `<span class="out">  Checklist items missing: </span><span class="s-suspect">${allMissing}</span>\n` +
          `<span class="out">  Traces verified:         </span><span class="s-proven">3</span>\n` +
          `<span class="out">  Traces broken:           </span><span class="s-proven">0</span>\n\n` +
          `<span class="out">Pipeline status: </span>` +
          (allMissing > 0
            ? `<span class="s-suspect">incomplete</span><span class="out"> — ${allMissing} items need attention.</span>`
            : `<span class="s-proven">fully proven</span>`) +
          `\n\n<span class="prompt">$</span> <span class="cmd">_</span>`;
      }, 1500);
      return;
    }

    if (action === 'reset') {
      pmCard!.innerHTML = '';
      pmCard!.classList.remove('active');
      designCard!.innerHTML = '';
      designCard!.classList.remove('active');
      devCard!.innerHTML = '';
      devCard!.classList.remove('active');

      resetArrow('arrow-pm-design');
      resetArrow('arrow-design-dev');

      auditBar!.classList.remove('scanning');

      pipelineOutput!.innerHTML =
        `<span class="prompt">$</span> <span class="cmd">inv pipeline status --project clinic-checkin</span>\n` +
        `<span class="out">VERTICAL  STATUS      ITEMS  TRACES\npm        pending     0/3    —\ndesign    pending     0/3    —\ndev       pending     0/3    —</span>\n\n` +
        `<span class="prompt">$</span> <span class="cmd">_</span>`;
      return;
    }
  }

  document.querySelectorAll<HTMLButtonElement>('[data-pipeline]').forEach(btn => {
    btn.addEventListener('click', () => runPipeline(btn.dataset.pipeline!));
  });
}
