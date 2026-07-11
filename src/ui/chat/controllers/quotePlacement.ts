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
  return placed.reduce(
    (total, rect) => total + intersectionArea(candidate, expandRect(rect, CARD_GAP)),
    0,
  );
}

export function computeQuotePlacements(input: QuotePlacementInput): readonly QuotePoint[] {
  const placements: QuotePoint[] = [];
  const placedRects: QuoteRect[] = [];
  const blocked = input.blocked ? expandRect(input.blocked, BLOCKED_CLEARANCE) : null;

  for (const card of input.cards) {
    const bounds = getBounds(input.container, card);
    let selected: QuotePoint | null = null;

    for (let attempt = 0; attempt < RANDOM_ATTEMPTS; attempt++) {
      const candidate = {
        left: bounds.left + input.random() * bounds.width,
        top: bounds.top + input.random() * bounds.height,
      };
      const candidateRect = toRect(candidate, card);
      const overlapsBlocked = blocked && intersectionArea(candidateRect, blocked) > 0;
      const overlapsPlaced = placedRects.some(
        rect => intersectionArea(candidateRect, expandRect(rect, CARD_GAP)) > 0,
      );
      if (!overlapsBlocked && !overlapsPlaced) {
        selected = candidate;
        break;
      }
    }

    if (!selected) {
      const candidates = getPeripheralAnchors(bounds).map(point => clampPoint(point, bounds));
      const scored = candidates.map(point => {
        const rect = toRect(point, card);
        return {
          point,
          blockedOverlap: blocked ? intersectionArea(rect, blocked) : 0,
          placedOverlap: placedOverlapArea(rect, placedRects),
        };
      });
      const clearCandidates = scored.filter(candidate => candidate.blockedOverlap === 0);
      const pool = clearCandidates.length > 0 ? clearCandidates : scored;
      pool.sort((first, second) =>
        clearCandidates.length > 0
          ? first.placedOverlap - second.placedOverlap
          : first.blockedOverlap - second.blockedOverlap ||
            first.placedOverlap - second.placedOverlap,
      );
      selected = pool[0].point;
    }

    placements.push(selected);
    placedRects.push(toRect(selected, card));
  }

  return placements;
}
