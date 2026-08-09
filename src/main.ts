import { Plugin } from 'obsidian';

import { resolvePiviPlatformCapabilities } from '@/app/platformCapabilities';

interface PiviPlatformRuntime {
  onload(): Promise<void>;
  onunload(): void;
}

/** Platform-neutral Obsidian lifecycle owner. */
export default class PiviPlugin extends Plugin {
  private runtime: PiviPlatformRuntime | null = null;
  private lifecycleGeneration = 0;

  async onload(): Promise<void> {
    const generation = ++this.lifecycleGeneration;
    const capabilities = resolvePiviPlatformCapabilities();
    const runtime = capabilities.platform === 'mobile'
      ? await import('@/app/composition/mobile/bootstrap')
        .then(module => module.createMobileRuntime(this, capabilities))
      : await import('@/app/composition/desktop/bootstrap')
        .then(module => module.createDesktopRuntime(this, capabilities));
    if (generation !== this.lifecycleGeneration) {
      runtime.onunload();
      return;
    }
    this.runtime = runtime;
    await runtime.onload();
  }

  onunload(): void {
    this.lifecycleGeneration += 1;
    this.runtime?.onunload();
    this.runtime = null;
  }
}
