import type { HighRiskOperationRequest } from '@pivi/pivi-agent-core/runtime/highRisk';
import { type App, Modal, Setting } from 'obsidian';

import { t } from '@/app/i18n';

function formatPreview(request: HighRiskOperationRequest): string {
  const lines: string[] = [];
  const resources = request.resources;
  if (resources.paths?.length) {
    lines.push(t('highRisk.preview.paths', { paths: resources.paths.join(', ') }));
  }
  if (resources.executable) {
    const argv = [resources.executable, ...(resources.args ?? [])].join(' ');
    lines.push(t('highRisk.preview.command', { command: argv }));
  }
  if (resources.cwd) {
    lines.push(t('highRisk.preview.cwd', { cwd: resources.cwd }));
  }
  if (resources.envVarNames?.length) {
    lines.push(t('highRisk.preview.envNames', { names: resources.envVarNames.join(', ') }));
  }
  if (resources.mcpServer) {
    lines.push(t('highRisk.preview.mcpServer', { server: resources.mcpServer }));
  }
  if (resources.mcpTool) {
    lines.push(t('highRisk.preview.mcpTool', { tool: resources.mcpTool }));
  }
  if (resources.origin) {
    lines.push(t('highRisk.preview.origin', { origin: resources.origin }));
  }
  if (typeof resources.bulkCount === 'number') {
    lines.push(t('highRisk.preview.bulkCount', { count: String(resources.bulkCount) }));
  }
  return lines.join('\n');
}

function titleForKind(kind: HighRiskOperationRequest['kind']): string {
  switch (kind) {
    case 'delete':
      return t('highRisk.title.delete');
    case 'overwrite':
      return t('highRisk.title.overwrite');
    case 'bulk-mutation':
      return t('highRisk.title.bulkMutation');
    case 'bash':
      return t('highRisk.title.bash');
    case 'eval':
      return t('highRisk.title.eval');
    case 'stdio-mcp-launch':
      return t('highRisk.title.stdioMcpLaunch');
    case 'mcp-artifact-write':
      return t('highRisk.title.mcpArtifactWrite');
    default:
      return t('highRisk.title.generic');
  }
}

export function presentHighRiskApproval(
  app: App,
  request: HighRiskOperationRequest,
): Promise<'approve' | 'deny' | 'cancel'> {
  return new Promise((resolve) => {
    new HighRiskApprovalModal(app, request, resolve).open();
  });
}

class HighRiskApprovalModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly request: HighRiskOperationRequest,
    private readonly resolveDecision: (decision: 'approve' | 'deny' | 'cancel') => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(titleForKind(this.request.kind));
    this.modalEl.addClass('pivi-high-risk-modal');
    this.contentEl.createEl('p', { text: t('highRisk.message') });
    const preview = this.contentEl.createEl('pre', {
      cls: 'pivi-high-risk-preview',
      text: formatPreview(this.request),
    });
    preview.setAttr('role', 'region');
    preview.setAttr('aria-label', t('highRisk.previewAria'));

    new Setting(this.contentEl)
      .addButton((btn) =>
        btn
          .setButtonText(t('common.cancel'))
          .onClick(() => {
            this.finish('cancel');
          }))
      .addButton((btn) =>
        btn
          .setButtonText(t('highRisk.deny'))
          .onClick(() => {
            this.finish('deny');
          }))
      .addButton((btn) =>
        btn
          .setButtonText(t('highRisk.approve'))
          .setClass('mod-warning')
          .onClick(() => {
            this.finish('approve');
          }));
  }

  onClose(): void {
    if (!this.resolved) {
      this.resolveDecision('cancel');
    }
    this.contentEl.empty();
  }

  private finish(decision: 'approve' | 'deny' | 'cancel'): void {
    this.resolved = true;
    this.resolveDecision(decision);
    this.close();
  }
}
