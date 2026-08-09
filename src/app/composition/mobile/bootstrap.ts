import type { Plugin } from 'obsidian';

import type { PiviPlatformCapabilities } from '@/app/platformCapabilities';

import type { MobileWorkspace } from './MobileWorkspace';

class PiviMobileRuntime {
  private workspace: MobileWorkspace | null = null;
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly owner: Plugin,
    private readonly capabilities: PiviPlatformCapabilities,
  ) {}

  async onload(): Promise<void> {
    const generation = ++this.generation;
    if (this.capabilities.platform !== 'mobile') throw new Error('Mobile runtime requires Mobile capabilities');
    // The artifact harness supplies no host APIs; registration must never expose a broken surface.
    if (!this.owner.app?.vault?.adapter || typeof this.owner.app.loadLocalStorage !== 'function') return;
    const [{ MobileWorkspace }, { registerMobileSurfaces, requestMobileApproval }] = await Promise.all([
      import('./MobileWorkspace'), import('./MobileSurfaces'),
    ]);
    if (this.disposed || generation !== this.generation) return;
    const workspace = new MobileWorkspace(this.owner.app, this.capabilities, {
      approve: request => requestMobileApproval(this.owner.app, request.toolName, request.signal),
    });
    if (this.disposed || generation !== this.generation) {
      workspace.dispose();
      return;
    }
    this.workspace = workspace;
    if (this.disposed || generation !== this.generation) {
      workspace.dispose();
      this.workspace = null;
      return;
    }
    registerMobileSurfaces(this.owner, workspace);
  }

  onunload(): void {
    this.disposed = true;
    this.generation += 1;
    this.workspace?.dispose();
    this.workspace = null;
  }
}

export function createMobileRuntime(owner: Plugin, capabilities: PiviPlatformCapabilities): PiviMobileRuntime {
  return new PiviMobileRuntime(owner, capabilities);
}
