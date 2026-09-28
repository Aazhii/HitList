/**
 * Pixel position of a caret inside a text input or textarea, for anchoring a
 * floating menu (the "@" mention menu, the slash menu) at the caret rather
 * than at the element's corner.
 *
 * Works by mirroring the field's text into an identically-styled hidden div
 * and reading back where a marker span at the caret position landed — the one
 * reliable way to do this, since neither element exposes a caret rect itself.
 */
export function getCaretCoordinates(
  el: HTMLInputElement | HTMLTextAreaElement,
  position: number,
): { top: number; left: number } {
  const mirror = document.createElement('div');
  const style = window.getComputedStyle(el);

  const props = [
    'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
    'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform',
    'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing',
    'tabSize', 'MozTabSize',
  ] as const;

  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'anywhere';

  props.forEach((prop) => {
    (mirror.style as unknown as Record<string, string>)[prop] = style[prop as keyof CSSStyleDeclaration] as string;
  });

  document.body.appendChild(mirror);
  const textBefore = el.value.substring(0, position);
  mirror.textContent = textBefore;
  const span = document.createElement('span');
  span.textContent = el.value.substring(position) || '.';
  mirror.appendChild(span);

  const elRect = el.getBoundingClientRect();
  const spanRect = span.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  document.body.removeChild(mirror);

  return {
    top: elRect.top + (spanRect.top - mirrorRect.top),
    left: elRect.left + (spanRect.left - mirrorRect.left),
  };
}
