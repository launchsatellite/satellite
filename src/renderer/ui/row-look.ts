export const rowRing =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";

export function rowLook(selected: boolean): string {
  return selected ? "rounded-[6px] bg-sel" : "rounded-[6px] hover:bg-hover";
}

export const rowReach =
  "relative before:absolute before:inset-y-0 before:-inset-x-1 before:content-['']";
