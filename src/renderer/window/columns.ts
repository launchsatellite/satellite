import { interfaceLimits } from "../../shared/bridge-contract.ts";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function fitColumns(
  chosen: { left: number; right: number },
  windowWidth: number,
): { left: number; right: number } {
  const { left: leftLimits, right: rightLimits, centreMin } = interfaceLimits;
  const room = windowWidth - centreMin;
  let left = clamp(chosen.left, leftLimits.min, leftLimits.max);
  let right = clamp(chosen.right, rightLimits.min, rightLimits.max);
  right = Math.max(rightLimits.min, right - Math.max(0, left + right - room));
  left = Math.max(leftLimits.min, left - Math.max(0, left + right - room));
  return { left, right };
}
