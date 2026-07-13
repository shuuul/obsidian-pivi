import { setIcon, setTooltip } from 'obsidian';

import { obsidianPresentationPlatform } from '@/app/ui/obsidianPresentationPlatform';

describe('obsidianPresentationPlatform', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('adapts presentation icon and tooltip requests to Obsidian', () => {
    const element = {} as HTMLElement;

    obsidianPresentationPlatform.renderIcon(element, 'sparkles');
    obsidianPresentationPlatform.attachTooltip(element, 'Choose a model', {
      delay: 3000,
    });

    expect(setIcon).toHaveBeenCalledWith(element, 'sparkles');
    expect(setTooltip).toHaveBeenCalledWith(element, 'Choose a model', {
      delay: 3000,
    });
  });

  it('keeps host terminology in the Obsidian adapter', () => {
    expect(obsidianPresentationPlatform.getTerminology('en')).toEqual({
      hostName: 'Obsidian',
      secureStorageName: 'Obsidian keychain',
      workspaceName: 'vault',
    });
    expect(obsidianPresentationPlatform.getTerminology('zh-CN')).toEqual({
      hostName: 'Obsidian',
      secureStorageName: 'Obsidian 钥匙串',
      workspaceName: '库',
    });
  });
});
