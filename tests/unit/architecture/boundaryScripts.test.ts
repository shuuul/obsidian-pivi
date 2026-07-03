import { execFileSync } from 'child_process';

const rootDir = process.cwd();

describe('architecture boundary scripts', () => {
  it('passes import boundary checks', () => {
    expect(() => {
      execFileSync('node', ['scripts/check-architecture-boundaries.mjs'], {
        cwd: rootDir,
        stdio: 'pipe',
      });
    }).not.toThrow();
  });

  it('passes package README coverage checks', () => {
    expect(() => {
      execFileSync('node', ['scripts/check-package-readmes.mjs'], {
        cwd: rootDir,
        stdio: 'pipe',
      });
    }).not.toThrow();
  });
});
