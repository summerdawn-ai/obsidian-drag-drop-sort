import { TAbstractFile, TFile, TFolder } from 'obsidian';

/**
 * Sort an array of Obsidian file explorer items according to the custom order
 * for the given folder path. Files and folders are interspersed.
 *
 * Items in the order array come first in their listed order.
 * Items NOT in the order array come after: folders first (alphabetical), then files (alphabetical).
 */
export function sortItems(
	items: any[],
	folderPath: string,
	order: string[]
): any[] {
	if (order.length === 0) return items;

	const orderMap = new Map<string, number>();
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

	// Sort known items by their position in the order array
	inOrder.sort((a, b) => a.pos - b.pos);

	// Sort unknowns: folders alphabetically, then files alphabetically
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
	return items
		.filter((item) => item && item.file)
		.map((item) => item.file.name);
}
