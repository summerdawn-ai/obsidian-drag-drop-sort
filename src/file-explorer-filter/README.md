# File Explorer Filter

Extension for Obsidian to provide filtering on top-level folders in the File explorer.

## Overview

File Explorer Filter adds a filter button to Obsidian's File explorer to switch the view between All folders or one specific top-level folder. Switch context without maintaining multiple notebooks - like OneNote sections.

### Features

- **Switch Folder Context**: Easily switch visual context between folders while staying in the same notebook.
- **Completed Notes**: Hide completed notes using a customizable pattern, such as `[DONE]`.
- **CSS-Based**: Use filtering alongside other File explorer plugins, including Drag and Drop Sort.
- **Non-Destructive**: Keep hidden items available through search, links, backlinks, and the quick switcher.

### Version History

- **1.0.2 (2026-08-06)**: Update the README to reference the main source repository.
- **1.0.1 (2026-08-06)**: Correct the marketplace description and capitalization.
- **1.0.0 (2026-08-04)**: Fix initialization and virtual-scroll layout invalidation after filtering and scope changes.
- **0.1.0-alpha (2026-06-09)**: Initial version with folder filter and configurable name filtering.

## Installation

### Community Plugins

Open **Settings → Community plugins → Browse**, search for **File Explorer Filter**, then select **Install** and **Enable**.

### Manual

1. Build the plugin:

  ```bash
  cd src/file-explorer-filter # Use `cd src` in the release repository
  npm install
  npm run build
  ```

2. Copy `dist/main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/file-explorer-filter/`.

3. Enable **File Explorer Filter** under **Settings > Community plugins**.

## Usage

Select the filter icon in the File explorer toolbar, then choose **All folders** or a top-level folder such as **Career**. You can independently toggle **Hide names containing "[DONE]"**.

Under **Settings > File Explorer Filter**, enable or disable the name-filter menu option and replace `[DONE]` with any non-empty text. Name matching is case-insensitive and can occur anywhere in a file or folder name; empty or whitespace-only settings are rejected.

You can also use the command palette commands **File Explorer Filter: Show File Explorer Filter menu** and **File Explorer Filter: Toggle files and folders matching the name filter**.


## How it Works

When the plugin loads, it waits for the workspace layout and then applies the saved folder and name filters to every File explorer view. It also reruns this setup when Obsidian rebuilds the explorer, and refreshes the view when files are created, deleted, or renamed.

The filter keeps explorer rows in the DOM and applies a CSS class to rows outside the selected folder or matching the configured name pattern. When the filter changes, the view is refreshed; switching folders also invalidates Obsidian's virtual-scroll layout so the visible rows are recalculated immediately. The plugin does not patch `getSortedFolderItems()` or alter vault files, so it remains independent from explorer sorting plugins.

## Resources

- [Main GitHub repository](https://github.com/summerdawn-ai/obsidian-plugins)
- [Releases](https://github.com/summerdawn-ai/obsidian-file-explorer-filter/releases)

## License

This project is licensed under the MIT License.
