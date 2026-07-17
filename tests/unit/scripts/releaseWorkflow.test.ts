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

  it('creates one tag-push attestation for all Obsidian release assets', () => {
    expect(workflow).toContain('artifact-metadata: write');
    expect(workflow).toMatch(
      /subject-path:\s*\|\s*\n\s+main\.js\s*\n\s+manifest\.json\s*\n\s+styles\.css/,
    );
    expect(workflow.match(/uses: actions\/attest@v4/g)).toHaveLength(1);
  });

  it('verifies the uploaded bytes against the release tag provenance', () => {
    expect(workflow).toContain('gh release download "$RELEASE_TAG_RESOLVED"');
    expect(workflow).toContain('gh attestation verify "$download_dir/$file"');
    expect(workflow).toContain('--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/release.yaml"');
    expect(workflow).toContain('--source-ref "refs/tags/$RELEASE_TAG_RESOLVED"');
    expect(workflow).toContain('--source-digest "$GITHUB_SHA"');
    expect(workflow).toContain('--deny-self-hosted-runners');
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
