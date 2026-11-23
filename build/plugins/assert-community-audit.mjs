const forbiddenPatterns = [
  { label: 'dynamic script element creation', pattern: /createElement\(["']script["']\)/ },
  { label: 'dynamic Function construction', pattern: /new Function\s*\(/ },
  // The community review static scan treats string references to the plugin's
  // own files combined with file writes as a self-update signal. Pivi never
  // writes its plugin directory, so keep these literals out of the bundle.
  { label: 'plugin self-file reference "manifest.json"', pattern: /["'`][^"'`\n]*manifest\.json[^"'`\n]*["'`]/ },
  { label: 'plugin self-file reference "main.js"', pattern: /["'`][^"'`\n]*main\.js["'`]/ },
];

export const assertCommunityAudit = {
  name: 'assert-community-audit',
  generateBundle(_options, bundle) {
    const output = bundle['main.js'].code;
    const findings = forbiddenPatterns
      .filter(({ pattern }) => pattern.test(output))
      .map(({ label }) => `Community audit failed: found ${label} in main.js`);
    if (findings.length) throw new Error(findings.join('\n'));
  },
};
