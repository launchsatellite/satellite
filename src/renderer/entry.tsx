import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import { AppWindow } from "./window/app-window.tsx";

const fontFamilies = [
  "Funnel Sans Variable",
  "Funnel Display Variable",
  "Geist Mono Variable",
  "Geist Pixel",
  "Satellite Terminal Mono",
];

await Promise.all(fontFamilies.map((family) => document.fonts.load(`13px "${family}"`, " \u2588")));

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("The root element is missing from index.html");

createRoot(rootElement).render(
  <StrictMode>
    <AppWindow />
  </StrictMode>,
);
