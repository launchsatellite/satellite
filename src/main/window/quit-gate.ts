export function createQuitGate(
  settle: () => Promise<unknown>,
  quit: () => void,
): (event: { preventDefault(): void }) => void {
  let state: "open" | "waiting" | "done" = "open";
  return (event) => {
    if (state === "done") return;
    event.preventDefault();
    if (state === "waiting") return;
    state = "waiting";
    void settle().finally(() => {
      state = "done";
      quit();
    });
  };
}
