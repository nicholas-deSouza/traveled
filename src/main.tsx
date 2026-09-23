import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "maplibre-gl/dist/maplibre-gl.css";
import "./index.css";
import { App } from "./App";

// React's initial mount is the sole document lookup; keep DOM access out of components.
// eslint-disable-next-line no-restricted-globals, no-restricted-properties
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
