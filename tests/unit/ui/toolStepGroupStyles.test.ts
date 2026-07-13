import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('tool step group styles', () => {
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

  it('separates subagent steps and adapts tool chrome to the content width', () => {
    const styles = readFileSync(
      join(process.cwd(), 'packages/pivi-react/styles/components/subagent.css'),
      'utf8',
    );

    expect(styles).toContain('container: pivi-subagent-content / inline-size');
    expect(styles).toContain('.pivi-subagent-tools>.pivi-tool-step-group');
    expect(styles).toContain('.pivi-subagent-tools .pivi-tool-call-in-step-group');
    expect(styles).toContain('.pivi-subagent-tools .pivi-tool-step-group-steps:not(.pivi-hidden)');
    expect(styles).not.toMatch(/\.pivi-subagent-tools \.pivi-tool-step-group-steps\s*\{[^}]*display:\s*flex;/);
    expect(styles).toContain('@container pivi-subagent-content (max-width: 320px)');
    expect(styles).toContain('@container pivi-subagent-content (max-width: 240px)');
  });

  it('animates only running top-level tool and subagent headers', () => {
    const styles = readFileSync(
      join(process.cwd(), 'packages/pivi-react/styles/base/animations.css'),
      'utf8',
    );

    expect(styles).toContain('@keyframes pivi-running-header-flow');
    expect(styles).toContain('.pivi-message-content>.pivi-tool-call:not(.pivi-tool-call-in-step-group)');
    expect(styles).toContain('.pivi-message-content>.pivi-tool-step-group:has(');
    expect(styles).toContain('.pivi-subagent-status:is(.status-pending, .status-running)');
    expect(styles).toContain('animation: pivi-running-header-flow 1.35s linear infinite');
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.pivi-subagent-header::after\s*\{\s*animation:\s*none;/);
  });
});
