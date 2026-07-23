import { readFileSync } from 'fs';
import { join } from 'path';

const rootDir = process.cwd();

describe('release provenance workflow', () => {
  const workflow = readFileSync(
    join(rootDir, '.github', 'workflows', 'release.yaml'),
    'utf8',
  );
  const ciWorkflow = readFileSync(
    join(rootDir, '.github', 'workflows', 'ci.yaml'),
    'utf8',
  );
  const releasePleaseWorkflow = readFileSync(
    join(rootDir, '.github', 'workflows', 'release-please.yaml'),
    'utf8',
  );
  const qualityGates = readFileSync(
    join(rootDir, '.github', 'actions', 'quality-gates', 'action.yml'),
    'utf8',
  );
  const dependabot = readFileSync(
    join(rootDir, '.github', 'dependabot.yml'),
    'utf8',
  );

  it('publishes only from tag pushes', () => {
    expect(workflow).toMatch(/push:\s*\n\s+tags:/);
    expect(workflow).not.toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/release:\s*\n\s+types:/);
    expect(workflow).toContain('tag="${GITHUB_REF_NAME}"');
    expect(workflow).toContain('expected_ref="refs/tags/${tag}"');
  });

  it('does not attach attestations that the live Obsidian reviewer rejects', () => {
    expect(workflow).not.toContain('actions/attest');
    expect(workflow).not.toContain('attestations: write');
    expect(workflow).not.toContain('artifact-metadata: write');
    expect(workflow).not.toContain('id-token: write');
  });

  it('verifies that the uploaded bytes match the tag build', () => {
    expect(workflow).toContain('gh release download "$RELEASE_TAG_RESOLVED"');
    expect(workflow).toContain(
      'cmp --silent "$file" "$download_dir/$file"',
    );
    expect(workflow).toContain('sha256sum "$download_dir/main.js"');
    expect(workflow).not.toContain('gh attestation verify');
  });

  it('requires complete changelog notes and leaves publication to the tag workflow', () => {
    expect(workflow).toContain(
      'CHANGELOG.md has no non-empty section for $RELEASE_TAG_RESOLVED.',
    );
    expect(workflow).not.toContain('See CHANGELOG.md for details.');
    expect(releasePleaseWorkflow).toContain('skip-github-release: true');
    expect(releasePleaseWorkflow).not.toContain('gh workflow run release.yaml');
  });

  it('runs the same mandatory quality gates as CI before publication', () => {
    expect(qualityGates).toContain('npm run typecheck');
    expect(qualityGates).toContain('npm run lint');
    expect(qualityGates).toContain('npm run check:boundaries');
    expect(qualityGates).toContain('npm run test:coverage');
    expect(qualityGates).toContain('npm run build');
    expect(qualityGates).toContain('npm run check:bundle-size');
    expect(ciWorkflow).toContain('uses: ./.github/actions/quality-gates');
    expect(workflow).toContain('uses: ./.github/actions/quality-gates');
    expect(workflow.indexOf('uses: ./.github/actions/quality-gates'))
      .toBeLessThan(workflow.indexOf('Create or update GitHub release'));
  });

  it('pins third-party Actions to full commit SHAs and keeps Dependabot coverage', () => {
    const pinPattern = /uses:\s+(actions\/checkout|actions\/setup-node|googleapis\/release-please-action)@[0-9a-f]{40}/g;
    expect(ciWorkflow.match(pinPattern)?.length).toBeGreaterThanOrEqual(2);
    expect(workflow.match(pinPattern)?.length).toBeGreaterThanOrEqual(2);
    expect(releasePleaseWorkflow.match(pinPattern)?.length).toBeGreaterThanOrEqual(2);
    expect(ciWorkflow).not.toMatch(/uses:\s+actions\/checkout@v\d/);
    expect(workflow).not.toMatch(/uses:\s+actions\/setup-node@v\d/);
    expect(releasePleaseWorkflow).not.toMatch(/uses:\s+googleapis\/release-please-action@v\d/);
    expect(dependabot).toContain('package-ecosystem: "github-actions"');
  });

  it('runs focused macOS and Windows platform-security jobs', () => {
    expect(ciWorkflow).toContain('macos-latest');
    expect(ciWorkflow).toContain('windows-latest');
    expect(ciWorkflow).toContain('npm run test:platform-security');
  });
});
