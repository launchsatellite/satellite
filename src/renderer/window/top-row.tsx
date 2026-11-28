import { useEffect, useState, type ReactNode } from "react";
import type { WindowFrame } from "../../shared/bridge-contract.ts";
import { titleBar } from "../../shared/title-bar.ts";
import { invoke, subscribe } from "../bridge/bridge-client.ts";

export interface Frame {
  shown: WindowFrame | null;
  covered: boolean;
}

interface TopRowProps {
  as?: "div" | "header";
  frame: Frame;
  left: number;
  right: number;
  pad?: readonly [number, number];
  testId?: string;
  focusable?: boolean;
  className?: string;
  children?: ReactNode;
}

export function useWindowFrame(initial: WindowFrame | null): WindowFrame | null {
  const [frame, setFrame] = useState(initial);
  useEffect(() => {
    const stop = subscribe("window.frame", setFrame);
    void invoke("window.frame", {}).then((answer) => {
      if (answer.ok) setFrame(answer.value);
    });
    return stop;
  }, []);
  return frame;
}

export function TopRow({
  as: Element = "div",
  frame: { shown, covered },
  left,
  right,
  pad = [8, 8],
  testId,
  focusable = false,
  className = "",
  children,
}: TopRowProps) {
  const kind = shown?.frame ?? "unknown";
  const drags = kind !== "native" && !covered;
  const lights = (kind === "inset" || kind === "unknown") && shown?.fullScreen !== true;
  const [start, end] = pad;
  const overlayLeft = `calc(env(titlebar-area-x, 0px) - ${String(left)}px + ${String(start)}px)`;
  const lightsLeft = lights ? `, ${String(titleBar.trafficLightRoom - left)}px` : "";
  const overlayRight = `calc(100vw - ${String(right)}px - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + ${String(end)}px)`;
  return (
    <Element
      data-testid={testId}
      tabIndex={focusable ? -1 : undefined}
      data-frame={kind}
      data-drag={drags ? "true" : "false"}
      className={`flex flex-none items-center select-none [&_button]:[app-region:no-drag] ${drags ? "[app-region:drag]" : ""} ${className}`}
      style={{
        paddingLeft: `max(${String(start)}px, ${overlayLeft}${lightsLeft})`,
        paddingRight: `max(${String(end)}px, ${overlayRight})`,
      }}
    >
      {children}
    </Element>
  );
}
