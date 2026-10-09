// Attach as onKeyDown on a form (or a plain div wrapping a set of fields, like the
// "Edit All" panels) to make Enter advance to the next field instead of submitting —
// these are long multi-field forms where an accidental Enter-submit mid-entry is a
// real risk, and there's usually no reason to wait for a mouse/tap to move on.
//
// Checkboxes and radios are skipped entirely (both as an Enter source and as a next-
// field target): they're meant to be clicked/tapped, and naively treating every radio
// input in a same-name group as its own stop would fight the browser's native roving-
// tabindex behavior for radio groups. Textareas keep Enter as a literal newline.
const SKIP_SELECTOR = 'input[type="checkbox"], input[type="radio"], input[type="submit"], input[type="button"], input[type="file"], button';

export function focusNextOnEnter(e) {
  if (e.key !== "Enter" || e.shiftKey) return;
  const target = e.target;
  if (target.tagName === "TEXTAREA") return;
  if (target.matches?.(SKIP_SELECTOR)) return;

  e.preventDefault();

  const container = e.currentTarget;
  const focusable = Array.from(container.querySelectorAll("input, select, textarea")).filter(
    (el) => !el.disabled && el.offsetParent !== null && !el.matches(SKIP_SELECTOR)
  );

  const index = focusable.indexOf(target);
  if (index === -1 || index === focusable.length - 1) return;

  const next = focusable[index + 1];
  next.focus();
  if (next.tagName === "INPUT" && typeof next.select === "function") next.select();
}
