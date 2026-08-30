import { matchCatalogModels } from '../../../packages/pivi-react/src/settings/models/catalogModelMatching';

const catalogModels = [
  { value: 'qwen/qwen3.5-27b', label: 'Qwen3.5 27B' },
  { value: 'qwen/qwen3.5-27b-instruct', label: 'Qwen3.5 27B Instruct' },
  { value: 'zai/glm-5.3-flash', label: 'GLM 5.3 Flash' },
  { value: 'openai/gpt-5', label: 'GPT-5' },
];

describe('matchCatalogModels', () => {
  it.each([
    ['qwen3.5-27b-nvfp4', 'qwen/qwen3.5-27b'],
    ['qwen3.5-27b/NVFP4', 'qwen/qwen3.5-27b'],
    ['qwen3.5-27b-instruct-nvfp4', 'qwen/qwen3.5-27b-instruct'],
    ['GLM-5.3-Flash-EXL3', 'zai/glm-5.3-flash'],
  ])('ignores a runtime format suffix in %s', (providerModelName, expected) => {
    expect(matchCatalogModels(catalogModels, '', providerModelName)[0]?.value).toBe(expected);
  });
});
