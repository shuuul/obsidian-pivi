import type { CapabilityApprovalPort, CapabilityApprovalRequest } from '@pivi/pivi-agent-core/ports';
import {
  type CapabilityApprovalPersistence,
  CapabilitySessionGrants,
  createCapabilityApprovalPort,
} from '@pivi/pivi-agent-core/runtime/capabilitySessionGrants';

import type { InputController } from '../controllers/InputController';

export class TabCapabilityApprovalBridge {
  private readonly grants = new CapabilitySessionGrants();
  private readonly port: CapabilityApprovalPort;
  private inputController: InputController | null = null;

  constructor(persistence: CapabilityApprovalPersistence) {
    this.port = createCapabilityApprovalPort({
      grants: this.grants,
      persistence,
      present: async (request) => {
        const controller = this.inputController;
        if (!controller) {
          return { decision: 'deny' };
        }
        return controller.handleCapabilityApproval(request);
      },
    });
  }

  bindInputController(controller: InputController): void {
    this.inputController = controller;
  }

  getPort(): CapabilityApprovalPort {
    return this.port;
  }

  clearSessionGrants(): void {
    this.grants.clear();
    this.port.clearSessionGrants();
  }

  dispose(): void {
    this.inputController = null;
    this.clearSessionGrants();
  }
}

export type { CapabilityApprovalRequest };
