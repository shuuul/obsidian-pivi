import type { UsageInfo } from '@pivi/pivi-agent-core/foundation';

export class ContextUsageMeter {
  private container: HTMLElement;
  private inputGaugeEl: HTMLElement | null = null;
  private outputGaugeEl: HTMLElement | null = null;
  private inputFillPath: SVGPathElement | null = null;
  private outputFillPath: SVGPathElement | null = null;
  private circumference: number = 0;

  constructor(parentEl: HTMLElement) {
    this.container = parentEl.createDiv({ cls: 'pivi-context-meter' });
    this.render();
    // Initially hidden
    this.container.addClass('pivi-hidden');
  }

  setVisible(visible: boolean): void {
    this.container.toggleClass('pivi-hidden', !visible);
  }

  private render() {
    const size = 16;
    const strokeWidth = 2;
    const radius = (size - strokeWidth) / 2;

    // 240° arc: from 150° to 390° (upper-left through bottom to upper-right)
    const startAngle = 150;
    const endAngle = 390;
    const arcDegrees = endAngle - startAngle;
    const arcRadians = (arcDegrees * Math.PI) / 180;
    this.circumference = radius * arcRadians;

    const inputGaugeEl = this.createGauge('input');
    const outputGaugeEl = this.createGauge('output');
    this.inputGaugeEl = inputGaugeEl;
    this.outputGaugeEl = outputGaugeEl;
    this.container.appendChild(inputGaugeEl);
    this.container.appendChild(outputGaugeEl);
  }

  private createGauge(kind: 'input' | 'output'): HTMLElement {
    const size = 16;
    const strokeWidth = 2;
    const radius = (size - strokeWidth) / 2;
    const cx = size / 2;
    const cy = size / 2;
    const startAngle = 150;
    const endAngle = 390;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);

    const gaugeEl = this.container.ownerDocument.createElement('div');
    gaugeEl.className = `pivi-context-meter-gauge pivi-context-meter-gauge-${kind}`;
    const svg = gaugeEl.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

    const pathData = `M ${x1} ${y1} A ${radius} ${radius} 0 1 1 ${x2} ${y2}`;
    const backgroundPath = gaugeEl.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
    backgroundPath.classList.add('pivi-meter-bg');
    backgroundPath.setAttribute('d', pathData);
    backgroundPath.setAttribute('fill', 'none');
    backgroundPath.setAttribute('stroke-width', String(strokeWidth));
    backgroundPath.setAttribute('stroke-linecap', 'round');

    const fillPath = gaugeEl.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
    fillPath.classList.add('pivi-meter-fill');
    fillPath.classList.add(`pivi-meter-fill-${kind}`);
    fillPath.setAttribute('d', pathData);
    fillPath.setAttribute('fill', 'none');
    fillPath.setAttribute('stroke-width', String(strokeWidth));
    fillPath.setAttribute('stroke-linecap', 'round');
    fillPath.setAttribute('stroke-dasharray', String(this.circumference));
    fillPath.setAttribute('stroke-dashoffset', String(this.circumference));

    svg.appendChild(backgroundPath);
    svg.appendChild(fillPath);
    gaugeEl.appendChild(svg);

    if (kind === 'input') {
      this.inputFillPath = fillPath;
    } else {
      this.outputFillPath = fillPath;
    }
    return gaugeEl;
  }

  update(usage: UsageInfo | null): void {
    if (!usage || usage.contextTokens <= 0) {
      this.container.addClass('pivi-hidden');
      return;
    }
    this.container.removeClass('pivi-hidden');
    const outputTokenLimit = usage.outputTokenLimit ?? usage.contextWindow;
    this.updateGauge(this.inputFillPath, usage.percentage);
    this.updateGauge(
      this.outputFillPath,
      this.calculatePercentage(usage.outputTokens ?? 0, outputTokenLimit),
    );
    this.inputGaugeEl?.setAttribute(
      'data-tooltip',
      `Input ${this.formatTokens(usage.contextTokens)} / ${this.formatTokens(usage.contextWindow)}`,
    );
    this.outputGaugeEl?.setAttribute(
      'data-tooltip',
      `Output ${this.formatTokens(usage.outputTokens ?? 0)} / ${this.formatTokens(outputTokenLimit)}`,
    );

    // Toggle warning class for > 80%
    if (usage.percentage > 80) {
      this.container.addClass('warning');
    } else {
      this.container.removeClass('warning');
    }
  }

  private updateGauge(fillPath: SVGPathElement | null, percentage: number): void {
    if (!fillPath) {
      return;
    }
    const fillLength = (percentage / 100) * this.circumference;
    fillPath.setAttribute('stroke-dashoffset', String(this.circumference - fillLength));
  }

  private calculatePercentage(tokens: number, limit: number): number {
    return limit > 0
      ? Math.min(100, Math.max(0, Math.round((tokens / limit) * 100)))
      : 0;
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) {
      return `${Math.round(tokens / 100_000) / 10}m`;
    }
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}k`;
    }
    return String(tokens);
  }
}
