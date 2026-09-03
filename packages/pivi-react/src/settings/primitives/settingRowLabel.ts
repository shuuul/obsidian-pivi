import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';

export interface SettingRowLabelContextValue {
  readonly nameId: string;
  readonly descriptionId?: string;
}

export const SettingRowLabelContext = createContext<SettingRowLabelContextValue | null>(null);

export function buildSettingRowLabelledBy(
  nameId: string,
  descriptionId?: string,
  existing?: string,
): string {
  return [nameId, descriptionId, existing].filter(Boolean).join(' ');
}

export function augmentSettingRowControl(
  node: ReactNode,
  context: SettingRowLabelContextValue,
): ReactNode {
  if (!isValidElement(node)) return node;
  const props = node.props as {
    readonly 'aria-label'?: string;
    readonly 'aria-labelledby'?: string;
    readonly children?: ReactNode;
    readonly label?: string;
  };
  if (props['aria-label'] || props.label) return node;

  const elementType = node.type;
  if (typeof elementType === 'string' && ['input', 'textarea', 'select'].includes(elementType)) {
    return cloneElement(node as ReactElement<Record<string, unknown>>, {
      'aria-labelledby': buildSettingRowLabelledBy(
        context.nameId,
        context.descriptionId,
        props['aria-labelledby'],
      ),
    });
  }

  if (props.children) {
    return cloneElement(
      node,
      {},
      Children.map(props.children, child => augmentSettingRowControl(child, context)),
    );
  }
  return node;
}
