
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./AuthGate";
import "./styles.css";
import "./axivestra-theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>
);
