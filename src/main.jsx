import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { ToastProvider } from "./lib/ToastContext.jsx";
import Tooltips from "./components/Tooltips.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
      <Tooltips />
    </ToastProvider>
  </React.StrictMode>
);
