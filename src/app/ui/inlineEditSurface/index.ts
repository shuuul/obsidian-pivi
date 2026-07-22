export { extractInlineEditContextFiles } from './extractInlineEditContextFiles';
export {
  hasInlineEditDiffReviewDecoration,
  hasInlineEditDiffReviewReplaceDecoration,
  hideInlineEditDiffReviewDecoration,
  InlineEditDiffReviewWidget,
  showInlineEditDiffReviewDecoration,
} from './inlineEditDiffReviewField';
export {
  createInlineEditSurfaceRoot,
  getInlineEditSurfaceAnchorPos,
  hideInlineEditSurfaceDecoration,
  INLINE_EDIT_SURFACE_ROOT_CLASS,
  InlineEditSurfaceWidget,
  resolveInlineEditAnchorPos,
  showInlineEditSurfaceDecoration,
} from './inlineEditSurfaceField';
export { InlineEditSurfaceSession, type InlineEditSurfaceSessionDeps } from './InlineEditSurfaceSession';
export type {
  InlineEditDiffReviewKind,
  InlineEditSurfaceComposerState,
  InlineEditSurfaceSendPayload,
  InlineEditSurfaceSessionContract,
  InlineEditSurfaceSessionOptions,
} from './types';
