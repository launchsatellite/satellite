import type { ReactNode } from "react";

export function Sentence({
  testId,
  text,
  children,
}: {
  testId: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
      <p
        data-testid={testId}
        role="status"
        className="max-w-[360px] text-center text-[13px] text-fg2"
      >
        {text}
      </p>
      {children}
    </div>
  );
}
