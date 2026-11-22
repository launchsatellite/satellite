import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bridgeLimits,
  type SessionStatus,
  type WorkspaceKey,
  type WorkspaceRef,
} from "../../shared/bridge-contract.ts";
import { subscribe } from "../bridge/bridge-client.ts";
import { needsSince } from "../inbox/inbox.ts";
import { nextNeed } from "../inbox/need-order.ts";
import type { PixelState } from "../ui/status-pixel.tsx";
import type { Notify } from "../ui/toast.tsx";
import { mostUrgent } from "./session-pixel.ts";

export interface SessionTab {
  key: string;
  terminalId: string;
  number: number;
  workspace: WorkspaceRef;
  resume: boolean;
  status: SessionStatus;
  ready: boolean;
  needsSince: number | null;
}
export interface Sessions {
  tabsOf: (ref: WorkspaceRef) => SessionTab[];
  all: SessionTab[];
  activeOf: (ref: WorkspaceRef) => string | undefined;
  open: (ref: WorkspaceRef, resume: boolean) => boolean;
  restart: (key: string) => void;
  close: (key: string) => void;
  activate: (key: string) => void;
  forgetWorkspace: (ref: WorkspaceRef) => void;
  forgetGone: (gone: readonly { ref: WorkspaceRef; name: string | null }[]) => void;
  forgetProject: (projectId: string) => void;
  pixelFor: (projectId: string, workspace: WorkspaceKey) => PixelState;
}
interface State {
  tabs: SessionTab[];
  active: ReadonlyMap<string, string>;
}

export const tabLimit = bridgeLimits.terminals;
export const tabLimitSentence = `Satellite keeps ${String(tabLimit)} Claude Code sessions open at most. Close one first.`;

function stoppedSentence(names: readonly string[]): string {
  if (names.length === 1)
    return `Claude Code stopped in ${names.join("")}, since its folder is gone.`;
  const named =
    names.length > 3
      ? `${String(names.length)} workspaces`
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
  return `Claude Code stopped in ${named}, since their folders are gone.`;
}

function placeOf(ref: WorkspaceRef): string {
  return `${ref.projectId}/${ref.workspace}`;
}

function inPlace(tab: SessionTab, place: string): boolean {
  return placeOf(tab.workspace) === place;
}

function withoutTabs(state: State, dropped: (tab: SessionTab) => boolean): State {
  const gone = state.tabs.filter(dropped);
  if (gone.length === 0) return state;
  const active = new Map(state.active);
  for (const tab of gone) {
    const place = placeOf(tab.workspace);
    if (active.get(place) !== tab.key) continue;
    const siblings = state.tabs.filter((other) => inPlace(other, place));
    const at = siblings.indexOf(tab);
    const next =
      siblings.slice(at + 1).find((other) => !dropped(other)) ??
      siblings
        .slice(0, at)
        .reverse()
        .find((other) => !dropped(other));
    if (next === undefined) active.delete(place);
    else active.set(place, next.key);
  }
  return { tabs: state.tabs.filter((tab) => !dropped(tab)), active };
}

export function useSessions(notify: Notify): Sessions {
  const [state, setState] = useState<State>({ tabs: [], active: new Map() });
  const numbers = useRef(new Map<string, number>());
  const count = useRef(0);
  useEffect(() => {
    count.current = state.tabs.length;
  }, [state.tabs.length]);
  useEffect(
    () =>
      subscribe("sessions.status", ({ id, status, ready }) => {
        setState((current) =>
          current.tabs.some(
            (tab) => tab.terminalId === id && (tab.status !== status || tab.ready !== ready),
          )
            ? {
                ...current,
                tabs: current.tabs.map((tab) =>
                  tab.terminalId === id
                    ? {
                        ...tab,
                        status,
                        ready,
                        needsSince: needsSince(tab, status, nextNeed),
                      }
                    : tab,
                ),
              }
            : current,
        );
      }),
    [],
  );
  const open = useCallback((ref: WorkspaceRef, resume: boolean) => {
    if (count.current >= tabLimit) return false;
    count.current += 1;
    const place = placeOf(ref);
    const number = (numbers.current.get(place) ?? 0) + 1;
    numbers.current.set(place, number);
    const tab: SessionTab = {
      key: crypto.randomUUID(),
      terminalId: crypto.randomUUID(),
      number,
      workspace: { projectId: ref.projectId, workspace: ref.workspace },
      resume,
      status: "idle",
      ready: false,
      needsSince: null,
    };
    setState((current) => ({
      tabs: [...current.tabs, tab],
      active: new Map(current.active).set(place, tab.key),
    }));
    return true;
  }, []);
  const restart = useCallback((key: string) => {
    const terminalId = crypto.randomUUID();
    setState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.key === key
          ? {
              ...tab,
              terminalId,
              resume: false,
              status: "idle",
              ready: false,
              needsSince: null,
            }
          : tab,
      ),
    }));
  }, []);
  const close = useCallback((key: string) => {
    setState((current) => withoutTabs(current, (tab) => tab.key === key));
  }, []);
  const activate = useCallback((key: string) => {
    setState((current) => {
      const tab = current.tabs.find((listed) => listed.key === key);
      if (tab === undefined) return current;
      return { ...current, active: new Map(current.active).set(placeOf(tab.workspace), key) };
    });
  }, []);
  const forgetWorkspace = useCallback((ref: WorkspaceRef) => {
    const place = placeOf(ref);
    numbers.current.delete(place);
    setState((current) => withoutTabs(current, (tab) => inPlace(tab, place)));
  }, []);
  const forgetGone = useCallback(
    (gone: readonly { ref: WorkspaceRef; name: string | null }[]) => {
      for (const { ref } of gone) forgetWorkspace(ref);
      const names = gone.flatMap(({ name }) => (name === null ? [] : [name]));
      if (names.length > 0) notify(stoppedSentence(names), "notice");
    },
    [forgetWorkspace, notify],
  );
  const forgetProject = useCallback((projectId: string) => {
    for (const place of numbers.current.keys()) {
      if (place.startsWith(`${projectId}/`)) numbers.current.delete(place);
    }
    setState((current) => withoutTabs(current, (tab) => tab.workspace.projectId === projectId));
  }, []);
  return useMemo(() => {
    const tabsOf = (ref: WorkspaceRef) => state.tabs.filter((tab) => inPlace(tab, placeOf(ref)));
    return {
      tabsOf,
      all: state.tabs,
      activeOf: (ref) => state.active.get(placeOf(ref)),
      open,
      restart,
      close,
      activate,
      forgetWorkspace,
      forgetGone,
      forgetProject,
      pixelFor: (projectId, workspace) =>
        mostUrgent(tabsOf({ projectId, workspace }).map((tab) => tab.status)),
    };
  }, [state, open, restart, close, activate, forgetWorkspace, forgetGone, forgetProject]);
}
