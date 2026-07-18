export interface ToolSpec {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(id: string, params: unknown, signal?: AbortSignal): Promise<unknown>;
  executionMode?: 'parallel' | 'sequential';
  metadata?: {
    mutatesVault?: boolean;
    displayKind?: 'read' | 'write' | 'edit' | 'search' | 'todo' | 'subagent' | 'mcp' | 'other';
  };
}
