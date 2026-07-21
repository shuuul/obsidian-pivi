import { readFileSync } from 'fs';

const forbiddenPatterns = [
  { label: 'dynamic script element creation', pattern: /createElement\(["']script["']\)/ },
  { label: 'dynamic Function construction', pattern: /new Function\s*\(/ },
];

export const assertCommunityAudit = {
  name: 'assert-community-audit',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      const output = result.outputFiles?.find(file => file.path.endsWith('main.js'))?.text
        ?? readFileSync(build.initialOptions.outfile, 'utf8');
      const findings = forbiddenPatterns
        .filter(({ pattern }) => pattern.test(output))
        .map(({ label }) => ({ text: `Community audit notice: found ${label} in main.js (verify this is from a bundled dependency, not Pivi source)` }));
      // Report as warnings, not errors: React 19's DOM bundle legitimately
      // contains createElement("script") internally.  Blocking the build
      // (and therefore the copy-to-obsidian deploy) on a dependency false
      // positive prevents local development.  The warning remains visible
      // so real Pivi-source regressions are caught during review.
      result.warnings.push(...findings);
    });
  },
};
