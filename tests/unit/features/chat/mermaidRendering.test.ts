import {
  clampMermaidScale,
  getMermaidDiagramSize,
} from '@/ui/chat/rendering/messageRendererMarkdown';

function makeSvg(options: {
  attrs?: Record<string, string | null>;
  viewBox?: { width: number; height: number } | null;
  rect?: { width: number; height: number };
}): SVGSVGElement {
  return {
    getAttribute: (name: string) => options.attrs?.[name] ?? null,
    viewBox: options.viewBox === null
      ? undefined
      : { baseVal: options.viewBox ?? { width: 0, height: 0 } },
    getBoundingClientRect: () => options.rect ?? { width: 0, height: 0 },
  } as unknown as SVGSVGElement;
}

describe('Mermaid chat rendering helpers', () => {
  it('reads explicit SVG width and height first', () => {
    expect(getMermaidDiagramSize(makeSvg({ attrs: { width: '640', height: '320' } })))
      .toEqual({ width: 640, height: 320 });
  });

  it('falls back to viewBox dimensions when explicit dimensions are absent', () => {
    expect(getMermaidDiagramSize(makeSvg({ viewBox: { width: 900, height: 450 } })))
      .toEqual({ width: 900, height: 450 });
  });

  it('falls back to the rendered rect and then default dimensions', () => {
    expect(getMermaidDiagramSize(makeSvg({ rect: { width: 500, height: 250 } })))
      .toEqual({ width: 500, height: 250 });
    expect(getMermaidDiagramSize(makeSvg({ rect: { width: 0, height: 0 } })))
      .toEqual({ width: 800, height: 400 });
  });

  it('clamps Mermaid zoom scale to the supported range', () => {
    expect(clampMermaidScale(0.01)).toBe(0.1);
    expect(clampMermaidScale(1.25)).toBe(1.25);
    expect(clampMermaidScale(5)).toBe(2);
  });
});
