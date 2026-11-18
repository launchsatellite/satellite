# Satellite

An agentic development environment. One desktop app holds all your projects and every parallel piece of work inside them, and each piece of work gets its own git worktree, its own Claude Code session, its own terminals and its own view of files, changes and pull requests.

Agents stay in orbit and do the work. You stay at the centre.

## Status

Early. Nothing is built yet. The first release will be 0.1.0, for macOS, Windows and Linux.

## Working on Satellite

Satellite is built mostly by coding agents, under the same rules as people. [AGENTS.md](AGENTS.md) holds the rules, [CONTRIBUTING.md](CONTRIBUTING.md) explains them for people, and [specs/](specs/README.md) describes each feature before it is built.

After cloning, switch on the Git hooks.

```sh
git config core.hooksPath .githooks
```

## License

[MIT](LICENSE)
