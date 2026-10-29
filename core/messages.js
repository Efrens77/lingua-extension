// Message names shared between the side panel and the content script.
// (content/content.js repeats these strings because it can't import modules.)
export const MSG = {
  SELECTION: "lingua/selection-changed",
  GET_SELECTION: "lingua/get-selection",
  GET_PAGE_TEXT: "lingua/get-page-text",
  GET_PAGE_SEGMENTS: "lingua/get-page-segments",
  APPLY_PAGE_TRANSLATION: "lingua/apply-page-translation",
  RESTORE_PAGE_TEXT: "lingua/restore-page-text",
  TRANSLATE_PAGE: "lingua/translate-page",
  RESTORE_PAGE: "lingua/restore-page",
  GET_PAGE_STATE: "lingua/get-page-state",
  PAGE_PROGRESS: "lingua/page-progress",
  PAGE_STATE: "lingua/page-state",
  PAGE_ERROR: "lingua/page-error",
};
