# Obsidian Plugins

Plugin projects for summerdawn.ai.

## Plugins

### Drag & Drop Sort

Adds drag-and-drop custom ordering to the Obsidian file explorer with interspersed files and folders.

Project location: `src/drag-drop-sort`

### File Explorer Filter

Filters the Obsidian file explorer by top-level folder and `[DONE]` status.

Project location: `src/file-explorer-filter`

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

## License

This repository is licensed under the MIT License - see [LICENSE.md](LICENSE.md).
