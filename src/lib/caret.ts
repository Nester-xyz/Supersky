/**
 * Pixel position of a caret index inside a <textarea>, relative to the
 * textarea's own top-left (border box), with its scroll already subtracted.
 *
 * Textareas expose no caret geometry, so we mirror the text into a hidden div
 * that copies every layout-affecting style, then measure a marker span placed
 * at the caret. This is the well-worn "textarea-caret-position" approach.
 */
export interface CaretCoordinates {
  top: number;
  left: number;
  /** Line height at the caret — add it to `top` to sit just under the line. */
  height: number;
}

// Styles that change where glyphs land and therefore must match the textarea.
const MIRRORED_PROPERTIES = [
  'boxSizing',
  'width',
  'borderLeftWidth',
  'borderRightWidth',
  'borderTopWidth',
  'borderBottomWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
] as const;

export function getCaretCoordinates(
  element: HTMLTextAreaElement,
  position: number,
): CaretCoordinates {
  const doc = element.ownerDocument;
  const computed = getComputedStyle(element);
  const mirror = doc.createElement('div');
  const style = mirror.style;

  style.position = 'absolute';
  style.top = '0';
  style.left = '-9999px';
  style.visibility = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.overflowWrap = 'break-word';
  for (const property of MIRRORED_PROPERTIES) {
    style[property] = computed[property];
  }

  mirror.textContent = element.value.slice(0, position);
  // A marker whose position is the caret's. Non-empty so it lays out on the line.
  const marker = doc.createElement('span');
  marker.textContent = element.value.slice(position) || '.';
  mirror.appendChild(marker);

  doc.body.appendChild(mirror);
  const borderTop = parseFloat(computed.borderTopWidth) || 0;
  const borderLeft = parseFloat(computed.borderLeftWidth) || 0;
  const lineHeight = parseFloat(computed.lineHeight) || marker.offsetHeight;
  const coordinates: CaretCoordinates = {
    top: marker.offsetTop + borderTop - element.scrollTop,
    left: marker.offsetLeft + borderLeft - element.scrollLeft,
    height: lineHeight,
  };
  doc.body.removeChild(mirror);
  return coordinates;
}
