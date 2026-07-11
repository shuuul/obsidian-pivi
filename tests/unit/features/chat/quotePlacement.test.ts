import {
  computeQuotePlacements,
  type QuotePoint,
  type QuoteRect,
  type QuoteSize,
} from '@/ui/chat/controllers/quotePlacement';

function rectAt(point: QuotePoint, size: QuoteSize): QuoteRect {
  return { ...point, ...size };
}

function expand(rect: QuoteRect, amount: number): QuoteRect {
  return {
    left: rect.left - amount,
    top: rect.top - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

function overlapArea(first: QuoteRect, second: QuoteRect): number {
  const width = Math.max(
    0,
    Math.min(first.left + first.width, second.left + second.width) - Math.max(first.left, second.left),
  );
  const height = Math.max(
    0,
    Math.min(first.top + first.height, second.top + second.height) - Math.max(first.top, second.top),
  );
  return width * height;
}

describe('computeQuotePlacements', () => {
  it('keeps three cards inside the container and clear of the greeting and each other', () => {
    const values = [0, 0, 1, 0, 0, 1];
    let index = 0;
    const card = { width: 220, height: 100 };
    const blocked = { left: 350, top: 280, width: 300, height: 140 };

    const points = computeQuotePlacements({
      container: { width: 1000, height: 700 },
      blocked,
      cards: [card, card, card],
      random: () => values[index++ % values.length],
    });

    expect(points).toHaveLength(3);
    expect(points).not.toContain(null);
    const cardRects = points.map(point => {
      if (!point) throw new Error('Expected an initial quote placement');
      return rectAt(point, card);
    });
    for (const rect of cardRects) {
      expect(rect.left).toBeGreaterThanOrEqual(16);
      expect(rect.top).toBeGreaterThanOrEqual(16);
      expect(rect.left + rect.width).toBeLessThanOrEqual(984);
      expect(rect.top + rect.height).toBeLessThanOrEqual(684);
      expect(overlapArea(rect, expand(blocked, 24))).toBe(0);
    }
    for (let first = 0; first < cardRects.length; first++) {
      for (let second = first + 1; second < cardRects.length; second++) {
        expect(overlapArea(cardRects[first], expand(cardRects[second], 16))).toBe(0);
      }
    }
  });

  it('places a new card outside existing cards', () => {
    const container = { width: 1000, height: 700 };
    const card = { width: 220, height: 100 };
    const occupied = { left: 16, top: 16, ...card };

    const [point] = computeQuotePlacements({
      container,
      blocked: null,
      cards: [card],
      occupied: [occupied],
      random: () => 0,
    });

    expect(point).not.toBeNull();
    if (!point) throw new Error('Expected a placement outside the existing card');
    expect(overlapArea(rectAt(point, card), expand(occupied, 16))).toBe(0);
  });

  it('does not place a new card when every position overlaps a visible card', () => {
    const [point] = computeQuotePlacements({
      container: { width: 300, height: 180 },
      blocked: null,
      cards: [{ width: 120, height: 80 }],
      occupied: [{ left: 16, top: 16, width: 268, height: 148 }],
      random: () => 0.5,
    });

    expect(point).toBeNull();
  });

  it('retries random placement before evaluating anchors', () => {
    const random = jest.fn(() => 0.5);
    const [point] = computeQuotePlacements({
      container: { width: 300, height: 180 },
      blocked: { left: 0, top: 0, width: 300, height: 180 },
      cards: [{ width: 120, height: 80 }],
      random,
    });

    expect(point).not.toBeNull();
    expect(random).toHaveBeenCalledTimes(160);
  });

  it('falls back to a peripheral point with minimum greeting overlap in a crowded container', () => {
    const container = { width: 300, height: 180 };
    const card = { width: 120, height: 80 };
    const blocked = { left: 70, top: 30, width: 160, height: 120 };
    const expandedBlocked = expand(blocked, 24);

    const [point] = computeQuotePlacements({
      container,
      blocked,
      cards: [card],
      random: () => 0.5,
    });

    expect(point).not.toBeNull();
    if (!point) throw new Error('Expected a fallback placement');
    expect(point.left).toBeGreaterThanOrEqual(16);
    expect(point.top).toBeGreaterThanOrEqual(16);
    expect(point.left + card.width).toBeLessThanOrEqual(container.width - 16);
    expect(point.top + card.height).toBeLessThanOrEqual(container.height - 16);
    expect(point).not.toEqual({ left: 90, top: 50 });

    const anchors = [
      { left: 16, top: 16 },
      { left: 164, top: 16 },
      { left: 16, top: 84 },
      { left: 164, top: 84 },
      { left: 90, top: 16 },
      { left: 90, top: 84 },
      { left: 16, top: 50 },
      { left: 164, top: 50 },
    ];
    const minimumOverlap = Math.min(
      ...anchors.map(anchor => overlapArea(rectAt(anchor, card), expandedBlocked)),
    );
    expect(overlapArea(rectAt(point, card), expandedBlocked)).toBe(minimumOverlap);
  });
});
