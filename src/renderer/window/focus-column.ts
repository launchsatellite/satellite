const focusable =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

function firstShown(column: HTMLElement, selector: string): HTMLElement | undefined {
  return [...column.querySelectorAll<HTMLElement>(selector)].find((element) =>
    element.checkVisibility(),
  );
}

export function focusColumn(testId: string, preferred: string): void {
  const column = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (column === null) return;
  (firstShown(column, preferred) ?? firstShown(column, focusable))?.focus();
}
