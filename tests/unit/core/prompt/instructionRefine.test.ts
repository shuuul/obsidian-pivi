import {
  buildRefineSystemPrompt,
  parseInstructionRefineResponse,
} from '../../../../src/core/prompt/instructionRefine';

describe('instructionRefine', () => {
  it('includes existing instructions in refine system prompt', () => {
    const prompt = buildRefineSystemPrompt('Always reply in Chinese.');
    expect(prompt).toContain('EXISTING INSTRUCTIONS');
    expect(prompt).toContain('Always reply in Chinese.');
  });

  it('parses refined instruction tags', () => {
    const result = parseInstructionRefineResponse(
      '<instruction>- **Tone**: Be concise.</instruction>',
    );
    expect(result).toEqual({
      success: true,
      refinedInstruction: '- **Tone**: Be concise.',
    });
  });

  it('returns clarification for plain text responses', () => {
    const result = parseInstructionRefineResponse('Which tone do you prefer?');
    expect(result).toEqual({
      success: true,
      clarification: 'Which tone do you prefer?',
    });
  });
});
