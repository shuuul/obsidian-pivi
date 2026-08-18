import { TurnGenerationClock } from '@/ui/chat/composer/TurnGenerationClock';

describe('TurnGenerationClock', () => {
  it('sums output tokens and pauses elapsed during tool time', () => {
    const clock = new TurnGenerationClock();

    clock.start(1_000);
    clock.addOutputTokens(40);
    clock.pause(1_500);
    clock.start(3_000);
    clock.addOutputTokens(50);
    clock.pause(3_400);

    expect(clock.snapshot()).toEqual({
      outputTokens: 90,
      generationElapsedMs: 900,
    });
  });

  it('includes the open generation interval in snapshot when still running', () => {
    const clock = new TurnGenerationClock();
    clock.start(1_000);
    clock.addOutputTokens(20);

    expect(clock.snapshot(1_250)).toEqual({
      outputTokens: 20,
      generationElapsedMs: 250,
    });
  });

  it('resets tokens, elapsed, and the open interval', () => {
    const clock = new TurnGenerationClock();
    clock.start(1_000);
    clock.addOutputTokens(12);
    clock.pause(1_200);
    clock.reset();

    expect(clock.snapshot(2_000)).toEqual({
      outputTokens: 0,
      generationElapsedMs: 0,
    });
  });
});
