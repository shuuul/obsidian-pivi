import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('tool step group styles', () => {
  it('keeps generic tool shells free of a border and background surface', () => {
    const styles = readFileSync(
      join(process.cwd(), 'packages/pivi-react/styles/components/toolcalls.css'),
      'utf8',
    );
    const toolShell = styles.match(/\.pivi-tool-call\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(toolShell).toContain('margin: 4px 0');
    expect(toolShell).not.toMatch(/border(?:-inline-start|-radius)?\s*:/);
    expect(toolShell).not.toMatch(/background\s*:/);
    expect(toolShell).not.toMatch(/overflow\s*:/);
  });

  it('does not prepend a decorative list dot to the step summary', () => {
    const styles = readFileSync(
      join(process.cwd(), 'packages/pivi-react/styles/components/toolcalls.css'),
      'utf8',
    );

    expect(styles).not.toMatch(/\.pivi-tool-step-group-header::before\s*\{/);
  });

  it('shares a one-line flex header contract with imperative subagent rows', () => {
    const styles = readFileSync(
      join(process.cwd(), 'packages/pivi-react/styles/components/toolcalls.css'),
      'utf8',
    );

    expect(styles).toMatch(/\.pivi-container \.pivi-tool-step-group-header,\s*\n\.pivi-container \.pivi-tool-header\s*\{/);
    expect(styles).toMatch(/\.pivi-container \.pivi-tool-step-group-header,[\s\S]*?display:\s*flex;/);
    expect(styles).toMatch(/\.pivi-container \.pivi-tool-step-group-header,[\s\S]*?flex-wrap:\s*nowrap;/);
    expect(styles).not.toContain('.pivi-container button.pivi-tool-header');
  });

  it('keeps subagent steps unboxed, contiguous, and width-adaptive', () => {
    const styles = readFileSync(
      join(process.cwd(), 'packages/pivi-react/styles/components/subagent.css'),
      'utf8',
    );

    expect(styles).toContain('container: pivi-subagent-content / inline-size');
    expect(styles).toContain('.pivi-subagent-tools>.pivi-tool-step-group');
    expect(styles).toContain('.pivi-subagent-tools .pivi-tool-call-in-step-group');
    expect(styles).toContain('.pivi-subagent-tools .pivi-tool-step-group-steps:not(.pivi-hidden)');
    expect(styles).not.toMatch(/\.pivi-subagent-tools \.pivi-tool-step-group-steps\s*\{[^}]*display:\s*flex;/);
    expect(styles).toMatch(/\.pivi-subagent-tools \.pivi-tool-step-group-steps:not\(\.pivi-hidden\)\s*\{[^}]*gap:\s*0;/s);
    expect(styles).toMatch(/\.pivi-subagent-tools \.pivi-tool-step-group-steps:not\(\.pivi-hidden\)\s*\{[^}]*padding:\s*2px 0 4px 8px;/s);
    expect(styles).not.toMatch(/\.pivi-subagent-tools>\.pivi-tool-step-group\s*\{[^}]*(?:border|background|padding):/s);
    expect(styles).not.toMatch(/\.pivi-subagent-tools \.pivi-tool-call-in-step-group\s*\{[^}]*(?:border|background):/s);
    expect(styles).toMatch(/\.pivi-subagent-tools \.pivi-tool-call-in-step-group\s*\{[^}]*margin:\s*0;/s);
    expect(styles).toContain('@container pivi-subagent-content (max-width: 320px)');
    expect(styles).toContain('@container pivi-subagent-content (max-width: 240px)');
  });

  it('restores subagent motion only for the canonical running lifecycle class', () => {
    const animationStyles = readFileSync(
      join(process.cwd(), 'packages/pivi-react/styles/base/animations.css'),
      'utf8',
    );
    const accessibilityStyles = readFileSync(
      join(process.cwd(), 'packages/pivi-react/styles/accessibility.css'),
      'utf8',
    );

    expect(animationStyles).toContain('@keyframes pivi-working-icon-spin');
    expect(animationStyles).toMatch(/\.pivi-working-icon-arc\s*\{[^}]*animation:\s*pivi-working-icon-spin/s);
    expect(animationStyles).toContain('@keyframes pivi-running-header-flow');
    expect(animationStyles).toContain('@keyframes pivi-subagent-icon-stroke-draw');
    expect(animationStyles).toContain('@keyframes pivi-subagent-icon-sway');
    expect(animationStyles).toContain('@keyframes pivi-subagent-heart-pulse');
    expect(animationStyles).toMatch(/\.pivi-subagent-list\.running>\.pivi-subagent-header::after\s*\{[^}]*animation:\s*pivi-running-header-flow/s);
    expect(animationStyles).not.toContain('.pivi-subagent-list:is(.is-running, .pending, .running)');
    expect(animationStyles).not.toContain('.pivi-subagent-list.queued>.pivi-subagent-header::after');
    expect(animationStyles).not.toContain('.pivi-subagent-list.waiting>.pivi-subagent-header::after');
    expect(accessibilityStyles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.pivi-subagent-running-icon \.pivi-subagent-icon-stroke,[\s\S]*?\.pivi-subagent-header::after,[\s\S]*?animation:\s*none;/);
  });
});
