export type WorkspaceKind =
  | 'obsidian-vault'
  | 'cli-project'
  | 'vscode-workspace'
  | 'desktop-workspace'
  | 'server-tenant'
  | (string & {});

export interface WorkspaceContext {
  id: string;
  name: string;
  kind: WorkspaceKind;
  rootUri?: string;
  piviDir?: string;
}
