import { createPiReadBudget } from '../../../../packages/pivi-agent-core/src/engine/pi/piReadBudget';

describe('createPiReadBudget', () => {
  it('shares one synchronous allowance across sibling reads', () => {
    const budget = createPiReadBudget(() => 9_000);

    expect(budget.reserve().maxChars).toBe(9_000);
    expect(budget.reserve().maxChars).toBe(0);

    budget.reset();
    expect(budget.reserve(4_000).maxChars).toBe(4_000);
    expect(budget.reserve(6_000).maxChars).toBe(5_000);
  });

  it('never restores headroom when the live allowance shrinks', () => {
    let available = 10_000;
    const budget = createPiReadBudget(() => available);

    expect(budget.reserve(2_000).maxChars).toBe(2_000);
    available = 3_000;
    expect(budget.reserve(5_000).maxChars).toBe(3_000);
    expect(budget.reserve().maxChars).toBe(0);
  });

  it('refunds the unused reservation so a stats-only read does not starve the turn', () => {
    const budget = createPiReadBudget(() => 50_000);

    const statsRead = budget.reserve();
    expect(statsRead.maxChars).toBe(50_000);
    // A stats-only large-file response returns a few hundred chars, not the reservation.
    statsRead.settle(250);

    const rangeRead = budget.reserve(20_000);
    expect(rangeRead.maxChars).toBe(20_000);
    rangeRead.settle(20_000);

    expect(budget.reserve().maxChars).toBe(29_750);
  });

  it('settles at most once and never refunds into a later turn', () => {
    const budget = createPiReadBudget(() => 1_000);

    const reservation = budget.reserve(1_000);
    reservation.settle(0);
    reservation.settle(0);
    expect(budget.reserve().maxChars).toBe(1_000);

    budget.reset();
    const turnOne = budget.reserve(1_000);
    budget.reset();
    budget.reserve(1_000);
    turnOne.settle(0);
    expect(budget.reserve().maxChars).toBe(0);
  });
});
