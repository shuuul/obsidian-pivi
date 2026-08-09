import type {
  PiviManagementApprovalDecision,
  PiviManagementApprovalPort,
  PiviManagementApprovalRequest,
} from '@pivi/agent/tools/piviManagement';

import type { InputController } from '../controllers/InputController';

export class TabPiviManagementApprovalBridge implements PiviManagementApprovalPort {
  private controller: InputController | null = null;
  private disposed = false;
  private pending: { settle: (decision: PiviManagementApprovalDecision) => void } | null = null;

  bindInputController(controller: InputController): void {
    if (!this.disposed) this.controller = controller;
  }

  requestApproval(
    request: PiviManagementApprovalRequest,
    signal?: AbortSignal,
  ): Promise<PiviManagementApprovalDecision> {
    const controller = this.controller;
    if (this.disposed || !controller || this.pending || signal?.aborted) {
      return Promise.resolve('cancel');
    }
    return new Promise((resolve) => {
      let settled = false;
      const settle = (decision: PiviManagementApprovalDecision): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        if (this.pending?.settle === settle) this.pending = null;
        resolve(decision);
      };
      const onAbort = (): void => {
        this.controller?.dismissPendingInlinePrompts();
        settle('cancel');
      };
      this.pending = { settle };
      signal?.addEventListener('abort', onAbort, { once: true });
      void controller.handlePiviManagementApproval(request, signal).then(settle, () => settle('cancel'));
    });
  }

  cancelPending(): void {
    this.controller?.dismissPendingInlinePrompts();
    this.pending?.settle('cancel');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPending();
    this.controller = null;
  }
}
