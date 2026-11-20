const fnvOffset = 2166136261;
const fnvPrime = 16777619;
const colours = ["bg-accent", "bg-lilac-edge", "bg-volt-edge"];
const cells = Array.from({ length: 25 }, (_, index) => ({
  index,
  bit: Math.floor(index / 5) * 3 + (index % 5 < 3 ? index % 5 : 4 - (index % 5)),
}));

function fnv1a(seed: string): number {
  let hash = fnvOffset;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, fnvPrime);
  }
  return hash >>> 0;
}

export function PixelAvatar({ seed }: { seed: string }) {
  const hash = fnv1a(seed);
  const on = colours[(hash >>> 16) % colours.length];
  return (
    <span aria-hidden className="grid size-4 flex-none grid-cols-5 rounded-[4px] bg-sel p-[2px]">
      {cells.map(({ index, bit }) => (
        <span key={index} className={((hash >>> bit) & 1) === 1 ? on : undefined} />
      ))}
    </span>
  );
}
