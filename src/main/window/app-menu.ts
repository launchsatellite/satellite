import { app, Menu, type MenuItemConstructorOptions } from "electron";

function menuTemplate(): MenuItemConstructorOptions[] {
  const appMenu: MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "quit" }],
          },
        ]
      : [];
  const viewMenu: MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [{ label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }] }];
  return [
    ...appMenu,
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    ...viewMenu,
    { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] },
  ];
}

export function installAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate()));
}
