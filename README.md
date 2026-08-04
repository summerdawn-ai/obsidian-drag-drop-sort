# Obsidian Plugins

This repository contains plugins for the Obsidian note-taking application.

## Overview

The current plugins are geared towards users who are migrating from OneNote to Obsidian.

### Plugins

- [Drag & Drop Sort](src/drag-drop-sort/README.md): Adds drag-and-drop custom ordering to the Obsidian file explorer with interspersed files and folders.
- [File Explorer Filter](src/file-explorer-filter/README.md): Filters the Obsidian file explorer by top-level folder and `[DONE]` status.

## Development

Load a plugin unpacked from its folder under `src/`:

1. Open the plugin folder.
2. Install dependencies with `npm install`.
3. Run `npm run dev` for watch mode or `npm run build` for a production build.

Example for Drag & Drop Sort:

```bash
cd src/drag-drop-sort
npm install
npm run dev
npm run build
```

## Contributing

Contributions are welcome. Please fork the repository, create a focused branch for your change, and open a pull request with a clear description of what changed and why; issues are also welcome for bug reports and feature ideas.

## Security

We welcome responsible security reports. Please contact the repository owner privately with the details rather than opening a public issue, so the problem can be investigated and addressed before it is disclosed.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
