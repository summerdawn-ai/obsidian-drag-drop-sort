import { TFile, TFolder } from 'obsidian';

/**
 * Sort an array of Obsidian File explorer items according to the custom order.
 * Files and folders are interspersed.
 *
 * Items in the order array come first in their listed order.
 * Items NOT in the order array come after: folders first (alphabetical), then files (alphabetical).
 */
export function sortItems(
	items: any[],
	order: string[]
): any[] {
	if (order.length === 0) return items;

	const orderMap = new Map<string, number>();
	// Map names to positions once so each explorer item can be classified in O(1).
	for (let i = 0; i < order.length; i++) {
		orderMap.set(order[i], i);
	}

	const inOrder: any[] = [];
	const unknownFolders: any[] = [];
	const unknownFiles: any[] = [];

	for (const item of items) {
		if (!item || !item.file) continue;
		const name = item.file.name;
		const pos = orderMap.get(name);
		if (pos !== undefined) {
			inOrder.push({ item, pos });
		} else if (item.file instanceof TFolder) {
			unknownFolders.push(item);
		} else if (item.file instanceof TFile) {
			unknownFiles.push(item);
		}
	}

	// Known items retain the user's explicit order, regardless of file type.
	inOrder.sort((a, b) => a.pos - b.pos);

	// Unknown items use Obsidian-like fallback grouping: folders first, files second.
	unknownFolders.sort((a, b) =>
		a.file.name.localeCompare(b.file.name, undefined, { sensitivity: 'base', numeric: true })
	);
	unknownFiles.sort((a, b) =>
		a.file.name.localeCompare(b.file.name, undefined, { sensitivity: 'base', numeric: true })
	);

	return [
		...inOrder.map((x) => x.item),
		...unknownFolders,
		...unknownFiles,
	];
}

/**
 * Rebuild the order array for a folder after a drag-and-drop operation.
 * Simply snapshot the current visual order of all items in the folder.
 */
export function buildOrderFromItems(items: any[]): string[] {
	// The explorer rows are already in visual order, so a snapshot is enough.
	return items
		.filter((item) => item && item.file)
		.map((item) => item.file.name);
}
