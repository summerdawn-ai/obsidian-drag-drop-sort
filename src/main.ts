/* eslint-disable @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- Obsidian's public API contains intentionally untyped internals; the plugin narrows them at its boundaries. */
import {
	Menu,
	Platform,
	Plugin,
	TAbstractFile,
	TFolder,
	WorkspaceLeaf,
} from 'obsidian';
import { CustomSortSettings, DEFAULT_SETTINGS, FileExplorerItem, FileExplorerView } from './types';
import { sortItems } from './sorter';
import { DragHandler } from './drag-handler';

interface MenuItemWithSubmenu {
	setSubmenu(): Menu;
}

interface FileExplorerViewLike {
	tree?: {
		focusedItem?: {
			file?: TAbstractFile | null;
		} | null;
	};
	activeDom?: {
		file?: TAbstractFile | null;
	} | null;
}

type MoveAction = 'up' | 'down' | 'top' | 'bottom';

const MOVE_ACTIONS: Array<{
	action: MoveAction;
	title: string;
	icon: string;
}> = [
	{ action: 'up', title: 'Move up', icon: 'arrow-up' },
	{ action: 'down', title: 'Move down', icon: 'arrow-down' },
	{ action: 'top', title: 'Move to top', icon: 'arrow-up-to-line' },
	{ action: 'bottom', title: 'Move to bottom', icon: 'arrow-down-to-line' },
];

/**
 * Monkey-patch a method on an object's prototype.
 * Returns an uninstaller function.
 */
type PrototypeTarget = { constructor: { prototype: Record<string, unknown> } };
type ExplorerMethod = (this: FileExplorerView, folder: TFolder) => FileExplorerItem[];

function patchPrototype(
	obj: PrototypeTarget,
	methodName: string,
	factory: (original: ExplorerMethod) => ExplorerMethod
): () => void {
	// Obsidian recreates views during layout changes, so patch the shared
	// prototype and return the exact inverse operation for plugin unload.
	const proto = obj.constructor.prototype;
	const original = proto[methodName];
	if (typeof original !== 'function') return () => undefined;
	proto[methodName] = factory(original as ExplorerMethod);
	return () => {
		proto[methodName] = original;
	};
}

export default class CustomSortPlugin extends Plugin {
	settings: CustomSortSettings = DEFAULT_SETTINGS;
	private uninstallPatch: (() => void) | null = null;
	private dragHandler: DragHandler;
	private dragSetupTimer: number | null = null;
	private patched = false;
	private internalMoveDepth = 0;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.dragHandler = new DragHandler(this);

		// File explorer internals are not available until Obsidian has finished
		// constructing the workspace layout.
		this.app.workspace.onLayoutReady(() => {
			this.patchFileExplorer();
		});

		// Re-sort / re-setup drag when vault changes
		this.registerEvent(
			this.app.vault.on('create', () => this.requestSort())
		);
		this.registerEvent(
			this.app.vault.on('delete', () => this.requestSort())
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (this.internalMoveDepth > 0) {
					this.requestSort();
					return;
				}
				void this.handleRename(file, oldPath);
			})
		);

		// Re-patch if layout changes (e.g. File explorer re-opened)
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				if (!this.patched) {
					this.patchFileExplorer();
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file, source) => {
				if (source !== 'file-explorer-context-menu') return;
				this.addFileMenuItems(menu, file);
			})
		);

		this.registerSortCommands();
	}

	onunload(): void {
		if (this.uninstallPatch) {
			this.uninstallPatch();
			this.uninstallPatch = null;
		}
		if (this.dragSetupTimer !== null) {
			window.clearTimeout(this.dragSetupTimer);
		}
		this.dragHandler.cleanup();
		this.patched = false;

		// Trigger re-sort to restore default order
		const leaf = this.getFileExplorerLeaf();
		if (leaf) {
			(leaf.view as unknown as FileExplorerView).requestSort?.();
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.requestSort();
	}

	/** Get the File explorer leaf (public for DragHandler). */
	getFileExplorerLeaf(): WorkspaceLeaf | null {
		const leaves = this.app.workspace.getLeavesOfType('file-explorer');
		return leaves.length > 0 ? leaves[0] : null;
	}

	/** Request a re-sort of the File explorer and re-setup drag handlers. */
	requestSort(): void {
		const leaf = this.getFileExplorerLeaf();
		if (leaf) {
			(leaf.view as unknown as FileExplorerView).requestSort?.();
		}
		this.scheduleDragSetup();
	}

	// ─── Patching ────────────────────────────────────────────

	private patchFileExplorer(): void {
		const leaf = this.getFileExplorerLeaf();
		if (!leaf) return;

		const view = leaf.view as unknown as FileExplorerView & PrototypeTarget;
		if (!view || typeof view.getSortedFolderItems !== 'function') {
			return;
		}

		if (this.patched) return;

		const getPlugin = (): CustomSortPlugin => this;

		this.uninstallPatch = patchPrototype(
			view,
			'getSortedFolderItems',
			(original) =>
				function (this: FileExplorerView, folder: TFolder) {
					const items = original.call(this, folder);
					const plugin = getPlugin();

					// Preserve Obsidian's normal ordering whenever this folder has no
					// saved custom order.
					const order = plugin.settings.orders[folder.path];
					if (!order || order.length === 0) return items;

					return plugin.sortExplorerItems(items, order);
				}
		);

		this.patched = true;

		this.register(() => {
			if (this.uninstallPatch) {
				this.uninstallPatch();
				this.uninstallPatch = null;
				this.patched = false;
			}
		});

		// Trigger initial sort
		view.requestSort?.();
		this.scheduleDragSetup();
	}

	private scheduleDragSetup(): void {
		if (this.dragSetupTimer !== null) {
			window.clearTimeout(this.dragSetupTimer);
		}
		this.dragSetupTimer = window.setTimeout(() => {
			this.dragSetupTimer = null;
			const leaf = this.getFileExplorerLeaf();
			if (leaf) {
				this.dragHandler.setup(leaf.view as unknown as FileExplorerView);
			}
		}, 100);
	}

	/** Sort items using custom order — interspersed files & folders. */
	sortExplorerItems(items: FileExplorerItem[], order: string[]): FileExplorerItem[] {
		return sortItems(items, order);
	}

	private registerSortCommands(): void {
		for (const moveAction of MOVE_ACTIONS) {
			this.addCommand({
				id: `move-${moveAction.action}`,
				name: moveAction.title,
				checkCallback: (checking) =>
					this.runMoveCommand(moveAction.action, checking),
			});
		}

		this.addCommand({
			id: 'reset-sort',
			name: 'Reset sort',
			checkCallback: (checking) => this.runResetCommand(false, checking),
		});

		this.addCommand({
			id: 'reset-sort-all-descendants',
			name: 'Reset sort (all descendants)',
			checkCallback: (checking) => this.runResetCommand(true, checking),
		});
	}

	private runMoveCommand(action: MoveAction, checking: boolean): boolean {
		const file = this.getActiveExplorerFile();
		const parent = file?.parent;
		if (!file || !parent) return false;

		const availableActions = this.getAvailableMoveActions(file, parent);
		if (!availableActions.some((moveAction) => moveAction.action === action)) {
			return false;
		}

		if (!checking) {
			// checkCallback is called once to enable the command and again to run it.
			void this.moveFile(file, action);
		}
		return true;
	}

	private runResetCommand(
		includeChildren: boolean,
		checking: boolean
	): boolean {
		const file = this.getActiveExplorerFile();
		if (!(file instanceof TFolder)) return false;

		if (!checking) {
			void this.resetFolderSort(file, includeChildren);
		}
		return true;
	}

	private getActiveExplorerFile(): TAbstractFile | null {
		const view = this.getFileExplorerLeaf()?.view as
			| FileExplorerViewLike
			| undefined;
		if (!view) return null;

		return view.tree?.focusedItem?.file ?? view.activeDom?.file ?? null;
	}

	private addFileMenuItems(menu: Menu, file: TAbstractFile): void {
		const parent = file.parent;
		const folder = file instanceof TFolder ? file : null;
		const moveActions = parent
			? this.getAvailableMoveActions(file, parent)
			: [];

		if (folder === null && moveActions.length === 0) return;

		menu.addSeparator();

		if (Platform.isDesktop && !Platform.isTablet) {
			menu.addItem((item) => {
				// setSubmenu is available at runtime but is missing from older Obsidian typings.
				const submenu = (item as unknown as MenuItemWithSubmenu).setSubmenu();
				item.setTitle('Drag and Drop Sort commands').setIcon('move');
				this.addSortMenuItems(submenu, file, folder, moveActions);
			});
		} else {
			this.addSortMenuItems(menu, file, folder, moveActions);
		}
	}

	private addSortMenuItems(
		menu: Menu,
		file: TAbstractFile,
		folder: TFolder | null,
		moveActions: typeof MOVE_ACTIONS
	): void {
		if (folder !== null) {
			menu.addItem((item) =>
				item
					.setTitle('Reset sort')
					.setIcon('rotate-ccw')
					.onClick(() => void this.resetFolderSort(folder))
			);

			menu.addItem((item) =>
				item
					.setTitle('Reset sort (all descendants)')
					.setIcon('folder-tree')
					.onClick(() => void this.resetFolderSort(folder, true))
			);

			if (moveActions.length > 0) {
				menu.addSeparator();
			}
		}

		for (const moveAction of moveActions) {
			menu.addItem((item) =>
				item
					.setTitle(moveAction.title)
					.setIcon(moveAction.icon)
					.onClick(() => void this.moveFile(file, moveAction.action))
			);
		}
	}

	private getAvailableMoveActions(
		file: TAbstractFile,
		parent: TFolder
	): typeof MOVE_ACTIONS {
		const order = this.getCurrentOrder(parent);
		const index = order.indexOf(file.name);
		if (index === -1 || order.length < 2) return [];

		return MOVE_ACTIONS.filter(({ action }) => {
			switch (action) {
				case 'up':
				case 'top':
					return index > 0;
				case 'down':
				case 'bottom':
					return index < order.length - 1;
			}
		});
	}

	private getCurrentOrder(parent: TFolder): string[] {
		const children = parent.children.slice();
		const childNames = new Set(children.map((child) => child.name));
		const savedOrder = this.settings.orders[parent.path] ?? [];
		const seen = new Set<string>();
		const orderedNames = savedOrder.filter((name) => {
			// Ignore deleted/renamed children and duplicate persisted entries.
			if (!childNames.has(name) || seen.has(name)) return false;
			seen.add(name);
			return true;
		});

		const unknownFolders = children
			.filter((child) => !seen.has(child.name) && child instanceof TFolder)
			.sort((a, b) => this.compareFileNames(a, b));
		const unknownFiles = children
			.filter((child) => !seen.has(child.name) && !(child instanceof TFolder))
			.sort((a, b) => this.compareFileNames(a, b));

		// Saved names take precedence; new or untracked folders/files retain the
		// same fallback grouping used by the explorer sort implementation.
		return [
			...orderedNames,
			...unknownFolders.map((child) => child.name),
			...unknownFiles.map((child) => child.name),
		];
	}

	private compareFileNames(left: TAbstractFile, right: TAbstractFile): number {
		return left.name.localeCompare(right.name, undefined, {
			sensitivity: 'base',
			numeric: true,
		});
	}

	private async resetFolderSort(
		folder: TFolder,
		includeChildren = false
	): Promise<void> {
		const prefix = `${folder.path}/`;
		const pathsToReset = Object.keys(this.settings.orders).filter(
			(path) =>
				path === folder.path ||
				(includeChildren && path.startsWith(prefix))
		);
		if (pathsToReset.length === 0) return;

		for (const path of pathsToReset) {
			delete this.settings.orders[path];
		}
		await this.saveSettings();
	}

	private async moveFile(file: TAbstractFile, action: MoveAction): Promise<void> {
		const parent = file.parent;
		if (!parent) return;

		const order = this.getCurrentOrder(parent);
		const currentIndex = order.indexOf(file.name);
		if (currentIndex === -1 || order.length < 2) return;

		let targetIndex = currentIndex;
		switch (action) {
			case 'up':
				targetIndex -= 1;
				break;
			case 'down':
				targetIndex += 1;
				break;
			case 'top':
				targetIndex = 0;
				break;
			case 'bottom':
				targetIndex = order.length - 1;
				break;
		}

		if (targetIndex === currentIndex) return;

		// Work from the complete effective order so moving an untracked item also
		// creates a stable persisted order for the folder.
		order.splice(currentIndex, 1);
		order.splice(targetIndex, 0, file.name);
		this.settings.orders[parent.path] = order;
		await this.saveSettings();
	}

	/** Mark beginning of plugin-controlled move operation. */
	beginInternalMove(): void {
		this.internalMoveDepth += 1;
	}

	/** Mark end of plugin-controlled move operation. */
	endInternalMove(): void {
		this.internalMoveDepth = Math.max(0, this.internalMoveDepth - 1);
	}

	/**
	 * Keep custom order stable when Obsidian renames/moves items.
	 *
	 * - Rename in same parent: replace old item name with new item name at same index.
	 * - Move to different parent: remove from old parent order and append to new parent order (if present).
	 * - Folder rename/move: also remap order keys for the folder path and its descendants.
	 */
	private async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
		const newPath = file.path;
		const oldParent = this.getParentPath(oldPath);
		const newParent = this.getParentPath(newPath);
		const oldName = this.getBaseName(oldPath);
		const newName = file.name;

		let changed = false;

		const oldOrder = this.settings.orders[oldParent];
		if (oldOrder && oldOrder.length > 0) {
			const idx = oldOrder.indexOf(oldName);
			if (idx !== -1) {
				if (oldParent === newParent) {
					oldOrder[idx] = newName;
				} else {
					oldOrder.splice(idx, 1);
					if (oldOrder.length === 0) {
						delete this.settings.orders[oldParent];
					}
				}
				changed = true;
			}
		}

		if (oldParent !== newParent) {
			const newOrder = this.settings.orders[newParent];
			if (newOrder && !newOrder.includes(newName)) {
				newOrder.push(newName);
				changed = true;
			}
		}

		if (file instanceof TFolder) {
			const remappedOrders: Record<string, string[]> = {};
			let remapped = false;

			for (const [key, value] of Object.entries(this.settings.orders)) {
				if (key === oldPath || key.startsWith(oldPath + '/')) {
					const suffix = key.slice(oldPath.length);
					remappedOrders[newPath + suffix] = value;
					remapped = true;
				} else {
					remappedOrders[key] = value;
				}
			}

			if (remapped) {
				this.settings.orders = remappedOrders;
				changed = true;
			}
		}

		if (changed) {
			await this.saveSettings();
		} else {
			this.requestSort();
		}
	}

	private getParentPath(path: string): string {
		const idx = path.lastIndexOf('/');
		return idx === -1 ? '' : path.substring(0, idx);
	}

	private getBaseName(path: string): string {
		const idx = path.lastIndexOf('/');
		return idx === -1 ? path : path.substring(idx + 1);
	}
}

/* eslint-enable @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
