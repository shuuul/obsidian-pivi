import type { CursorContext } from "../../shared/utils/editor";

export type InlineEditContext =
  | { mode: "selection"; selectedText: string }
  | { mode: "cursor"; cursorContext: CursorContext };

export type InlineEditDecision = "accept" | "edit" | "reject";