import type { ReactNode } from "react";

export type IconName =
  | "plus"
  | "search"
  | "close"
  | "refresh"
  | "branch"
  | "folder"
  | "keys"
  | "check"
  | "archive"
  | "bell";

const shapes: Record<IconName, ReactNode> = {
  plus: <path d="M8 3v10M3 8h10" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.25 10.25 3.5 3.5" />
    </>
  ),
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  refresh: <path d="M13 8a5 5 0 1 1-1.46-3.54M13 2.75v2.5h-2.5" />,
  branch: (
    <>
      <circle cx="5" cy="3.75" r="1.5" />
      <circle cx="5" cy="12.25" r="1.5" />
      <circle cx="11" cy="5.5" r="1.5" />
      <path d="M5 5.25v5.5M11 7c0 2.5-2 3-6 3.75" />
    </>
  ),
  folder: (
    <path d="M1.75 4.5c0-.7.55-1.25 1.25-1.25h3l1.5 1.5H13c.7 0 1.25.55 1.25 1.25v6c0 .7-.55 1.25-1.25 1.25H3c-.7 0-1.25-.55-1.25-1.25z" />
  ),
  keys: (
    <>
      <rect x="1.75" y="4" width="12.5" height="8" rx="1.5" />
      <path d="M4.5 6.75h.01M7 6.75h.01M9.5 6.75h.01M12 6.75h.01M5 9.5h6" />
    </>
  ),
  check: <path d="m3.5 8.5 3 3 6-7" />,
  archive: (
    <>
      <rect x="2" y="2.75" width="12" height="3.25" rx="1" />
      <path d="M3 6v6.25c0 .55.45 1 1 1h8c.55 0 1-.45 1-1V6M6.5 8.75h3" />
    </>
  ),
  bell: <path d="M4 11V7a4 4 0 0 1 8 0v4l1.25 1.5H2.75zM6.5 14.25h3" />,
};

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="flex-none"
    >
      {shapes[name]}
    </svg>
  );
}
