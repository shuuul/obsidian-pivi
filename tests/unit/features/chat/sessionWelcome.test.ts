import { createSessionGreeting } from '@/ui/chat/controllers/sessionWelcome';


describe('sessionWelcome', () => {
  it('creates deterministic personalized greetings', () => {
    const greeting = createSessionGreeting({
      userName: 'Ada',
      now: new Date('2026-06-22T09:00:00'),
      random: () => 0,
    });

    expect(greeting).toBe('Happy Monday, Ada');
  });

  it('uses no-name fallbacks without dangling punctuation', () => {
    const greeting = createSessionGreeting({
      userName: '   ',
      now: new Date('2026-06-22T09:00:00'),
      random: () => 0.1,
    });

    expect(greeting).toBe('Back at it!');
  });

});
