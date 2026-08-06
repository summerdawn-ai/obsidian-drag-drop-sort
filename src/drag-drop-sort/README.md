# Drag and Drop Sort

Extension for Obsidian to provide custom drag & drop reordering in the File explorer.

## Overview

Drag and Drop Sort adds custom drag-and-drop ordering to Obsidian's File explorer. Files and folders can be freely interspersed, like in OneNote.

### Features

- **Fully Custom Sort Order**: Customize sort order by dragging and dropping folders or notes directly in the File explorer.
- **Handles Renames and Moves**: Keeps custom ordering through renames and moves.
- **Context Menu and Command Palette**: Alternatively, use context-menu items or the command palette to move items up, down, to the top, or to the bottom. The commands can also be assigned hotkeys in Settings → Hotkeys.
- **Reset Controls**: Reset a folder or an entire branch of descendants.

### Version History

- **1.0.0 (2026-08-04)**: Rename to "Drag and Drop Sort", add context-menu and command-palette sort commands, and fix explorer drop handling and defensive drop guards.
- **0.12.0-alpha (2026-06-09)**: Remove modifier-key behavior, add cross-folder insertion and empty/collapsed-folder drop targets.
- **0.11.0-alpha (2026-06-08)**: Handle rename remapping so custom orders remain aligned with renamed files and folders.
- **0.1.0-alpha (2026-06-08)**: Provide the initial Custom Sort plugin with custom file and folder ordering.

## Installation

### Manual

1. Build the plugin:

  ```bash
  cd src/drag-drop-sort
  npm install
  npm run build
  ```

2. Copy `dist/main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/drag-drop-sort/`.

3. Enable **Drag and Drop Sort** under **Settings > Community plugins**.

## Usage

Drag any file or folder in the File explorer. A blue drop indicator shows where the item will land; release to commit the new order. Dropping between rows in another folder moves the item into that folder at that position.

You can also right-click an item and use **Drag and Drop Sort commands** to move it up, down, to the top, or to the bottom. Right-click a folder and choose **Reset sort** to remove that folder's saved order, or **Reset sort (all descendants)** to remove the folder's order and all custom orders below it.

## How it Works

The plugin patches `getSortedFolderItems()` on the internal File explorer view, makes visible tree items draggable, and saves each changed folder's order to `data.json`. Dropping across folders also moves the item through Obsidian's file manager. Hidden rows and unsupported file types are excluded from positional calculations so the drop position matches what is visible.

### Data Format

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

## Acknowledgements

Drag and Drop Sort is an independent implementation based on the architecture and patterns of [Folder Sort Rules](https://github.com/wepee/obsidian-folder-sort-rules) by Adam. The `getSortedFolderItems` monkey-patch and per-item drag handler pattern are adapted from that MIT-licensed codebase.

## License

This project is licensed under the MIT License.
