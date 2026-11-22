# Satellite

An agentic development environment. One desktop app holds all your projects and every parallel piece of work inside them, and each piece of work gets its own git worktree, its own Claude Code sessions and its own view of changes, files and pull requests.

Agents stay in orbit and do the work. You stay at the centre.

## Status

Early. Satellite holds your projects in one window and gives each piece of work a workspace, a worktree and branch made in one step and archived once you have seen what would be lost. The real Claude Code runs in a terminal on the right, the inbox says when an agent needs you, and the centre reads the workspace's changes, files, pull request and running processes. A short guide walks a first project through it. [SATELLITE.md](SATELLITE.md) says what the product is, and the [specs index](specs/README.md) shows what is built.

## Install

A Satellite build is a dmg or zip for macOS (arm64 and x64), an installer for Windows (x64), or an AppImage or deb for Linux (x64), with a `SHA256SUMS.txt` and `third-party-licenses.md` beside it. Builds carry no paid signature, so macOS and Windows warn before the first open.

**Check the download.** Run the check in the folder that holds the package and `SHA256SUMS.txt`. Each line it prints must end in `OK`.

```sh
shasum -a 256 -c SHA256SUMS.txt --ignore-missing     # macOS
sha256sum -c SHA256SUMS.txt --ignore-missing         # Linux
```

On Windows, `Get-FileHash .\<installer>.exe` in PowerShell prints the hash to compare, ignoring case, with the installer's line in `SHA256SUMS.txt`.

**macOS.** Open the dmg and drag Satellite into Applications. The app is ad-hoc signed and not notarized, so the first open says macOS cannot verify it. Open System Settings, then Privacy and Security, and choose Open Anyway. Or clear the quarantine flag in a terminal.

```sh
xattr -dr com.apple.quarantine /Applications/Satellite.app
```

**Windows.** Run the installer. SmartScreen shows "Windows protected your PC", so choose More info, then Run anyway. With Smart App Control on, Windows blocks an unsigned app it cannot vouch for and offers no way to allow that one app, only to turn Smart App Control off in Windows Security.

**Linux.** Pick the package by distribution. Ubuntu and other Debian-family systems take the deb. Every other distribution takes the AppImage.

The deb installs with `sudo apt install ./<package>.deb` and sets up everything the sandbox needs, an AppArmor profile for Satellite included.

The AppImage needs its executable bit and FUSE 2, which newer distributions leave out by default. The [AppImage guide](https://docs.appimage.org/user-guide/troubleshooting/fuse.html) names the package for each one.

```sh
chmod +x <package>.AppImage
./<package>.AppImage
```

Ubuntu 24.04 and newer limit unprivileged user namespaces, which Chromium's sandbox relies on, so the AppImage stops at start there and the deb is the way in. Never run Satellite with `--no-sandbox`. Linux builds are made and tested on Ubuntu 24.04 and need glibc 2.34 or newer.

**Update.** Satellite never checks for updates. Install the new package over the old one, the way you installed it, and your projects and workspaces stay.

**Uninstall.** Archive your workspaces in Satellite first. `~/.satellite` holds their worktrees with any uncommitted work, so deleting that folder loses the work, and each repository keeps a record of those worktrees until `git worktree prune`.

## Run from source

With Node 24, the version in `.nvmrc`, install and start. `npm ci` also fetches Electron and readies the terminal's native module, which on Linux it compiles, so Linux also needs python3, make and a C++ compiler.

```sh
npm ci
npm run dev
```

## Working on Satellite

Satellite is built mostly by coding agents, under the same rules as people. [AGENTS.md](AGENTS.md) holds the rules, [CONTRIBUTING.md](CONTRIBUTING.md) explains them for people, and [specs/](specs/README.md) describes each feature before it is built.

After cloning, switch on the Git hooks.

```sh
git config core.hooksPath .githooks
```

## License

[MIT](LICENSE)
