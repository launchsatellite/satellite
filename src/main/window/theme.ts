import { nativeTheme } from "electron";
import type { ThemeChoice } from "../../shared/bridge-contract.ts";

export function applyThemeChoice(theme: ThemeChoice): void {
  nativeTheme.themeSource = theme;
}
