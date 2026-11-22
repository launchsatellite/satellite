export function createQuitGate(
  ask: () => Promise<boolean>,
  settle: () => Promise<unknown>,
  quit: () => void,
): (event: { preventDefault(): void }) => void {
  let state: "open" | "asking" | "waiting" | "done" = "open";
  return (event) => {
    if (state === "done") return;
    event.preventDefault();
    if (state !== "open") return;
    state = "asking";
    void ask()
      .catch(() => true)
      .then((leave) => {
        if (!leave) {
          state = "open";
          return;
        }
        state = "waiting";
        void settle().finally(() => {
          state = "done";
          quit();
        });
      });
  };
}
