import { interfaceLimits } from "../../shared/bridge-contract.ts";

interface Columns {
  left: number;
  right: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function fitColumns(chosen: Columns, windowWidth: number, sidebarShown: boolean): Columns {
  const { left: leftLimits, right: rightLimits, centreMin } = interfaceLimits;
  const room = windowWidth - centreMin;
  let left = sidebarShown ? clamp(chosen.left, leftLimits.min, leftLimits.max) : 0;
  let right = clamp(chosen.right, rightLimits.min, rightLimits.max);
  right = Math.max(rightLimits.min, right - Math.max(0, left + right - room));
  if (sidebarShown) left = Math.max(leftLimits.min, left - Math.max(0, left + right - room));
  return { left, right };
}

export function reachableColumns(fitted: Columns, windowWidth: number): Columns {
  const { left: leftLimits, right: rightLimits, centreMin } = interfaceLimits;
  const room = windowWidth - centreMin;
  return {
    left: clamp(room - rightLimits.min, leftLimits.min, leftLimits.max),
    right: clamp(room - fitted.left, rightLimits.min, rightLimits.max),
  };
}
