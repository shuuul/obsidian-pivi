import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Pi compatibility canary workflow', () => {
  const workflow = readFileSync(
    join(process.cwd(), '.github/workflows/pi-compatibility-canary.yaml'),
    'utf8',
  );

  it('runs weekly or manually without becoming a required compatibility gate', () => {
    expect(workflow).toContain('schedule:');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('continue-on-error: true');
    expect(workflow).not.toContain('pull_request:');
  });

  it('tests a synchronized target and updates one stable issue comment', () => {
    expect(workflow).toContain('prepare-pi-canary.mjs --resolve');
    expect(workflow).toContain('npm run test:pi-compat');
    expect(workflow).toContain('npm run build');
    expect(workflow).toContain('TRACKING_ISSUE: "113"');
    expect(workflow).toContain('<!-- pivi-pi-compatibility-canary -->');
    expect(workflow).toContain('--method PATCH');
    expect(workflow).not.toContain('gh issue create');
  });

  it('pins third-party actions to full commit SHAs', () => {
    expect(workflow).toMatch(/actions\/checkout@[0-9a-f]{40}/);
    expect(workflow).toMatch(/actions\/setup-node@[0-9a-f]{40}/);
  });

  it('isolates read-only compatibility checks from issue-write authority', () => {
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(workflow).toMatch(/canary:[\s\S]*?outputs:[\s\S]*?persist-credentials: false/);
    expect(workflow).toMatch(/update-issue:[\s\S]*?permissions:\s*\n\s+issues: write/);
    const canaryJob = workflow.slice(workflow.indexOf('  canary:'), workflow.indexOf('  update-issue:'));
    expect(canaryJob).not.toContain('issues: write');
    const updateIssueJob = workflow.slice(workflow.indexOf('  update-issue:'));
    expect(updateIssueJob).not.toContain('actions/checkout@');
  });
});
