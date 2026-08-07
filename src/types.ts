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

export const DEFAULT_SETTINGS: CustomSortSettings = {
	orders: {},
};
