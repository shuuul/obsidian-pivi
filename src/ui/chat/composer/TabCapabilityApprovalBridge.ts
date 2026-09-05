import type { CapabilityApprovalPort, CapabilityApprovalRequest } from '@pivi/agent/ports';
import {
  type CapabilityApprovalPersistence,
  CapabilityPersistentGrantCache,
  createCapabilityApprovalPort,
} from '@pivi/agent/runtime/capabilitySessionGrants';

import type { InputController } from '../controllers/InputController';

export class TabCapabilityApprovalBridge {
  private readonly cache = new CapabilityPersistentGrantCache();
  private readonly persistence: CapabilityApprovalPersistence;
  private readonly port: CapabilityApprovalPort;
  private inputController: InputController | null = null;

  constructor(persistence: CapabilityApprovalPersistence) {
    this.persistence = persistence;
    this.port = createCapabilityApprovalPort({
      cache: this.cache,
      persistence,
      present: async (request) => {
        const controller = this.inputController;
        if (!controller) {
          return { decision: 'deny' };
        }
        return controller.handleCapabilityApproval(request);
      },
    });
    const bash = persistence.getBashPermissions?.() ?? [];
    const external = persistence.getExternalDirectories?.() ?? [];
    this.cache.replace(bash, external);
  }

  bindInputController(controller: InputController): void {
    this.inputController = controller;
  }

  refreshFromSettings(): void {
    const bash = this.persistence.getBashPermissions?.() ?? [];
    const external = this.persistence.getExternalDirectories?.() ?? [];
    this.cache.replace(bash, external);
  }

  getPort(): CapabilityApprovalPort {
    return this.port;
  }

  dispose(): void {
    this.inputController = null;
  }
}

export type { CapabilityApprovalRequest };
