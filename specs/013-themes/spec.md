# 013 Themes

Status **In progress** · Depends on **006, 007, 011, 012**

## Why

Developers live in one colour theme all day, in their code editor and their terminal, and Satellite's own grey look is the one place it breaks. Once curated themes exist, a person picks the theme they already know in Settings and the whole window, the terminal and the code follow it, with syntax coloured exactly as their editor colours it.

## Scope

- Curated themes, built in. Each one is the published theme file in the standard colour theme format, a JSON object with `colors` for the interface and `tokenColors` for syntax, taken unchanged from the syntax highlighter's own theme package. `src/shared/themes/curated-themes.ts` lists them, each with its name, its credit, the address of its site and its six state colours, so a later theme is one more entry there.
- One mapping, `src/shared/themes/theme-look.ts`, turns a theme's `colors` into Satellite's app tokens, the terminal's colours, the code viewer's theme and the title bar overlay, after it checks every colour against one strict hex form. The table in `DESIGN.md` names the key behind each token.
- Six state colours per theme, named as keys of the theme's own `colors`, since the format has none. Working, needs you, ready, done, idle and destructive keep their meaning in every theme, and the hues belong to the theme.
- The theme choice is `system`, `light`, `dark` or a curated theme's id. Settings shows it as a select with System, Light and Dark first, a command per curated theme joins Follow the system theme, Use the light theme and Use the dark theme, and the choice saves and restores in `interface.json` like the others. An unknown saved theme reads as System.
- A curated theme's syntax comes from Shiki with its JavaScript regular expression engine, in a worker, so the code viewer and the diff, side by side and inline, colour tokens with the same grammars and theme rules the theme was written for, `.tsx` and `.jsx` with the JSX grammars. A grammar loads the first time a file of its language shows under a curated theme. A language with no grammar, or one whose licence does not let Satellite ship it, stays plain text. Satellite's own light and dark keep Monaco's tokenizers and their weights and greys.
- Colouring never holds the window. Each grammar takes lines up to a measured length, the worker works in 25 ms slices with a second per file, and anything past those shows as plain text. Opening a file colours only that file and leaves every open diff's scroll, expanded regions and selection where they are.
- Every grammar's own copyright and licence ship in `third-party-licenses.md`.
- The mapping holds every pair it makes at 4.5 to 1 for text, 3 to 1 for status pixels and the focus ring, and 1.3 to 1 for control edges, as `DESIGN.md` states.
- Every surface follows a change at once with no relaunch, the chrome, every dialog and menu, every terminal shown or hidden, every open code viewer and diff, text selection, focus rings, scrollbars, the window's background, the title bar overlay on Windows and Linux, the system colour scheme the page and native dialogs read, and the first run.
- Settings credits the selected curated theme in one sentence with a button that opens its site through the link dialog, and the theme's licence ships in `third-party-licenses.md`.
- The `win` ground takes the theme's `sideBar.background`, so a curated theme colours the sidebar and the rail as one ground around the raised centre.

## Decisions

| Chosen | Rejected | Why |
| --- | --- | --- |
| The theme files from the highlighter's theme package, imported as they are | A copy of each theme in the repo, colours retyped into CSS | The package carries the published file unchanged, checked against the theme's official source at the same commit, so nothing drifts and nothing is retyped. |
| A select for the theme | A segmented control, a list of swatches | Six or eight names fit a select on every system, it is the platform's control for one choice of many, and keyboard and screen readers already know it. |
| Inline custom properties on the root plus `data-theme`, beside `nativeTheme.themeSource` | `themeSource` alone | A curated theme is neither light nor dark, so the page sets its tokens itself, while `themeSource` still takes the theme's type so native parts and `prefers-color-scheme` turn dark or light with it. |
| The theme's own `colors` as the code viewer's theme, its `tokenColors` as the rules | Satellite's tokens mapped back into the editor | The viewer then looks as the theme's own editor draws it, defaults included, since Monaco carries the same colour registry. |
| Monaco's tokenizers kept for Satellite's light and dark, and given back when a curated theme is left | Shiki for every theme | Satellite's own look stays exactly as it is, and Satellite themes load no grammar at all. |
| A theme raises no version of the interface file, and its theme reads any unknown value as System | A new version for themes | A new value is not a new shape. An older build still reads every file that does not hold a curated theme, and sets aside one that does, as it does any file it cannot read. |
| The state colours as keys of the theme's `colors` | Hex values in Satellite's list | Nothing is retyped, and the hue is the theme's own. |

## Not in scope

Importing a theme from disk or the network, editing a theme, colour for Satellite's own light and dark syntax, and the theme's semantic token colours, which need a language server Satellite does not run.

## Acceptance

A Satellite feature is accepted on macOS, Windows and Linux.

- [x] Choosing a curated theme in Settings and by its command changes the app tokens, the terminal's ground and colours, the code viewer's ground and at least three syntax colours of a TypeScript file to the published values, and the diff grounds follow. Proof, journey `settings`, which reads Dracula's ground on the window once it is chosen in Settings, journey `hostile-file`, which reads Dracula's keyword colour in a TypeScript diff, and `src/shared/themes/theme-look.test.ts` on the published values.
- [x] The choice survives a relaunch, and switching back restores Satellite's own tokens, terminal and syntax exactly. Proof, journey `settings`, which reads Dracula's ground again after a relaunch.
- [x] The credit's button opens the theme's site only through the link dialog.
- [x] The mapping accepts only strict hex colours, maps every curated theme fully, and an unknown saved theme reads as System. Proof, `src/shared/themes/theme-look.test.ts` and `src/main/state/interface-file.test.ts`.
- [x] The highlighter runs under the unchanged content security policy in the packaged app. Proof, journey `hostile-file`, which in Dracula reads the syntax worker's keyword colour in a TypeScript diff with no policy violation, and runs against each packaged app in the platforms workflow.
- [x] Every bundled grammar has a longest line, a longer line and a spent file show plain without scanning, and `.tsx` and `.jsx` take the theme's JSX colours. Proof, `src/renderer/diff/bounded-tokens.test.ts`, with `scripts/grammar-lines.ts` measuring each cap.
- [x] A hostile file opens while a terminal streams, in a curated theme and in Satellite light, with the page's longest gap under 250 ms, and recolouring leaves an open diff's scroll, expanded regions and selection alone. Proof, journey `hostile-file`, which opens such a file in the diff in Dracula and Settings over it.
- [x] Every pair the mapping makes reaches the bar, and the theme's own pairs below it are listed. Proof, `src/shared/themes/theme-look.test.ts`.
- [x] Every bundled grammar's licence ships in the notices. Proof, `npm run build` and `out/renderer/third-party-licenses.md`.
- [x] The overlay colours follow the theme and fall back to Satellite's dark. Proof, `src/main/platform/title-bar.test.ts`.
- [ ] The window frame, the overlay and native dialogs turn dark with a curated theme. Proof, a person on each system, since a quiet window shows no frame.

