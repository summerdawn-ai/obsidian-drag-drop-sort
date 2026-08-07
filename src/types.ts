/**
 * Data format stored in data.json:
 * { "orders": { "folderPath": ["name1", "name2", ...] } }
 * 
 * Each entry is an array of item names (both files and folders) in the desired order.
 * Items not in the list appear at the end: folders first (alphabetical), then files (alphabetical).
 */
export interface CustomSortSettings {
	orders: Record<string, string[]>;
}

/** The stable part of Obsidian's internal File explorer row model we use. */
export interface FileExplorerItem {
	file: import('obsidian').TAbstractFile & { isRoot?: () => boolean };
	selfEl: HTMLElement;
}

/** The stable part of Obsidian's internal File explorer view we use. */
export interface FileExplorerView {
	containerEl: HTMLElement;
	fileItems: Record<string, FileExplorerItem>;
	getSortedFolderItems?: (folder: import('obsidian').TFolder) => FileExplorerItem[];
	requestSort?: () => void;
}

export const DEFAULT_SETTINGS: CustomSortSettings = {
	orders: {},
};
