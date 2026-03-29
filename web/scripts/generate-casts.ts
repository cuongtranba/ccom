// web/scripts/generate-casts.ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CastWriter } from './cast-writer';
import {
  networkSetupScene,
  crossNodeQueryScene,
  proposalVoteScene,
} from './cast-scenes';

const OUT_DIR = join(import.meta.dir, '..', 'public', 'casts');

function generate(
  filename: string,
  title: string,
  sceneFn: () => { panes: import('./cast-writer').Pane[]; actions: import('./cast-writer').SceneAction[] },
): void {
  const writer = new CastWriter();
  const { panes, actions } = sceneFn();
  writer.drawFrames(panes);
  writer.run(actions);
  const content = writer.serialize(title);
  const path = join(OUT_DIR, filename);
  writeFileSync(path, content);
  console.log(`  ✓ ${filename} (${content.split('\n').length} events)`);
}

console.log('Generating cast files...\n');

generate('network-setup.cast', 'Network Setup — 4 Nodes Come Online', networkSetupScene);
generate('cross-node-query.cast', 'Cross-Node Query — Discovery & Accountability', crossNodeQueryScene);
generate('proposal-vote.cast', 'Proposal & Vote — Multi-Node Governance', proposalVoteScene);

console.log('\nDone. Files written to web/public/casts/');
