# Satellite

An agentic development environment. One desktop app holds all your projects and every parallel piece of work inside them, and each piece of work gets its own git worktree, its own Claude Code sessions and its own view of changes, files and pull requests.

Agents stay in orbit and do the work. You stay at the centre.

## Status

Early. The foundation runs, one window with the three columns, the real Claude Code in a terminal on the right and a read-only diff in the centre. [SATELLITE.md](SATELLITE.md) says what the product is, and the [specs index](specs/README.md) shows what is built.

## Install

A Satellite build is a dmg or zip for macOS (arm64 and x64), an installer for Windows (x64), or an AppImage or deb for Linux (x64), with a `SHA256SUMS.txt` beside it. Builds carry no paid signature, so each system asks once before it opens one.

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

**Windows.** Run the installer. SmartScreen shows "Windows protected your PC", so choose More info, then Run anyway.

**Linux.** The deb installs with `sudo apt install ./<package>.deb` and sets up everything the sandbox needs. The AppImage needs its executable bit first.

```sh
chmod +x <package>.AppImage
./<package>.AppImage
```

Ubuntu 24.04 limits unprivileged user namespaces, which Chromium's sandbox relies on, so the AppImage stops at start there. Install the deb instead, which adds an AppArmor profile for Satellite. Never run Satellite with `--no-sandbox`.

## Run from source

With Node 24, the version in `.nvmrc`, install and start. `npm ci` also fetches Electron and readies the terminal's native module.

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
