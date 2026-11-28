import { useRef, useState, type ReactNode } from "react";
import type { ThemeChoice } from "../../shared/bridge-contract.ts";
import { curatedTheme, curatedThemes } from "../../shared/themes/curated-themes.ts";
import { commandShortcut, useCommands } from "../commands/commands-context.tsx";
import { ToolChecks } from "../setup/tool-check.tsx";
import { Button } from "../ui/button.tsx";
import { Icon, type IconName } from "../ui/icon.tsx";
import { KeyHint } from "../ui/key-hint.tsx";
import { Segmented } from "../ui/segmented.tsx";
import { rowLook, rowRing } from "../ui/row-look.ts";
import { Select } from "../ui/select.tsx";
import { usePageEscape, useReturnFocus } from "../window/page.tsx";
import { TopRow, type Frame } from "../window/top-row.tsx";

interface SettingsPageProps {
  theme: ThemeChoice;
  onTheme: (theme: ThemeChoice) => void;
  notifications: boolean;
  onNotifications: (on: boolean) => void;
  guideReady: boolean;
  onShowGuide: () => void;
  onLink: (address: string, description: string) => void;
  onClose: () => void;
  frame: Frame;
  sidebar: number;
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
const sections: readonly [
  { testId: string; name: string; icon?: IconName },
  ...{ testId: string; name: string; icon?: IconName }[],
] = [
  { testId: "settings-appearance", name: "Appearance", icon: "settings" },
  { testId: "settings-notifications", name: "Notifications", icon: "bell" },
  { testId: "settings-tools", name: "Tools", icon: "check" },
  { testId: "settings-guide", name: "Guide", icon: "chevron-right" },
  { testId: "settings-shortcuts", name: "Keyboard shortcuts", icon: "keys" },
  { testId: "settings-about", name: "About Satellite" },
];

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
  return (
    <section
      id={testId}
      aria-labelledby={`${testId}-title`}
      data-testid={testId}
      className="flex scroll-mt-6 flex-col gap-2"
    >
      <h3
        id={`${testId}-title`}
        tabIndex={-1}
        className="font-display text-[15px] leading-5 font-bold tracking-[-0.02em] outline-none"
      >
        {title}
      </h3>
      <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-raised p-4">
        {children}
      </div>
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

export function SettingsPage({
  theme,
  onTheme,
  notifications,
  onNotifications,
  guideReady,
  onShowGuide,
  onLink,
  onClose,
  frame,
  sidebar,
}: SettingsPageProps) {
  const credited = curatedTheme(theme);
  const [current, setCurrent] = useState<string>(sections[0].testId);
  const back = useRef<HTMLDivElement>(null);
  usePageEscape(onClose);
  useReturnFocus(back, "button", "sidebar-settings");
  return (
    <div
      data-testid="settings-page"
      className="absolute inset-0 z-40 grid bg-win text-fg"
      style={{ gridTemplateColumns: `${String(sidebar)}px minmax(0,1fr)` }}
    >
      <nav aria-label="Settings" className="flex min-h-0 flex-col gap-[2px] px-2 pb-3">
        <TopRow frame={frame} left={0} right={sidebar} className="-mx-2 h-11" />
        <div ref={back}>
          <Button
            variant="ghost"
            icon="chevron-left"
            shortcut="Esc"
            onClick={onClose}
            testId="settings-back"
            className="w-full justify-start"
          >
            Back to work
          </Button>
        </div>
        <p className="px-2 pt-4 pb-1 text-[11px] font-semibold text-dim">Settings</p>
        {sections.map((section) => [
          section.icon === undefined && <span key="fill" className="flex-1" />,
          <button
            key={section.testId}
            type="button"
            aria-current={current === section.testId}
            data-testid={`${section.testId}-link`}
            onClick={() => {
              setCurrent(section.testId);
              const shown = document.getElementById(section.testId);
              shown?.scrollIntoView({ block: "start" });
              document.getElementById(`${section.testId}-title`)?.focus();
            }}
            className={`flex h-8 items-center gap-2 px-2 text-left text-[13px] font-medium text-fg ${rowLook(current === section.testId)} ${rowRing}`}
          >
            {section.icon === undefined ? (
              <span className="flex flex-1 justify-between text-[12px] text-dim">
                {section.name}
                <span className="font-pixel uppercase">{satelliteVersion}</span>
              </span>
            ) : (
              <>
                <Icon name={section.icon} />
                {section.name}
              </>
            )}
          </button>,
        ])}
      </nav>
      <main
        aria-label="Settings"
        className="my-2 mr-2 flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-line bg-bg"
      >
        <TopRow frame={frame} left={sidebar} right={0} className="h-12" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[640px] flex-col gap-8 px-8 pb-12">
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-[22px] leading-7 font-bold tracking-[-0.02em]">
                settings
              </h2>
              <p className="text-[13px] text-fg2">Every choice applies at once.</p>
            </div>
            <Section title="appearance" testId="settings-appearance">
              <Setting
                name="Theme"
                detail="The terminal, the code and the window follow it at once."
              >
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
                  Open source under the MIT licence. The licences of the parts inside ship beside it
                  in third-party-licenses.md.
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
          </div>
        </div>
      </main>
    </div>
  );
}
