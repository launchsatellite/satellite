import { interfaceLimits } from "../../shared/bridge-contract.ts";

interface Columns {
  sidebar: number;
  rail: number;
}

export type RailShape = "open" | "folded" | "hidden";

export const railFoldsBelow = 1100;
export const foldedRailWidth = 44;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fixedRail(rail: RailShape): number {
  return rail === "folded" ? foldedRailWidth : 0;
}

export function fitColumns(
  chosen: Columns,
  windowWidth: number,
  sidebarShown: boolean,
  rail: RailShape,
): Columns {
  const { sidebar: sidebarLimits, rail: railLimits, centreMin } = interfaceLimits;
  const room = windowWidth - centreMin;
  let sidebar = sidebarShown ? clamp(chosen.sidebar, sidebarLimits.min, sidebarLimits.max) : 0;
  if (rail !== "open") {
    const fixed = fixedRail(rail);
    if (sidebarShown) sidebar = Math.max(sidebarLimits.min, Math.min(sidebar, room - fixed));
    return { sidebar, rail: fixed };
  }
  let railWidth = clamp(chosen.rail, railLimits.min, railLimits.max);
  railWidth = Math.max(railLimits.min, railWidth - Math.max(0, sidebar + railWidth - room));
  if (sidebarShown) {
    sidebar = Math.max(sidebarLimits.min, sidebar - Math.max(0, sidebar + railWidth - room));
  }
  return { sidebar, rail: railWidth };
}

export function reachableColumns(fitted: Columns, windowWidth: number, rail: RailShape): Columns {
  const { sidebar: sidebarLimits, rail: railLimits, centreMin } = interfaceLimits;
  const room = windowWidth - centreMin;
  const beside = rail === "open" ? railLimits.min : fixedRail(rail);
  return {
    sidebar: clamp(room - beside, sidebarLimits.min, sidebarLimits.max),
    rail: clamp(room - fitted.sidebar, railLimits.min, railLimits.max),
  };
}
