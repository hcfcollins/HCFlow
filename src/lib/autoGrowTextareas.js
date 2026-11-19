// Fallback for browsers without CSS `field-sizing: content` (older Safari,
// Firefox): size every <textarea> to its text as it's typed, filled in or shown.
export function installAutoGrowTextareas() {
  if (typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content")) return;
  const fit = (el) => {
    if (!(el instanceof HTMLTextAreaElement)) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  const fitAll = () => document.querySelectorAll("textarea").forEach(fit);
  document.addEventListener("input", (e) => fit(e.target));
  document.addEventListener("focusin", (e) => fit(e.target));
  // New screens/textareas, and text React fills in (drafts, "Use this").
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fitAll();
    });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  fitAll();
}
