import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';

import { ModalLayer } from '../../packages/pivi-react/src/shared/ModalLayer';

function TestDialog({
  initialFocus = 'cancel' as const,
}: {
  readonly initialFocus?: 'cancel' | 'first-field';
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>Open</button>
      <ModalLayer
        ariaLabel="Test dialog"
        initialFocus={initialFocus}
        open={open}
        onClose={() => setOpen(false)}
      >
        <div className="pivi-modal">
          <input className="pivi-settings-control" aria-label="Name" />
          <button type="button" data-modal-cancel onClick={() => setOpen(false)}>Cancel</button>
          <button className="pivi-button--danger" type="button">Delete</button>
        </div>
      </ModalLayer>
    </>
  );
}

function TestDisablingDialog() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <ModalLayer
        ariaLabel="Delete dialog"
        open={open}
        onClose={() => { if (!pending) setOpen(false); }}
      >
        <div className="pivi-modal">
          <button type="button" data-modal-cancel disabled={pending} onClick={() => setOpen(false)}>Cancel</button>
          <button className="pivi-button--danger" type="button" disabled={pending} onClick={() => setPending(true)}>Delete</button>
        </div>
      </ModalLayer>
    </>
  );
}

describe('ModalLayer', () => {
  it('focuses cancel by default and closes on Escape', () => {
    render(<TestDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('dialog', { name: 'Test dialog' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Test dialog' })).not.toBeInTheDocument();
  });

  it('focuses the first field when requested', () => {
    render(<TestDialog initialFocus="first-field" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  });

  it('wraps tab focus at the dialog boundaries', () => {
    render(<TestDialog initialFocus="first-field" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    const remove = screen.getByRole('button', { name: 'Delete' });
    remove.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(name).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(remove).toHaveFocus();
  });

  it('holds focus on the layer when all focusable elements become disabled', () => {
    render(<TestDisablingDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete dialog' });
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    // Both buttons are now disabled; Tab must keep focus within the layer.
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(dialog).toHaveFocus();
  });
});
