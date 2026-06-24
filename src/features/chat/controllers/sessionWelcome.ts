export interface SessionGreetingOptions {
  userName?: string | null;
  now?: Date;
  random?: () => number;
}

/** Generates a dynamic greeting based on time/day. */
export function createSessionGreeting(options: SessionGreetingOptions = {}): string {
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;
  const hour = now.getHours();
  const day = now.getDay(); // 0 = Sunday, 6 = Saturday
  const name = options.userName?.trim();

  const personalize = (base: string, noNameFallback?: string): string =>
    name ? `${base}, ${name}` : (noNameFallback ?? base);

  const dayGreetings: Record<number, string[]> = {
    0: [personalize('Happy Sunday'), 'Sunday session?', 'Welcome to the weekend'],
    1: [personalize('Happy Monday'), personalize('Back at it', 'Back at it!')],
    2: [personalize('Happy Tuesday')],
    3: [personalize('Happy Wednesday')],
    4: [personalize('Happy Thursday')],
    5: [personalize('Happy Friday'), personalize('That Friday feeling')],
    6: [personalize('Happy Saturday', 'Happy Saturday!'), personalize('Welcome to the weekend')],
  };

  const getTimeGreetings = (): string[] => {
    if (hour >= 5 && hour < 12) {
      return [personalize('Good morning'), 'Coffee and Obsius time?'];
    } else if (hour >= 12 && hour < 18) {
      return [personalize('Good afternoon'), personalize('Hey there'), personalize("How's it going") + '?'];
    } else if (hour >= 18 && hour < 22) {
      return [personalize('Good evening'), personalize('Evening'), personalize('How was your day') + '?'];
    } else {
      return ['Hello, night owl', personalize('Evening')];
    }
  };

  const generalGreetings = [
    personalize('Hey there'),
    name ? `Hi ${name}, how are you?` : 'Hi, how are you?',
    personalize("How's it going") + '?',
    personalize('Welcome back') + '!',
    personalize("What's new") + '?',
    ...(name ? [`${name} returns!`] : []),
    'You are absolutely right!',
  ];

  const allGreetings = [
    ...(dayGreetings[day] || []),
    ...getTimeGreetings(),
    ...generalGreetings,
  ];

  return allGreetings[Math.floor(random() * allGreetings.length)];
}

export function setWelcomeVisibility(
  welcomeEl: HTMLElement | null,
  hasMessages: boolean,
): void {
  if (!welcomeEl) return;

  if (hasMessages) {
    welcomeEl.addClass('obsius2-hidden');
  } else {
    welcomeEl.removeClass('obsius2-hidden');
  }
}

export function ensureWelcomeGreeting(
  welcomeEl: HTMLElement | null,
  getGreeting: () => string,
): void {
  if (!welcomeEl) return;
  if (!welcomeEl.querySelector('.obsius2-welcome-greeting')) {
    welcomeEl.createDiv({ cls: 'obsius2-welcome-greeting', text: getGreeting() });
  }
}
