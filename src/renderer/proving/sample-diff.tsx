import { DiffView } from "../diff/diff-view.tsx";

const original = [
  "export function launchWindow(home: string) {",
  "  const window = createWindow({",
  "    width: 1280,",
  "    height: 800,",
  '    title: "Satellite",',
  "  });",
  '  window.setBackground("#ffffff");',
  "  window.loadEntry(home);",
  "  return window;",
  "}",
  "",
].join("\n");

const modified = [
  "export function launchWindow(home: string) {",
  "  const window = createWindow({",
  "    width: 1440,",
  "    height: 800,",
  '    title: "Satellite",',
  "  });",
  "  window.loadEntry(home);",
  "  window.focus();",
  "  return window;",
  "}",
  "",
].join("\n");

const labels = { original: "Before, launch-window.ts", modified: "After, launch-window.ts" };

export function SampleDiff() {
  return (
    <DiffView
      original={original}
      modified={modified}
      path="launch-window.ts"
      inline={false}
      labels={labels}
    />
  );
}
