const framed = "rounded-[4px] border border-ctl px-[5px] py-px";

export function KeyHint({ keys, plain = false }: { keys: string; plain?: boolean }) {
  return (
    <kbd
      className={`inline-flex items-center font-mono text-[11px] leading-[14px] font-medium text-dim ${plain ? "" : framed}`}
    >
      {keys}
    </kbd>
  );
}
