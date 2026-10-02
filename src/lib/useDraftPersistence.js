import { useEffect, useRef } from "react";

const DRAFT_PREFIX = "hcflow-draft:";

/** Reads a saved draft once, outside React — call at module scope inside a
 * component (e.g. `useRef(loadDraft("new-comp")).current`) to seed useState
 * initializers without re-reading localStorage on every render. */
export function loadDraft(key) {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Auto-saves `draft` (a plain object of the form's current field values) to
 * localStorage under `key` on every change — not an explicit "save draft"
 * button, so an interruption (a phone call, accidentally closing the tab)
 * never loses what was already typed. Returns `clearDraft`, which the form
 * calls right after a successful submit so finished forms don't leave a
 * stale draft sitting around to confusingly reappear later. */
export function useDraftPersistence(key, draft) {
  const storageKey = DRAFT_PREFIX + key;
  const skipNextSave = useRef(true);
  const serialized = JSON.stringify(draft);

  useEffect(() => {
    // Skip the render that just restored a draft, so loading one doesn't
    // immediately re-save the exact same thing right back.
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    try {
      localStorage.setItem(storageKey, serialized);
    } catch {
      // Private browsing / storage full — losing autosave silently beats
      // crashing the form over it.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, serialized]);

  function clearDraft() {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Nothing to do if storage isn't available.
    }
  }

  return { clearDraft };
}
