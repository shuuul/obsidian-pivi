import { readFileSync } from 'fs';
import { join } from 'path';

const rootDir = process.cwd();

describe('release provenance workflow', () => {
  const workflow = readFileSync(
    join(rootDir, '.github', 'workflows', 'release.yaml'),
    'utf8',
  );

  it('creates one attestation per Obsidian release asset', () => {
    expect(workflow).toContain('artifact-metadata: write');

    for (const file of ['main.js', 'manifest.json', 'styles.css']) {
      expect(workflow).toContain(`subject-path: ${file}`);
    }

    expect(workflow).not.toMatch(/subject-path:\s*\|/);
  });

  it('verifies the uploaded bytes against the release tag provenance', () => {
    expect(workflow).toContain('gh release download "$RELEASE_TAG_RESOLVED"');
    expect(workflow).toContain('gh attestation verify "$download_dir/$file"');
    expect(workflow).toContain('--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/release.yaml"');
    expect(workflow).toContain('--source-ref "refs/tags/$RELEASE_TAG_RESOLVED"');
    expect(workflow).toContain('--source-digest "$GITHUB_SHA"');
    expect(workflow).toContain('--deny-self-hosted-runners');
  });
});
