import { createContext, useContext } from "react";

/** App-level provider of extra per-to-do buttons (the staff "notify agent"
 * bell, Generate Utility Email on "Send Utilities") — via context so every
 * to-do list in the app (deal cards, deal detail, the To-Dos page) gets them
 * without threading a prop through every intermediate component. Value is a
 * function (todo) => ReactNode | null. */
export const TodoActionsContext = createContext(null);

export function useTodoActions() {
  return useContext(TodoActionsContext);
}
