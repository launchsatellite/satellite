import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

interface ColumnDividerProps {
  side: "left" | "right";
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  testId: string;
}
interface Drag {
  pointerId: number;
  startX: number;
  startValue: number;
  value: number;
}

const keyStep = 8;
const labels = {
  left: "Resize the projects column",
  right: "Resize the sessions column",
};
const restingLine =
  "w-px group-hover:bg-ctl group-focus-visible:w-0.5 group-focus-visible:bg-accent";
const activeLine = "w-0.5 bg-accent";

export function ColumnDivider({
  side,
  value,
  min,
  max,
  onChange,
  onCommit,
  testId,
}: ColumnDividerProps) {
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const direction = side === "left" ? 1 : -1;
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next)));

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startValue: value, value };
    setDragging(true);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    current.value = clamp(current.startValue + (event.clientX - current.startX) * direction);
    onChange(current.value);
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (current.value !== current.startValue) onCommit(current.value);
  };
  const press = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? keyStep : -keyStep;
    const next = clamp(value + step * direction);
    if (next !== value) onCommit(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={labels[side]}
      tabIndex={0}
      data-testid={testId}
      className="group absolute inset-y-0 -right-[3px] z-20 w-[6px] cursor-col-resize touch-none outline-none select-none"
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={press}
    >
      <span
        className={`absolute inset-y-0 left-[3px] transition-[width,background-color] duration-[120ms] motion-reduce:transition-none ${dragging ? activeLine : restingLine}`}
      />
    </div>
  );
}
