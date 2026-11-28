export function KeyHint({ keys }: { keys: string }) {
  return (
    <kbd className="inline-flex items-center font-mono text-[10.5px] leading-[14px] font-medium tracking-[0.02em] text-dim">
      {keys}
    </kbd>
  );
}
