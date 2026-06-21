import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { injectGeneratedEffects } from "./engine/generated-effects-db";

// Inject auto-parsed effects before any game state is created
injectGeneratedEffects();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);
