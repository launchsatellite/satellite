import { useId, type ReactNode } from "react";
import type { ThemeChoice } from "../../shared/bridge-contract.ts";
import { curatedTheme, curatedThemes } from "../../shared/themes/curated-themes.ts";
import { commandShortcut, useCommands } from "../commands/commands-context.tsx";
import { ToolChecks } from "../setup/tool-check.tsx";
import { Button } from "../ui/button.tsx";
import { Dialog } from "../ui/dialog.tsx";
import { KeyHint } from "../ui/key-hint.tsx";
import { Segmented } from "../ui/segmented.tsx";
import { Select } from "../ui/select.tsx";

interface SettingsDialogProps {
  theme: ThemeChoice;
  onTheme: (theme: ThemeChoice) => void;
  notifications: boolean;
  onNotifications: (on: boolean) => void;
  guideReady: boolean;
  onShowGuide: () => void;
  onLink: (address: string, description: string) => void;
  onClose: () => void;
  returnFocusTo: string;
}

const repositoryAddress = "https://github.com/launchsatellite/satellite";
const securityAddress = `${repositoryAddress}/security/policy`;
const repositorySentence = "Satellite's source on GitHub, where its issues and releases live too.";
const securitySentence = "How to report a vulnerability in Satellite privately, never in public.";
const themes: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  ...curatedThemes.map(({ id, name }) => ({ value: id, label: name })),
];
const switches = [
  { value: "on", label: "On", testId: "settings-notifications-on" },
  { value: "off", label: "Off", testId: "settings-notifications-off" },
] as const;
const note = "text-[12px] text-dim";

function ThemeSelect({
  theme,
  onTheme,
}: {
  theme: ThemeChoice;
  onTheme: (theme: ThemeChoice) => void;
}) {
  return (
    <Select
      label="Theme"
      testId="settings-theme"
      value={theme}
      options={themes}
      onChange={onTheme}
      className="min-w-[160px]"
    />
  );
}

function Section({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className="flex flex-col gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0"
    >
      <h3
        id={headingId}
        className="font-display text-[15px] leading-5 font-bold tracking-[-0.02em]"
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function Setting({
  name,
  detail,
  children,
}: {
  name: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-[180px] flex-1 flex-col gap-1">
        <p className="text-[13px] text-fg">{name}</p>
        <p className={note}>{detail}</p>
      </div>
      {children}
    </div>
  );
}

function ShortcutList() {
  const { commands } = useCommands();
  return (
    <ul className="flex flex-col">
      {commands.flatMap((command) => {
        const keys = commandShortcut(command);
        if (keys === undefined) return [];
        return [
          <li
            key={command.id}
            data-testid={`settings-shortcut-${command.id.replaceAll(".", "-")}`}
            className="flex h-7 items-center justify-between gap-4 text-[13px] text-fg2"
          >
            <span className="truncate">{command.title}</span>
            <KeyHint keys={keys} />
          </li>,
        ];
      })}
    </ul>
  );
}

export function SettingsDialog({
  theme,
  onTheme,
  notifications,
  onNotifications,
  guideReady,
  onShowGuide,
  onLink,
  onClose,
  returnFocusTo,
}: SettingsDialogProps) {
  const credited = curatedTheme(theme);
  return (
    <Dialog
      title="Settings"
      testId="settings-dialog"
      onClose={onClose}
      closable
      returnFocusTo={returnFocusTo}
      footer={
        <Button onClick={onClose} testId="settings-done">
          Done
        </Button>
      }
    >
      <Section title="appearance" testId="settings-appearance">
        <Setting name="Theme" detail="The terminal, the code and the window follow it at once.">
          <ThemeSelect theme={theme} onTheme={onTheme} />
        </Setting>
        {credited !== undefined && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p data-testid="settings-theme-credit" className={`min-w-[180px] flex-1 ${note}`}>
              {credited.credit}
            </p>
            <Button
              variant="secondary"
              size="small"
              onClick={() => {
                onLink(credited.site, `The home of the ${credited.name} theme.`);
              }}
              testId="settings-theme-site"
            >
              Open the theme&apos;s site
            </Button>
          </div>
        )}
      </Section>
      <Section title="notifications" testId="settings-notifications">
        <Setting
          name="System notifications"
          detail="Only when a workspace needs you and the window is out of sight. Needs you fills either way, and your system's settings for Satellite still decide whether they show."
        >
          <Segmented
            label="System notifications"
            value={notifications ? "on" : "off"}
            options={switches}
            onChange={(value) => {
              onNotifications(value === "on");
            }}
          />
        </Setting>
      </Section>
      <Section title="tools" testId="settings-tools">
        <p className={note}>Satellite runs your own git, gh and Claude Code.</p>
        <ToolChecks testPrefix="settings-check" />
      </Section>
      <Section title="guide" testId="settings-guide">
        <Setting
          name="The guide"
          detail={
            guideReady
              ? "Four cards beside the controls nobody guesses, from the first step that still applies."
              : "It starts once you add a repo."
          }
        >
          <Button
            variant="secondary"
            size="small"
            onClick={onShowGuide}
            disabled={!guideReady}
            testId="settings-show-guide"
          >
            Show the guide
          </Button>
        </Setting>
      </Section>
      <Section title="keyboard shortcuts" testId="settings-shortcuts">
        <ShortcutList />
      </Section>
      <Section title="about" testId="settings-about">
        <div className="flex flex-col gap-1">
          <p data-testid="settings-version" className="text-[13px] text-fg">
            {`Satellite ${satelliteVersion}`}
          </p>
          <p className={note}>
            Open source under the MIT licence. The licences of the parts inside ship beside it in
            third-party-licenses.md.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              onLink(repositoryAddress, repositorySentence);
            }}
            testId="settings-repository"
          >
            Open the repository
          </Button>
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              onLink(securityAddress, securitySentence);
            }}
            testId="settings-security"
          >
            Read the security policy
          </Button>
        </div>
      </Section>
    </Dialog>
  );
}
