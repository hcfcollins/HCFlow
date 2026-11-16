import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext(null);

/** Mounted once at the app root. Gives every component a quick, non-blocking
 * way to acknowledge a save/action instead of leaving it silent. */
export function ToastProvider({ children }) {
  const [message, setMessage] = useState(null);
  const timeoutRef = useRef(null);

  const showToast = useCallback((text) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setMessage(text);
    // Problems stay up long enough to actually read.
    const problem = /couldn't|could not|failed|error|nothing to send/i.test(String(text));
    timeoutRef.current = setTimeout(() => setMessage(null), problem ? 9000 : 2500);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
