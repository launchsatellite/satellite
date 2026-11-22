import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { defaultInterfaceState } from "../shared/bridge-contract.ts";
import { invoke } from "./bridge/bridge-client.ts";
import "./styles/app.css";
import { AppWindow } from "./window/app-window.tsx";

const fontFamilies = [
  "Funnel Sans Variable",
  "Funnel Display Variable",
  "Geist Mono Variable",
  "Geist Pixel",
  "Satellite Terminal Mono",
];

const [, loaded, frame] = await Promise.all([
  Promise.allSettled(
    fontFamilies.map((family) => document.fonts.load(`13px "${family}"`, " \u2588")),
  ),
  invoke("interface.load", {}),
  invoke("window.frame", {}),
]);

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("The root element is missing from index.html");

createRoot(rootElement).render(
  <StrictMode>
    <AppWindow
      initial={loaded.ok ? loaded.value.state : { ...defaultInterfaceState, guideSeen: true }}
      frame={frame.ok ? frame.value : { frame: "native", fullScreen: false }}
      notice={loaded.ok ? loaded.value.notice : loaded.error.message}
    />
  </StrictMode>,
);
