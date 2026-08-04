# Drag & Drop Sort

Drag-and-drop reordering for the Obsidian file explorer. Files and folders are freely interspersed — designed for OneNote-style folder notes where a folder is just a file with children.

> **Status:** Alpha (0.12.0). Core reordering works but the modifier key interaction needs refinement. See [Known Issues](#known-issues).

## Features

- **Works everywhere, instantly** — No rules to configure. Enable the plugin and every folder supports custom ordering immediately.
- **Interspersed files & folders** — A folder's file note lives right alongside its child items, like in OneNote. No artificial file/folder separation.
- **Always-on drag reorder** — Drag any visible item to place it before/after another row. Cross-level insert (between rows in another folder) is supported.
- **Context-menu ordering** — Right-click a file or folder for move actions. Folders always offer **Reset sort** and **Reset sort (all descendants)**, even when no saved sort data currently exists. Desktop shows these commands in a submenu; mobile and tablet show them directly in their own menu section.
- **Only changed folders are saved** — Folders you never reorder keep zero state in `data.json`. Only reordered folders get an entry.
- **New items land at the end** — Items not yet in the saved order appear at the bottom: folders first (alphabetical), then files (alphabetical).

## How to use

1. Drag any file or folder in the file explorer.
2. A blue drop indicator shows where the item will land.
3. Release to commit the new order.
4. Dropping between rows in another folder moves the item into that folder at that position.
5. Alternatively, right-click an item and use **Drag & Drop Sort commands** to move it up, down, to the top, or to the bottom. Right-click any folder and choose **Reset sort** to remove that folder's saved order, or **Reset sort (all descendants)** to remove the folder's order and all custom orders below it.

## Installation

### Manual (for alpha testing)

```bash
# Clone or copy the plugin into your vault
cp dist/main.js manifest.json styles.css \
   .obsidian/plugins/drag-drop-sort/
```

Then enable **Drag & Drop Sort** in Settings → Community plugins.

**If you also use the `Folder Sort Rules` plugin, disable it first** — both plugins patch the same explorer method and will conflict.

After deploying a new plugin build to your vault (`main.js`, `manifest.json`, `styles.css`), reload the plugin or restart Obsidian so the new code is actually loaded.

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

## Data format

The plugin stores one simple object in `.obsidian/plugins/drag-drop-sort/data.json`:

```json
{
  "orders": {
    "Personal": ["Home", "Career", "Health", "Travel", "Finances"],
    "Personal/Home": ["Furniture.md", "Plants.md", "Kitties.md", "Assets"]
  }
}
```

Only folders you've actually reordered appear in this file. The order array contains item *names* (not full paths), and files and folders are freely mixed together.

## How it works

- Patches `getSortedFolderItems()` on the internal file explorer view.
- Sets `draggable` on every visible tree item.
- On drop: computes the new position relative to visible items, moves files/folders through Obsidian's file manager when parent changes, saves to `data.json`, triggers a re-render.
- Visible-item-awareness: items hidden by CSS snippets (e.g. `Assets` folders) or unsupported file types (e.g. `.json`) are tracked internally but excluded from positional calculations so the drop position matches what you see.

## Known Issues

- **Auto-expand on hover can still fire in edge cases** — Explorer drag internals are Obsidian-controlled and can still expand folders in some situations.
- **Alpha quality** — This plugin monkey-patches an internal Obsidian API (`getSortedFolderItems`). Behavior may change across Obsidian updates.
- **Only the first file explorer leaf is patched** — Multi-window setups with more than one file explorer are not fully supported.

## Credits

Drag & Drop Sort is an independent implementation based on the architecture and patterns of [Folder Sort Rules](https://github.com/wepee/obsidian-folder-sort-rules) by Adam. In particular, the `getSortedFolderItems` monkey-patch and per-item drag handler pattern are adapted from that MIT-licensed codebase.

## License

MIT — see [../../LICENSE.md](../../LICENSE.md).