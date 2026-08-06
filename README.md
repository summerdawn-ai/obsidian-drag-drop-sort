# Obsidian Plugins

Plugins for the Obsidian note-taking application.

## Overview

The current plugins are geared towards users who are migrating from OneNote to Obsidian.

### Plugins

- [Drag and Drop Sort](src/drag-drop-sort/README.md): Adds drag-and-drop custom ordering to the Obsidian file explorer with interspersed files and folders.
- [File Explorer Filter](src/file-explorer-filter/README.md): Filters the Obsidian file explorer by top-level folder and `[DONE]` status.

## Development

Load a plugin unpacked from its folder under `src/`:

1. Open the plugin folder.
2. Install dependencies with `npm install`.
3. Run `npm run dev` for watch mode or `npm run build` for a production build.

Example for Drag and Drop Sort:

```bash
cd src/drag-drop-sort
npm install
npm run dev
npm run build
```

### Chrome DevTools

To inspect a plugin in Obsidian's live renderer, close any running Obsidian instance and start it with remote debugging enabled:

```powershell
& "C:\Program Files\Obsidian\Obsidian.exe" --remote-debugging-port=9222
```

1. Confirm that the renderer is available at [http://127.0.0.1:9222/json/list](http://127.0.0.1:9222/json/list).
2. Attach a Chrome DevTools MCP or CDP client to the `webSocketDebuggerUrl` returned for the renderer target.
3. Evaluate JavaScript inside Obsidian's live renderer.

The `--remote-debugging-port` switch is documented in [Electron's command-line switch reference](https://www.electronjs.org/docs/latest/api/command-line-switches), and the `/json/list` endpoint and `webSocketDebuggerUrl` are part of the [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/).

## Contributing

Contributions are welcome. Please fork the repository, create a focused branch for your change, and open a pull request with a clear description of what changed and why; issues are also welcome for bug reports and feature ideas.

## Security

We welcome responsible security reports. Please contact the repository owner privately with the details rather than opening a public issue, so the problem can be investigated and addressed before it is disclosed.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
