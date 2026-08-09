import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { readTrustedFullOutputFileDesktop } from '@/ui/chat/services/subagentOutputDesktop';

describe('readTrustedFullOutputFileDesktop', () => {
  let tempDir: string;
  let outputPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-subagent-output-'));
    outputPath = path.join(tempDir, 'agent.output');
    fs.writeFileSync(outputPath, '  full subagent payload  \n', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads trimmed content from a trusted temp .output file', () => {
    expect(readTrustedFullOutputFileDesktop(outputPath)).toBe('full subagent payload');
  });

  it('rejects non-.output paths even under tmp', () => {
    const other = path.join(tempDir, 'agent.txt');
    fs.writeFileSync(other, 'secret', 'utf-8');
    expect(readTrustedFullOutputFileDesktop(other)).toBeNull();
  });

  it('rejects relative paths', () => {
    expect(readTrustedFullOutputFileDesktop('agent.output')).toBeNull();
  });
});
