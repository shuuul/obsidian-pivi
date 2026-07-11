import { t } from '@/i18n';

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
  const userName = options.userName?.trim();
  // Suffix pattern: ", Alice" or empty — locale strings embed {name} after the phrase.
  const name = userName ? `, ${userName}` : '';

  const dayGreetings: Record<number, string[]> = {
    0: [
      t('chat.welcome.happySunday', { name }),
      t('chat.welcome.sundaySession'),
      // Sunday pool originally omitted personalization for this entry.
      t('chat.welcome.welcomeWeekend', { name: '' }),
    ],
    1: [
      t('chat.welcome.happyMonday', { name }),
      userName ? t('chat.welcome.backAtIt', { name }) : t('chat.welcome.backAtItBang'),
    ],
    2: [t('chat.welcome.happyTuesday', { name })],
    3: [t('chat.welcome.happyWednesday', { name })],
    4: [t('chat.welcome.happyThursday', { name })],
    5: [
      t('chat.welcome.happyFriday', { name }),
      t('chat.welcome.fridayFeeling', { name }),
    ],
    6: [
      userName ? t('chat.welcome.happySaturday', { name }) : t('chat.welcome.happySaturdayBang'),
      t('chat.welcome.welcomeWeekend', { name }),
    ],
  };

  const getTimeGreetings = (): string[] => {
    if (hour >= 5 && hour < 12) {
      return [t('chat.welcome.goodMorning', { name }), t('chat.welcome.coffeePivi')];
    } else if (hour >= 12 && hour < 18) {
      return [
        t('chat.welcome.goodAfternoon', { name }),
        t('chat.welcome.heyThere', { name }),
        t('chat.welcome.howsItGoing', { name }),
      ];
    } else if (hour >= 18 && hour < 22) {
      return [
        t('chat.welcome.goodEvening', { name }),
        t('chat.welcome.evening', { name }),
        t('chat.welcome.howWasYourDay', { name }),
      ];
    } else {
      return [t('chat.welcome.nightOwl'), t('chat.welcome.evening', { name })];
    }
  };

  const generalGreetings = [
    t('chat.welcome.heyThere', { name }),
    userName ? t('chat.welcome.hiHowAreYou', { name }) : t('chat.welcome.hiHowAreYouNoName'),
    t('chat.welcome.howsItGoing', { name }),
    t('chat.welcome.welcomeBack', { name }),
    t('chat.welcome.whatsNew', { name }),
    ...(userName ? [t('chat.welcome.nameReturns', { userName })] : []),
    t('chat.welcome.absolutelyRight'),
  ];

  const allGreetings = [
    ...(dayGreetings[day] || []),
    ...getTimeGreetings(),
    ...generalGreetings,
  ];

  return allGreetings[Math.floor(random() * allGreetings.length)] ?? generalGreetings[0] ?? '';
}

export function setWelcomeVisibility(
  welcomeEl: HTMLElement | null,
  hasMessages: boolean,
): void {
  if (!welcomeEl) return;

  if (hasMessages) {
    welcomeEl.addClass('pivi-hidden');
  } else {
    welcomeEl.removeClass('pivi-hidden');
  }
}

export function ensureWelcomeGreeting(
  welcomeEl: HTMLElement | null,
  getGreeting: () => string,
): void {
  if (!welcomeEl) return;
  if (!welcomeEl.querySelector('.pivi-welcome-greeting')) {
    welcomeEl.createDiv({ cls: 'pivi-welcome-greeting', text: getGreeting() });
  }
}
