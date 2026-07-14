import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const rootDir = process.cwd();

describe('check-i18n-dead-keys script', () => {
  it('passes when every catalog key is referenced', () => {
    expect(() => {
      execFileSync('node', ['scripts/check-i18n-dead-keys.mjs'], {
        cwd: rootDir,
        stdio: 'pipe',
      });
    }).not.toThrow();
  });

  it('rejects a key referenced only by tests', () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'pivi-i18n-dead-keys-'));
    const localesDir = path.join(fixtureRoot, 'packages/pivi-react/src/i18n/locales');
    mkdirSync(localesDir, { recursive: true });
    mkdirSync(path.join(fixtureRoot, 'src'), { recursive: true });
    mkdirSync(path.join(fixtureRoot, 'tests'), { recursive: true });
    writeFileSync(path.join(localesDir, 'en.json'), JSON.stringify({
      common: {
        productKey: 'Product copy',
        testOnlyKey: 'Test-only copy',
      },
    }));
    writeFileSync(path.join(fixtureRoot, 'src/product.ts'), "t('common.productKey');\n");
    writeFileSync(path.join(fixtureRoot, 'tests/product.test.ts'), "t('common.testOnlyKey');\n");

    let stderr = '';
    try {
      execFileSync('node', ['scripts/check-i18n-dead-keys.mjs'], {
        cwd: rootDir,
        env: { ...process.env, PIVI_I18N_PROJECT_ROOT: fixtureRoot },
        stdio: 'pipe',
      });
    } catch (error) {
      stderr = String((error as { stderr?: Buffer }).stderr ?? '');
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }

    expect(stderr).toContain('common.testOnlyKey');
  });
});
