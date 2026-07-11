export interface QuoteSize {
  width: number;
  height: number;
}

export interface QuoteRect extends QuoteSize {
  left: number;
  top: number;
}

export interface QuotePoint {
  left: number;
  top: number;
}

export interface QuotePlacementInput {
  container: QuoteSize;
  blocked: QuoteRect | null;
  cards: readonly QuoteSize[];
  occupied?: readonly QuoteRect[];
  random: () => number;
}

const CONTAINER_PADDING = 16;
const BLOCKED_CLEARANCE = 24;
const CARD_GAP = 16;
const RANDOM_ATTEMPTS = 80;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function expandRect(rect: QuoteRect, amount: number): QuoteRect {
  return {
    left: rect.left - amount,
    top: rect.top - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

function overlapsRect(left: number, top: number, size: QuoteSize, rect: QuoteRect): boolean {
  return (
    left < rect.left + rect.width &&
    left + size.width > rect.left &&
    top < rect.top + rect.height &&
    top + size.height > rect.top
  );
}

function overlapsAny(
  left: number,
  top: number,
  size: QuoteSize,
  rects: readonly QuoteRect[],
): boolean {
  for (const rect of rects) {
    if (overlapsRect(left, top, size, rect)) return true;
  }
  return false;
}

function intersectionArea(first: QuoteRect, second: QuoteRect): number {
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

function toRect(point: QuotePoint, size: QuoteSize): QuoteRect {
  return { ...point, ...size };
}

function getBounds(container: QuoteSize, card: QuoteSize): QuoteRect {
  return {
    left: CONTAINER_PADDING,
    top: CONTAINER_PADDING,
    width: Math.max(0, container.width - card.width - CONTAINER_PADDING * 2),
    height: Math.max(0, container.height - card.height - CONTAINER_PADDING * 2),
  };
}

function clampPoint(point: QuotePoint, bounds: QuoteRect): QuotePoint {
  return {
    left: clamp(point.left, bounds.left, bounds.left + bounds.width),
    top: clamp(point.top, bounds.top, bounds.top + bounds.height),
  };
}

function getPeripheralAnchors(bounds: QuoteRect): readonly QuotePoint[] {
  const right = bounds.left + bounds.width;
  const bottom = bounds.top + bounds.height;
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  return [
    { left: bounds.left, top: bounds.top },
    { left: right, top: bounds.top },
    { left: bounds.left, top: bottom },
    { left: right, top: bottom },
    { left: centerX, top: bounds.top },
    { left: centerX, top: bottom },
    { left: bounds.left, top: centerY },
    { left: right, top: centerY },
  ];
}

function placedOverlapArea(candidate: QuoteRect, placed: readonly QuoteRect[]): number {
  let overlap = 0;
  for (const rect of placed) {
    overlap += intersectionArea(candidate, rect);
  }
  return overlap;
}

export function computeQuotePlacements(input: QuotePlacementInput): readonly (QuotePoint | null)[] {
  const placements: (QuotePoint | null)[] = [];
  const occupiedRects = input.occupied ?? [];
  const expandedOccupied = occupiedRects.map(rect => expandRect(rect, CARD_GAP));
  const placedRects: QuoteRect[] = [...expandedOccupied];
  const blocked = input.blocked ? expandRect(input.blocked, BLOCKED_CLEARANCE) : null;

  for (const card of input.cards) {
    const bounds = getBounds(input.container, card);
    let selected: QuotePoint | null = null;

    for (let attempt = 0; attempt < RANDOM_ATTEMPTS; attempt++) {
      const left = bounds.left + input.random() * bounds.width;
      const top = bounds.top + input.random() * bounds.height;
      if (
        !(blocked && overlapsRect(left, top, card, blocked)) &&
        !overlapsAny(left, top, card, placedRects)
      ) {
        selected = { left, top };
        break;
      }
    }

    if (!selected) {
      const candidates = getPeripheralAnchors(bounds).map(point => clampPoint(point, bounds));
      let bestClearCandidate: {
        point: QuotePoint;
        placedOverlap: number;
      } | null = null;
      let bestBlockedCandidate: {
        point: QuotePoint;
        blockedOverlap: number;
        placedOverlap: number;
      } | null = null;

      for (const point of candidates) {
        const rect = toRect(point, card);
        if (placedOverlapArea(rect, expandedOccupied) > 0) continue;

        const placedOverlap = placedOverlapArea(rect, placedRects);
        const blockedOverlap = blocked ? intersectionArea(rect, blocked) : 0;
        if (blockedOverlap === 0) {
          if (!bestClearCandidate || placedOverlap < bestClearCandidate.placedOverlap) {
            bestClearCandidate = { point, placedOverlap };
          }
          continue;
        }
        if (
          !bestBlockedCandidate ||
          blockedOverlap < bestBlockedCandidate.blockedOverlap ||
          (blockedOverlap === bestBlockedCandidate.blockedOverlap &&
            placedOverlap < bestBlockedCandidate.placedOverlap)
        ) {
          bestBlockedCandidate = { point, blockedOverlap, placedOverlap };
        }
      }

      selected = bestClearCandidate?.point ?? bestBlockedCandidate?.point ?? null;
      if (!selected) {
        placements.push(null);
        continue;
      }
    }

    placements.push(selected);
    placedRects.push(expandRect(toRect(selected, card), CARD_GAP));
  }

  return placements;
}
