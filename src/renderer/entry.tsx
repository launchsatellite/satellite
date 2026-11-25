import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { defaultInterfaceState } from "../shared/bridge-contract.ts";
import { invoke } from "./bridge/bridge-client.ts";
import "./styles/app.css";
import { showTheme } from "./ui/shown-theme.ts";
import { TooltipProvider } from "./ui/tooltip.tsx";
import { AppWindow } from "./window/app-window.tsx";

const fontFamilies = [
  "Funnel Sans Variable",
  "Funnel Display Variable",
  "Geist Mono Variable",
  "Geist Pixel",
];

const [, loaded, frame] = await Promise.all([
  Promise.allSettled(
    fontFamilies.map((family) => document.fonts.load(`13px "${family}"`, " \u2588")),
  ),
  invoke("interface.load", {}),
  invoke("window.frame", {}),
]);

const initial = loaded.ok ? loaded.value.state : { ...defaultInterfaceState, guideSeen: true };
showTheme(initial.theme);

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("The root element is missing from index.html");

createRoot(rootElement).render(
  <StrictMode>
    <TooltipProvider>
      <AppWindow
        initial={initial}
        frame={frame.ok ? frame.value : null}
        notice={loaded.ok ? loaded.value.notice : loaded.error.message}
      />
    </TooltipProvider>
  </StrictMode>,
);
