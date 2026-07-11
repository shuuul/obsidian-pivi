import { WidgetType } from "@codemirror/view";

export interface InlineEditDiffHost {
  getOwnerDocument(): Document;
  accept(): void;
  reject(): void;
}

export interface DiffOp {
  type: "equal" | "insert" | "delete";
  text: string;
}

function buildLcsMatrix(oldWords: string[], newWords: string[]): number[][] {
  const dp: number[][] = Array.from({ length: oldWords.length + 1 }, () =>
    Array<number>(newWords.length + 1).fill(0),
  );

  for (let i = 1; i <= oldWords.length; i++) {
    const row = dp[i];
    const previousRow = dp[i - 1];
    const oldWord = oldWords[i - 1];
    if (!row || !previousRow || oldWord === undefined) {
      throw new Error("Diff matrix construction invariant failed.");
    }
    for (let j = 1; j <= newWords.length; j++) {
      const newWord = newWords[j - 1];
      if (newWord === undefined) {
        throw new Error("Diff token invariant failed.");
      }
      row[j] = oldWord === newWord
        ? (previousRow[j - 1] ?? 0) + 1
        : Math.max(previousRow[j] ?? 0, row[j - 1] ?? 0);
    }
  }

  return dp;
}

function backtrackDiff(
  oldWords: string[],
  newWords: string[],
  dp: number[][],
): DiffOp[] {
  const reversed: DiffOp[] = [];
  let i = oldWords.length;
  let j = newWords.length;

  while (i > 0 || j > 0) {
    const oldWord = i > 0 ? oldWords[i - 1] : undefined;
    const newWord = j > 0 ? newWords[j - 1] : undefined;
    if (i > 0 && j > 0 && oldWord !== undefined && oldWord === newWord) {
      reversed.push({ type: "equal", text: oldWord });
      i--;
      j--;
    } else if (
      j > 0
      && newWord !== undefined
      && (i === 0 || (dp[i]?.[j - 1] ?? 0) >= (dp[i - 1]?.[j] ?? 0))
    ) {
      reversed.push({ type: "insert", text: newWord });
      j--;
    } else if (oldWord !== undefined) {
      reversed.push({ type: "delete", text: oldWord });
      i--;
    } else {
      throw new Error("Diff backtracking invariant failed.");
    }
  }

  return reversed.reverse();
}

function mergeAdjacentDiffOps(ops: DiffOp[]): DiffOp[] {
  const merged: DiffOp[] = [];
  for (const op of ops) {
    const previous = merged.at(-1);
    if (previous && previous.type === op.type) {
      previous.text += op.text;
    } else {
      merged.push({ ...op });
    }
  }
  return merged;
}

export function computeDiff(oldText: string, newText: string): DiffOp[] {
  const oldWords = oldText.split(/(\s+)/);
  const newWords = newText.split(/(\s+)/);
  return mergeAdjacentDiffOps(backtrackDiff(oldWords, newWords, buildLcsMatrix(oldWords, newWords)));
}

export function appendDiffOps(container: HTMLElement, ops: DiffOp[]): void {
  for (const op of ops) {
    switch (op.type) {
      case "delete":
        container.createSpan({ cls: "pivi-diff-del", text: op.text });
        break;
      case "insert":
        container.createSpan({ cls: "pivi-diff-ins", text: op.text });
        break;
      default:
        container.appendText(op.text);
    }
  }
}

export function diffOpsEqual(left: DiffOp[], right: DiffOp[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((op, index) => {
    const other = right[index];
    return other !== undefined && op.type === other.type && op.text === other.text;
  });
}

export class DiffWidget extends WidgetType {
  constructor(
    private diffOps: DiffOp[],
    private controller: InlineEditDiffHost,
  ) {
    super();
  }
  toDOM(): HTMLElement {
    const ownerDocument = this.controller.getOwnerDocument();
    const span = ownerDocument.createElement("span");
    span.className = "pivi-inline-diff-replace";
    appendDiffOps(span, this.diffOps);

    const btns = ownerDocument.createElement("span");
    btns.className = "pivi-inline-diff-buttons";

    const rejectBtn = ownerDocument.createElement("button");
    rejectBtn.className = "pivi-inline-diff-btn reject";
    rejectBtn.textContent = "✕";
    rejectBtn.title = "Reject (esc)";
    rejectBtn.onclick = () => this.controller.reject();

    const acceptBtn = ownerDocument.createElement("button");
    acceptBtn.className = "pivi-inline-diff-btn accept";
    acceptBtn.textContent = "✓";
    acceptBtn.title = "Accept (enter)";
    acceptBtn.onclick = () => this.controller.accept();

    btns.appendChild(rejectBtn);
    btns.appendChild(acceptBtn);
    span.appendChild(btns);

    return span;
  }
  eq(other: DiffWidget): boolean {
    return diffOpsEqual(this.diffOps, other.diffOps);
  }
  ignoreEvent(): boolean {
    return true;
  }
}