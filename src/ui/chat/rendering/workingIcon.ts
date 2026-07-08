/** Lightweight running indicator (CSS/SVG only, no deps). */
export const WORKING_ICON_CLASS = 'pivi-working-icon';
export const CONSTRUCTION_WORKING_ICON_CLASS = 'pivi-working-icon--construction';

let constructionPatternId = 0;

function nextConstructionPatternId(): string {
  constructionPatternId = (constructionPatternId + 1) % Number.MAX_SAFE_INTEGER;
  return `pivi-working-construction-stripes-${constructionPatternId}`;
}

export function appendWorkingIcon(el: HTMLElement): void {
  el.empty();
  el.addClass(WORKING_ICON_CLASS);
  el.removeClass(CONSTRUCTION_WORKING_ICON_CLASS);
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
    + '<circle class="pivi-working-icon-track" cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" opacity="0.25"/>'
    + '<path class="pivi-working-icon-arc" d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
    + '</svg>';
}

export function appendConstructionWorkingIcon(el: HTMLElement): void {
  const stripesId = nextConstructionPatternId();
  el.empty();
  el.addClass(WORKING_ICON_CLASS);
  el.addClass(CONSTRUCTION_WORKING_ICON_CLASS);
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML =
    '<svg class="pivi-working-construction-svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
    + '<defs>'
    + `<pattern id="${stripesId}" class="pivi-working-construction-pattern" width="6" height="14" patternUnits="userSpaceOnUse">`
    + '<path class="pivi-working-construction-stripe" d="M-4 -2 L14 30" stroke="currentColor" stroke-width="2"/>'
    + '</pattern>'
    + '</defs>'
    + `<rect fill="url(#${stripesId})" height="8" rx="1" width="20" x="2" y="6"/>`
    + '<path d="M17 14v7"/>'
    + '<path d="M7 14v7"/>'
    + '<path d="M17 3v3"/>'
    + '<path d="M7 3v3"/>'
    + '</svg>';
}

export function clearWorkingIcon(el: HTMLElement): void {
  el.removeClass(WORKING_ICON_CLASS);
  el.removeClass(CONSTRUCTION_WORKING_ICON_CLASS);
}
