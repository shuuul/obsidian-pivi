import { readFileSync } from 'fs';
import { join } from 'path';

const rootDir = process.cwd();

describe('release provenance workflow', () => {
  const workflow = readFileSync(
    join(rootDir, '.github', 'workflows', 'release.yaml'),
    'utf8',
  );
  const releasePleaseWorkflow = readFileSync(
    join(rootDir, '.github', 'workflows', 'release-please.yaml'),
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
});
