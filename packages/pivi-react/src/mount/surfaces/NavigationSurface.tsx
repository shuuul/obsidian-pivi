import { useT } from '../../i18n';
import { PlatformIcon } from '../../icons';
import type { ChatSurfaceActions } from '../types';

export function NavigationSurface({ visible, autoScrollEnabled, actions }: {
  visible: boolean;
  autoScrollEnabled: boolean;
  actions: ChatSurfaceActions;
}) {
  const t = useT();
  return (
    <div className={`pivi-nav-sidebar${visible ? ' visible' : ''}`}>
      <button aria-label={t('chat.nav.scrollToTop')} className="pivi-nav-btn pivi-nav-btn-top" onClick={actions.scrollToTop} type="button"><PlatformIcon name="chevrons-up" /></button>
      <button aria-label={t('chat.nav.previousMessage')} className="pivi-nav-btn pivi-nav-btn-prev" onClick={actions.scrollToPreviousUserMessage} type="button"><PlatformIcon name="chevron-up" /></button>
      <button aria-label={t('chat.nav.nextMessage')} className="pivi-nav-btn pivi-nav-btn-next" onClick={actions.scrollToNextUserMessage} type="button"><PlatformIcon name="chevron-down" /></button>
      <button aria-label={t('chat.nav.scrollToBottom')} className="pivi-nav-btn pivi-nav-btn-bottom" onClick={actions.scrollToBottom} type="button"><PlatformIcon name="chevrons-down" /></button>
      {!autoScrollEnabled ? <button aria-label={t('chat.nav.resumeAutoScroll')} className="pivi-nav-btn pivi-nav-btn-resume" onClick={actions.resumeAutoScroll} type="button"><PlatformIcon name="radio" /></button> : null}
    </div>
  );
}
