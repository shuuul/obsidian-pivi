import { act, fireEvent, render, screen } from '@testing-library/react';
import { type ReactElement, type ReactNode, useState } from 'react';

import { createI18n, I18nProvider } from '@pivi/pivi-react';

import { useSortableReorder } from '../../../packages/pivi-react/src/reorder/useSortableReorder';
import { DisclosureCard } from '../../../packages/pivi-react/src/settings/primitives/DisclosureCard';
import { SettingRow } from '../../../packages/pivi-react/src/settings/primitives/SettingRow';
import { SettingsCollection } from '../../../packages/pivi-react/src/settings/primitives/SettingsCollection';
import { SettingsInlineActions } from '../../../packages/pivi-react/src/settings/primitives/SettingsInlineActions';
import { SettingsSection } from '../../../packages/pivi-react/src/settings/primitives/SettingsSection';
import {
  SettingsRemoveButton,
  Toggle,
} from '../../../packages/pivi-react/src/settings/primitives/controls';
import { withTestPresentationPlatform } from '../../helpers/presentationPlatform';

function renderPrimitives(ui: ReactElement) {
  return render(withTestPresentationPlatform(<I18nProvider i18n={createI18n()}>{ui}</I18nProvider>));
}

function ControlledCard({
  actions,
}: {
  readonly actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DisclosureCard
      name="Example card"
      open={open}
      onToggle={() => { setOpen(current => !current); }}
      actions={actions}
    >
      Card body
    </DisclosureCard>
  );
}

/** jsdom does not synthesize the click a UA fires for Enter/Space on `<button>`. */
function activateButtonWithKey(element: HTMLElement, key: 'Enter' | ' ') {
  fireEvent.keyDown(element, { key });
  if (key === ' ') fireEvent.keyUp(element, { key });
  fireEvent.click(element);
}

function pointerEvent(type: string, clientY: number): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    pointerId: { value: 1 },
    clientY: { value: clientY },
  });
  return event;
}

function mockCardRects(cards: readonly HTMLElement[]): void {
  for (const card of cards) {
    card.getBoundingClientRect = jest.fn(() => {
      const index = Array.from(card.parentElement?.children ?? []).indexOf(card);
      const match = /translateY\((-?[\d.]+)px\)/.exec(card.style.transform);
      const dragOffset = match ? Number.parseFloat(match[1] ?? '0') : 0;
      const top = index * 100 + dragOffset;
      return { top, bottom: top + 80, height: 80, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) };
    });
  }
}

function SortableSurfaceHarness() {
  const [order, setOrder] = useState(['alpha', 'beta']);
  const sortable = useSortableReorder<string, HTMLElement>({
    order,
    disabled: false,
    itemSelector: '.hook-item',
    itemDataKey: 'settingsSortId',
    setOrder,
    commitOrder: async (next) => {
      setOrder(next);
      return true;
    },
    positionAnnouncement: (id, position) => `Reorder ${id}, currently position ${position}`,
    savedAnnouncement: 'Saved',
    cancelledAnnouncement: 'Cancelled',
    failedAnnouncement: 'Failed',
  });
  return (
    <div ref={sortable.listRef}>
      {order.map((id) => (
        <div
          key={id}
          className="hook-item"
          data-settings-sort-id={id}
          {...sortable.getHandleProps(id)}
        >
          <button type="button" data-sortable-surface="" data-testid={`surface-${id}`}>
            {`surface ${id}`}
          </button>
          <button type="button" data-testid={`blocked-${id}`}>
            {`blocked ${id}`}
          </button>
        </div>
      ))}
    </div>
  );
}

function SortableCards() {
  const [order, setOrder] = useState(['alpha', 'beta']);
  const [openId, setOpenId] = useState<string | null>(null);
  const sortable = useSortableReorder<string, HTMLElement>({
    order,
    disabled: false,
    itemSelector: '.pivi-settings-card',
    itemDataKey: 'settingsSortId',
    setOrder,
    commitOrder: async (next) => {
      setOrder(next);
      return true;
    },
    positionAnnouncement: (id, position) => `Reorder ${id}, currently position ${position}`,
    savedAnnouncement: 'Saved',
    cancelledAnnouncement: 'Cancelled',
    failedAnnouncement: 'Failed',
  });

  return (
    <SettingsCollection listRef={sortable.listRef} announcement={sortable.announcement}>
      {order.map((id, index) => (
        <DisclosureCard
          key={id}
          sortId={id}
          name={id}
          open={openId === id}
          onToggle={() => { setOpenId(current => current === id ? null : id); }}
          sortableHandleProps={sortable.getHandleProps(id)}
          consumeClickAfterDrag={() => sortable.consumeClickAfterDrag(id)}
          dragging={sortable.draggingId === id}
          dragOffset={sortable.draggingId === id ? sortable.dragOffset : 0}
          reorderLabel={`Reorder ${id}, currently position ${index + 1}`}
          actions={<SettingsRemoveButton ariaLabel={`Remove ${id}`} onClick={() => undefined} />}
        >
          Body {id}
        </DisclosureCard>
      ))}
    </SettingsCollection>
  );
}

describe('Settings primitives', () => {
  it('does not toggle DisclosureCard when the enable toggle or remove button is clicked', () => {
    const onToggle = jest.fn();
    renderPrimitives(
      <DisclosureCard
        name="Example card"
        open={false}
        onToggle={onToggle}
        actions={(
          <>
            <Toggle checked={false} label="Enable example" onChange={() => undefined} />
            <SettingsRemoveButton ariaLabel="Remove example" onClick={() => undefined} />
          </>
        )}
      >
        Card body
      </DisclosureCard>,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable example' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove example' }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.queryByText('Card body')).not.toBeInTheDocument();

    const header = document.querySelector('.pivi-settings-card__header');
    expect(header).not.toBeNull();
    expect(header?.getAttribute('role')).toBeNull();
    expect(header?.querySelectorAll('button button, [role=button] button')).toHaveLength(0);
  });

  it('toggles DisclosureCard from the toggle button, including Enter and Space', () => {
    renderPrimitives(<ControlledCard />);
    const toggle = screen.getByRole('button', { name: /Example card/ });
    const header = toggle.closest('.pivi-settings-card__header');
    expect(header).not.toBeNull();
    expect(header?.getAttribute('role')).toBeNull();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls');
    expect(header?.querySelectorAll('button button, [role=button] button')).toHaveLength(0);

    fireEvent.click(toggle);
    expect(screen.getByText('Card body')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).toHaveTextContent('Card body');

    activateButtonWithKey(toggle, 'Enter');
    expect(screen.queryByText('Card body')).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    activateButtonWithKey(toggle, ' ');
    expect(screen.getByText('Card body')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('reorders DisclosureCards from the drag handle keyboard path', async () => {
    renderPrimitives(<SortableCards />);
    const handle = screen.getByRole('button', { name: /Reorder alpha/ });

    fireEvent.keyDown(handle, { key: 'Enter' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: 'Enter' });
    await act(async () => undefined);

    const cards = document.querySelectorAll('.pivi-settings-card');
    expect(cards[0]).toHaveAttribute('data-settings-sort-id', 'beta');
    expect(cards[1]).toHaveAttribute('data-settings-sort-id', 'alpha');
    expect(screen.getByRole('button', { name: /Reorder alpha, currently position 2/ })).toBeInTheDocument();
  });

  it('reorders DisclosureCards from a pointer drag that starts on the toggle button', async () => {
    const { container } = renderPrimitives(<SortableCards />);
    const toggle = screen.getByRole('button', { name: 'alpha' });
    const header = toggle.closest('.pivi-settings-card__header') as HTMLElement;
    mockCardRects(Array.from(container.querySelectorAll<HTMLElement>('.pivi-settings-card')));
    header.setPointerCapture = jest.fn();
    header.releasePointerCapture = jest.fn();
    header.hasPointerCapture = jest.fn(() => true);

    fireEvent(toggle, pointerEvent('pointerdown', 10));
    for (const clientY of [20, 60, 100, 150, 190, 250, 350]) {
      fireEvent(header, pointerEvent('pointermove', clientY));
    }
    fireEvent(header, pointerEvent('pointerup', 250));
    await act(async () => undefined);

    const cards = document.querySelectorAll('.pivi-settings-card');
    expect(cards[0]).toHaveAttribute('data-settings-sort-id', 'beta');
    expect(cards[1]).toHaveAttribute('data-settings-sort-id', 'alpha');
  });

  it('does not start a pointer drag from inline action buttons', async () => {
    const { container } = renderPrimitives(<SortableCards />);
    const remove = screen.getByRole('button', { name: 'Remove alpha' });
    const header = document.querySelector('.pivi-settings-card__header') as HTMLElement;
    mockCardRects(Array.from(container.querySelectorAll<HTMLElement>('.pivi-settings-card')));
    header.setPointerCapture = jest.fn();
    header.releasePointerCapture = jest.fn();
    header.hasPointerCapture = jest.fn(() => true);

    fireEvent(remove, pointerEvent('pointerdown', 10));
    for (const clientY of [20, 60, 100, 150, 190, 250, 350]) {
      fireEvent(header, pointerEvent('pointermove', clientY));
    }
    fireEvent(header, pointerEvent('pointerup', 250));
    await act(async () => undefined);

    const cards = document.querySelectorAll('.pivi-settings-card');
    expect(cards[0]).toHaveAttribute('data-settings-sort-id', 'alpha');
    expect(cards[1]).toHaveAttribute('data-settings-sort-id', 'beta');
  });

  it('lets data-sortable-surface opt a nested button into pointer drag', async () => {
    const { container } = renderPrimitives(<SortableSurfaceHarness />);
    const items = () => Array.from(container.querySelectorAll<HTMLElement>('.hook-item'));
    const prepare = (): void => {
      mockCardRects(items());
      for (const item of items()) {
        item.setPointerCapture = jest.fn();
        item.releasePointerCapture = jest.fn();
        item.hasPointerCapture = jest.fn(() => true);
      }
    };

    prepare();
    const blocked = screen.getByTestId('blocked-alpha');
    fireEvent(blocked, pointerEvent('pointerdown', 10));
    fireEvent(blocked.closest('.hook-item') as HTMLElement, pointerEvent('pointermove', 250));
    fireEvent(blocked.closest('.hook-item') as HTMLElement, pointerEvent('pointerup', 250));
    await act(async () => undefined);
    expect(items()[0]).toHaveAttribute('data-settings-sort-id', 'alpha');

    prepare();
    const surface = screen.getByTestId('surface-alpha');
    const surfaceItem = surface.closest('.hook-item') as HTMLElement;
    fireEvent(surface, pointerEvent('pointerdown', 10));
    for (const clientY of [20, 60, 100, 150, 190, 250, 350]) {
      fireEvent(surfaceItem, pointerEvent('pointermove', clientY));
    }
    fireEvent(surfaceItem, pointerEvent('pointerup', 250));
    await act(async () => undefined);
    expect(items()[0]).toHaveAttribute('data-settings-sort-id', 'beta');
    expect(items()[1]).toHaveAttribute('data-settings-sort-id', 'alpha');
  });

  it('renders SettingsCollection empty state, add trigger, and flat rows with actions', () => {
    const onAdd = jest.fn();
    const { rerender } = renderPrimitives(
      <SettingsCollection emptyState="Nothing here" addLabel="+ Add item" onAdd={onAdd} />,
    );

    expect(screen.getByText('Nothing here')).toHaveClass('pivi-settings-collection__empty');
    fireEvent.click(screen.getByRole('button', { name: '+ Add item' }));
    expect(onAdd).toHaveBeenCalledTimes(1);

    rerender(withTestPresentationPlatform(
      <I18nProvider i18n={createI18n()}>
        <SettingsCollection addLabel="+ Add item" onAdd={onAdd}>
          <SettingRow
            name="Installed skill"
            description="vault/skills/example"
            actions={(
              <SettingsInlineActions>
                <SettingsRemoveButton ariaLabel="Remove skill" onClick={() => undefined} />
              </SettingsInlineActions>
            )}
          />
        </SettingsCollection>
      </I18nProvider>,
    ));

    expect(screen.queryByText('Nothing here')).not.toBeInTheDocument();
    const row = screen.getByText('Installed skill').closest('.pivi-settings-row');
    expect(row).not.toBeNull();
    expect(row?.querySelector('.pivi-settings-row__actions')).toContainElement(
      screen.getByRole('button', { name: 'Remove skill' }),
    );
  });

  it('marks SettingRow stacked and wires aria-labelledby onto native controls', () => {
    renderPrimitives(
      <SettingRow stacked name="Notes" description="Write a note">
        <textarea />
      </SettingRow>,
    );

    const row = screen.getByText('Notes').closest('.pivi-settings-row');
    expect(row).toHaveClass('pivi-settings-row--stacked');
    const name = screen.getByText('Notes');
    const description = screen.getByText('Write a note');
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('aria-labelledby', expect.stringContaining(name.id));
    expect(textarea.getAttribute('aria-labelledby')).toContain(description.id);
  });

  it('nests SettingsSection without a surface inside a section or disclosure body', () => {
    renderPrimitives(
      <SettingsSection title="Outer">
        <SettingsSection title="Inner from section">
          <SettingRow name="Nested row" />
        </SettingsSection>
      </SettingsSection>,
    );
    const outer = screen.getByRole('heading', { name: 'Outer' }).closest('.pivi-settings-section');
    const inner = screen.getByRole('heading', { name: 'Inner from section' }).closest('.pivi-settings-section');
    expect(outer).not.toHaveClass('pivi-settings-section--nested');
    expect(inner).toHaveClass('pivi-settings-section--nested');

    renderPrimitives(
      <DisclosureCard name="Card" open onToggle={() => undefined}>
        <SettingsSection title="Inner from card">
          <SettingRow name="Card row" />
        </SettingsSection>
      </DisclosureCard>,
    );
    expect(screen.getByRole('heading', { name: 'Inner from card' }).closest('.pivi-settings-section'))
      .toHaveClass('pivi-settings-section--nested');
  });

  it('omits the SettingsSection heading when title is absent', () => {
    renderPrimitives(
      <SettingsSection>
        <SettingRow name="Only row" />
      </SettingsSection>,
    );
    expect(document.querySelector('.pivi-settings-section__header')).toBeNull();
    expect(document.querySelector('.pivi-settings-section-heading')).toBeNull();
    expect(screen.getByText('Only row').closest('.pivi-settings-section__body')).not.toBeNull();
  });

  it('places DisclosureCard actions before the trailing chevron', () => {
    renderPrimitives(
      <DisclosureCard
        name="Ordered card"
        open={false}
        onToggle={() => undefined}
        actions={<SettingsRemoveButton ariaLabel="Remove ordered" onClick={() => undefined} />}
      />,
    );
    const header = document.querySelector('.pivi-settings-card__header');
    expect(header).not.toBeNull();
    const children = Array.from(header?.children ?? []).map(child => child.className);
    expect(children[0]).toContain('pivi-settings-card__toggle');
    expect(children[1]).toContain('pivi-settings-actions');
    expect(children[2]).toContain('pivi-settings-card__chevron');
    expect(header?.querySelector('.pivi-settings-card__toggle .pivi-settings-card__chevron')).toBeNull();
  });

  it('renders SettingsSection actions on the heading row', () => {
    renderPrimitives(
      <SettingsSection
        title="Modules"
        headingId="modules-heading"
        actions={<button type="button">Refresh</button>}
      >
        <SettingRow name="One">off</SettingRow>
      </SettingsSection>,
    );

    const header = screen.getByRole('heading', { name: 'Modules' }).closest('.pivi-settings-section__header');
    expect(header).toContainElement(screen.getByRole('button', { name: 'Refresh' }));
    expect(header).toContainElement(screen.getByRole('heading', { name: 'Modules' }));
  });
});
