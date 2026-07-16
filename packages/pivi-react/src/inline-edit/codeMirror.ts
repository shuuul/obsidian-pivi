import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';

import type { InlineEditMountOptions, MountedInlineEdit } from './mount';
import { mountInlineEdit } from './mount';

export type InlineEditWidgetOptions = Omit<InlineEditMountOptions, 'container'> & {
  createContainer(): HTMLElement;
};

export const showInlineEditWidget = StateEffect.define<{
  pos: number;
  block: boolean;
  options: InlineEditWidgetOptions;
}>();
export const hideInlineEditWidget = StateEffect.define<null>();

class ReactInlineEditWidget extends WidgetType {
  private mounted: MountedInlineEdit | null = null;
  constructor(private readonly options: InlineEditWidgetOptions) { super(); }
  toDOM(): HTMLElement {
    const container = this.options.createContainer();
    container.className = 'pivi-inline-react-root';
    this.mounted = mountInlineEdit({ ...this.options, container });
    return container;
  }
  destroy(): void { this.mounted?.dispose(); this.mounted = null; }
  ignoreEvent(): boolean { return false; }
}

export const inlineEditWidgetField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(showInlineEditWidget)) {
        next = Decoration.set([
          Decoration.widget({
            widget: new ReactInlineEditWidget(effect.value.options),
            block: effect.value.block,
            side: effect.value.block ? -1 : 1,
          }).range(effect.value.pos),
        ]);
      } else if (effect.is(hideInlineEditWidget)) {
        next = Decoration.none;
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const installedEditors = new WeakSet<EditorView>();

export function installInlineEditWidgetExtension(view: EditorView): void {
  if (installedEditors.has(view)) return;
  view.dispatch({ effects: StateEffect.appendConfig.of(inlineEditWidgetField) });
  installedEditors.add(view);
}
