export type GatedKey = Pick<KeyboardEvent, "type" | "repeat">;
export interface HeldKeyGate {
  focused(): void;
  allows(event: GatedKey): boolean;
}

export function createHeldKeyGate(): HeldKeyGate {
  let holding = false;
  return {
    focused() {
      holding = true;
    },
    allows(event) {
      if (!holding) return true;
      if (event.repeat) return false;
      if (event.type === "keydown") holding = false;
      return true;
    },
  };
}
