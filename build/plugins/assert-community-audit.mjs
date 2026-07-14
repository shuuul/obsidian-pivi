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
        .map(({ label }) => ({ text: `Community audit regression: found ${label} in main.js` }));
      result.errors.push(...findings);
    });
  },
};
