import { createPiReadBudget } from '../../../../packages/pivi-agent-core/src/engine/pi/piReadBudget';

describe('createPiReadBudget', () => {
  it('shares one synchronous allowance across sibling reads', () => {
    const budget = createPiReadBudget(() => 9_000);

    expect(budget.reserve()).toBe(9_000);
    expect(budget.reserve()).toBe(0);

    budget.reset();
    expect(budget.reserve(4_000)).toBe(4_000);
    expect(budget.reserve(6_000)).toBe(5_000);
  });

  it('never restores headroom when the live allowance shrinks', () => {
    let available = 10_000;
    const budget = createPiReadBudget(() => available);

    expect(budget.reserve(2_000)).toBe(2_000);
    available = 3_000;
    expect(budget.reserve(5_000)).toBe(3_000);
    expect(budget.reserve()).toBe(0);
  });
});
