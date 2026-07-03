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

export function computeDiff(oldText: string, newText: string): DiffOp[] {
  const oldWords = oldText.split(/(\s+)/);
  const newWords = newText.split(/(\s+)/);
  const m = oldWords.length,
    n = newWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array<number>(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldWords[i - 1] === newWords[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = m,
    j = n;
  const temp: DiffOp[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      temp.push({ type: "equal", text: oldWords[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      temp.push({ type: "insert", text: newWords[j - 1] });
      j--;
    } else {
      temp.push({ type: "delete", text: oldWords[i - 1] });
      i--;
    }
  }

  temp.reverse();
  for (const op of temp) {
    if (ops.length > 0 && ops[ops.length - 1].type === op.type) {
      ops[ops.length - 1].text += op.text;
    } else {
      ops.push({ ...op });
    }
  }
  return ops;
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
    return op.type === other.type && op.text === other.text;
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