/* eslint-disable @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- Obsidian's public API contains intentionally untyped internals; the plugin narrows them at its boundaries. */
import { TAbstractFile, TFolder } from 'obsidian';
import type CustomSortPlugin from './main';
import type { FileExplorerItem, FileExplorerView } from './types';

interface DragState {
	draggedEl: HTMLElement | null;
	draggedFile: TAbstractFile | null;
	placeholder: HTMLElement | null;
	/** The folder row currently being treated as a direct drop target. */
	folderDropTarget: {
		el: HTMLElement;
		folder: TFolder;
		autoExpanded: boolean;
	} | null;
}

const FOLDER_AUTO_EXPAND_DELAY_MS = 2000;

/**
 * Handles drag-and-drop reordering in the File explorer.
 *
 * Custom drag/drop behavior that supports:
 * - Reordering within a folder (before/after target rows)
 * - Cross-level moves by dropping between rows in another folder
 *
 * File/folder moves are executed through Obsidian's file manager so core
 * rename/move side effects (like link updates) are preserved.
 */
export class DragHandler {
	private plugin: CustomSortPlugin;
	private state: DragState = {
		draggedEl: null,
		draggedFile: null,
		placeholder: null,
		folderDropTarget: null,
	};
	private cleanupFns: (() => void)[] = [];
	private folderExpandTimer: number | null = null;
	/** Map of parentPath -> set of visible child names (from rendered explorer rows). */
	private visibleByParent: Map<string, Set<string>> = new Map();
	/** Map of parentPath -> visible child names in their rendered DOM order. */
	private visibleOrderByParent: Map<string, string[]> = new Map();

	constructor(plugin: CustomSortPlugin) {
		this.plugin = plugin;
	}

	/**
	 * Set up drag-and-drop on all items in the File explorer.
	 */
	setup(explorerView: FileExplorerView): void {
		this.cleanup();

		// Rebind to the current view because Obsidian may replace its row elements
		// after a refresh or layout change.
		const fileItems = explorerView.fileItems;
		if (!fileItems) return;

		const explorerEl = explorerView.containerEl?.querySelector<HTMLElement>(
			'.nav-files-container'
		);
		if (explorerEl) {
			const onExplorerDragOver = (e: DragEvent) => {
				if (!this.state.draggedFile) return;

				// Capture events on the container so drops in gaps between rows work too.
				const rowTarget = this.resolveRowTarget(e);
				if (rowTarget) {
					this.handleDragOver(e, rowTarget.el, rowTarget.file);
					return;
				}

				const target = this.resolveGapTarget(e);
				if (!target) return;

				if (
					this.isSameFile(this.state.draggedFile, target.file) ||
					!this.canDropOnTarget(this.state.draggedFile, target.file)
				) {
					this.suppressInvalidDrag(e);
					return;
				}

				e.preventDefault();
				e.stopImmediatePropagation();
				if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
				this.showPlaceholder(target.el, target.insertBefore);
			};

			const onExplorerDragEnter = (e: DragEvent) => {
				if (!this.state.draggedFile) return;

				const rowTarget = this.resolveRowTarget(e);
				if (rowTarget) {
					this.handleDragOver(e, rowTarget.el, rowTarget.file);
					return;
				}

				const target = this.resolveGapTarget(e);
				if (!target) return;

				if (
					this.isSameFile(this.state.draggedFile, target.file) ||
					!this.canDropOnTarget(this.state.draggedFile, target.file)
				) {
					this.suppressInvalidDrag(e);
					return;
				}

				e.preventDefault();
				e.stopImmediatePropagation();
				if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
				this.showPlaceholder(target.el, target.insertBefore);
			};

			const onExplorerDrop = (e: DragEvent) => {
				void (async () => {
				if (!this.state.draggedFile) return;

				const rowTarget = this.resolveRowTarget(e);
				if (rowTarget) {
					const rect = rowTarget.el.getBoundingClientRect();
					await this.handleDrop(
						e,
						rowTarget.el,
						rowTarget.file,
						e.clientY < rect.top + rect.height / 2
					);
					return;
				}

				const target = this.resolveGapTarget(e);
				if (!target) return;

				if (
					this.isSameFile(this.state.draggedFile, target.file) ||
					!this.canDropOnTarget(this.state.draggedFile, target.file)
				) {
					this.suppressInvalidDrag(e);
					return;
				}

				e.preventDefault();
				e.stopImmediatePropagation();
				await this.handleDrop(e, target.el, target.file, target.insertBefore);
				})();
			};

			explorerEl.addEventListener('dragenter', onExplorerDragEnter, true);
			explorerEl.addEventListener('dragover', onExplorerDragOver, true);
			explorerEl.addEventListener('drop', onExplorerDrop, true);
			this.cleanupFns.push(() => {
				explorerEl.removeEventListener('dragenter', onExplorerDragEnter, true);
				explorerEl.removeEventListener('dragover', onExplorerDragOver, true);
				explorerEl.removeEventListener('drop', onExplorerDrop, true);
			});
		}

		this.captureVisibleOrder(fileItems);

		const childrenByParent = new Map<string, { item: FileExplorerItem; el: HTMLElement }[]>();

		for (const item of Object.values(fileItems)) {
			if (!item || !item.file || !item.selfEl) continue;
			if (item.file.path === '') continue;

			const parentPath: string = item.file.parent?.path ?? '';

			if (!childrenByParent.has(parentPath)) {
				childrenByParent.set(parentPath, []);
			}
			childrenByParent.get(parentPath)!.push({
				item,
				el: item.selfEl as HTMLElement,
			});
		}

		for (const [, children] of childrenByParent) {
			for (const { item, el } of children) {
				this.setupItemDrag(el, item, fileItems);
			}
		}
	}

	private captureVisibleOrder(fileItems: Record<string, FileExplorerItem>): void {
		this.visibleByParent.clear();
		this.visibleOrderByParent.clear();
		const visibleChildrenByParent = new Map<
			string,
			{ name: string; el: HTMLElement }[]
		>();
		for (const item of Object.values(fileItems)) {
			if (!item || !item.file || !item.selfEl) continue;
			if (item.file.path === '') continue;
			const itemEl = item.selfEl as HTMLElement;
			if (itemEl.offsetParent === null) continue;

			const parentPath: string = item.file.parent?.path ?? '';
			if (!this.visibleByParent.has(parentPath)) {
				this.visibleByParent.set(parentPath, new Set());
			}
			this.visibleByParent.get(parentPath)!.add(item.file.name);
			if (!visibleChildrenByParent.has(parentPath)) {
				visibleChildrenByParent.set(parentPath, []);
			}
			visibleChildrenByParent.get(parentPath)!.push({
				name: item.file.name,
				el: itemEl,
			});
		}

		for (const [parentPath, children] of visibleChildrenByParent) {
			children.sort((a, b) => {
				if (a.el === b.el) return 0;
				return a.el.compareDocumentPosition(b.el) &
					Node.DOCUMENT_POSITION_FOLLOWING
					? -1
					: 1;
			});
			this.visibleOrderByParent.set(
				parentPath,
				children.map((child) => child.name)
			);
		}
	}

	private setupItemDrag(
		el: HTMLElement,
		item: FileExplorerItem,
		fileItems: Record<string, FileExplorerItem>
	): void {
		el.addClass('drag-drop-sort-draggable');

		const file: TAbstractFile = item.file;

		const onDragStart = (e: DragEvent) => {
			// Store the source independently of the DOM row; the row can move while
			// the pointer is being dragged.
			this.captureVisibleOrder(fileItems);
			this.state.draggedEl = el;
			this.state.draggedFile = file;
			this.removePlaceholder();
			this.clearFolderDropTarget();
			el.addClass('drag-drop-sort-dragging');
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = 'move';
				e.dataTransfer.setData('text/plain', file.path);
			}
		};

		const onDragEnd = () => {
			el.removeClass('drag-drop-sort-dragging');
			this.removePlaceholder();
			this.clearFolderDropTarget();
			this.state.draggedEl = null;
			this.state.draggedFile = null;
		};

		const onDragOver = (e: DragEvent) => {
			this.handleDragOver(e, el, file);
		};

		const onDrop = (e: DragEvent) => {
			void (async () => {
			if (!this.state.draggedFile) return;
			if (this.isSameFile(this.state.draggedFile, file)) return;

			const rect = el.getBoundingClientRect();
			const insertBefore = e.clientY < rect.top + rect.height / 2;
			await this.handleDrop(e, el, file, insertBefore);
			})();
		};

		el.addEventListener('dragstart', onDragStart);
		el.addEventListener('dragend', onDragEnd);
		// Run before Obsidian's row handlers so folder rows cannot claim the drop.
		el.addEventListener('dragover', onDragOver, true);
		el.addEventListener('drop', onDrop, true);

		this.cleanupFns.push(() => {
			el.removeEventListener('dragstart', onDragStart);
			el.removeEventListener('dragend', onDragEnd);
			el.removeEventListener('dragover', onDragOver, true);
			el.removeEventListener('drop', onDrop, true);
			el.removeClass('drag-drop-sort-draggable');
		});
	}

	private resolveRowTarget(
		e: DragEvent
	): { el: HTMLElement; file: TAbstractFile } | null {
		const target = e.targetNode?.instanceOf(Element) ? e.targetNode : null;
		const el = target?.instanceOf(HTMLElement)
			? target.closest('.tree-item-self')
			: null;
		if (!el?.instanceOf(HTMLElement)) return null;

		const row = el.closest('.tree-item');
		if (!row?.instanceOf(HTMLElement)) return null;

		const file = this.getFileForRow(row);
		return file ? { el, file } : null;
	}

	private resolveGapTarget(
		e: DragEvent
	): {
		row: HTMLElement;
		el: HTMLElement;
		file: TAbstractFile;
		insertBefore: boolean;
	} | null {
		const placeholder = this.state.placeholder;
		if (placeholder?.parentElement) {
			// Once shown, the placeholder is the most reliable indication of which
			// side of a row the user intends to insert on.
			const next = placeholder.nextElementSibling;
			const previous = placeholder.previousElementSibling;
			const row =
				next?.instanceOf(HTMLElement) && next.classList.contains('tree-item')
					? next
					: previous?.instanceOf(HTMLElement) &&
						  previous.classList.contains('tree-item')
						? previous
						: null;
			if (row) {
				const file = this.getFileForRow(row);
				if (file) {
					return {
						row,
						el: row.querySelector('.tree-item-self') as HTMLElement,
						file,
						insertBefore: row === next,
					};
				}
			}
		}

		const target = e.targetNode?.instanceOf(Element) ? e.targetNode : null;
		const children = target?.closest('.tree-item-children');
		if (!children) return null;

		const rows = Array.from(children.children).filter(
			(child): child is HTMLElement =>
				child.instanceOf(HTMLElement) && child.classList.contains('tree-item')
		);
		for (const row of rows) {
			// Use row midpoints to turn a continuous pointer position into a stable
			// before/after insertion choice.
			const self = row.querySelector('.tree-item-self');
			if (!self?.instanceOf(HTMLElement)) continue;
			const rect = self.getBoundingClientRect();
			if (e.clientY < rect.top + rect.height / 2) {
				const file = this.getFileForRow(row);
				const el = row.querySelector('.tree-item-self');
				return file && el?.instanceOf(HTMLElement)
					? { row, el, file, insertBefore: true }
					: null;
			}
		}

		const row = rows.at(-1);
		if (!row) return null;
		const file = this.getFileForRow(row);
		const el = row.querySelector('.tree-item-self');
		return file && el?.instanceOf(HTMLElement)
			? { row, el, file, insertBefore: false }
			: null;
	}

	private getFileForRow(row: HTMLElement): TAbstractFile | null {
		const path = row.querySelector('.tree-item-self')?.getAttribute('data-path');
		const file = path ? this.plugin.app.vault.getAbstractFileByPath(path) : null;
		return file ?? null;
	}

	private handleDragOver(
		e: DragEvent,
		el: HTMLElement,
		file: TAbstractFile
	): void {
		if (!this.state.draggedFile) return;

		e.preventDefault();
		e.stopImmediatePropagation();

		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

		if (
			this.isSameFile(this.state.draggedFile, file) ||
			!this.canDropOnTarget(this.state.draggedFile, file)
		) {
			this.removePlaceholder();
			this.clearFolderDropTarget();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
			return;
		}

		if (
			file instanceof TFolder &&
			this.isFolderEmptyOrCollapsed(el, file)
		) {

			this.removePlaceholder();
			this.setFolderDropTarget(el, file);
			return;
		}

		if (
			file instanceof TFolder &&
			this.state.folderDropTarget?.el === el &&
			this.state.folderDropTarget.autoExpanded
		) {
			this.removePlaceholder();
			return;
		}

		const firstChildTarget = this.getFirstChildTarget(el, file, e.clientY);
		if (firstChildTarget) {
			this.clearFolderDropTarget();
			this.showPlaceholder(firstChildTarget.el, true);
			return;
		}

		if (!this.canDropOnTarget(this.state.draggedFile, file)) return;

		this.clearFolderDropTarget();
		const rect = el.getBoundingClientRect();
		this.showPlaceholder(el, e.clientY < rect.top + rect.height / 2);
	}

	private suppressInvalidDrag(e: DragEvent): void {
		e.preventDefault();
		e.stopImmediatePropagation();
		this.removePlaceholder();
		this.clearFolderDropTarget();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
	}

	private showPlaceholder(row: HTMLElement, insertBefore: boolean): void {
		this.clearFolderDropTarget();

		const existing = this.state.placeholder;
		const alreadyInPosition =
			existing?.parentElement === row.parentElement &&
			(insertBefore
				? existing?.nextElementSibling === row
				: existing?.previousElementSibling === row);
		if (alreadyInPosition) return;

		this.removePlaceholder();
		this.state.placeholder = createDiv({
			cls: 'drag-drop-sort-drop-indicator',
		});
		row.parentElement?.insertBefore(
			this.state.placeholder,
			insertBefore ? row : row.nextSibling
		);
	}

	private async handleDrop(
		e: DragEvent,
		el: HTMLElement,
		file: TAbstractFile,
		insertBefore: boolean
	): Promise<void> {
		e.preventDefault();
		e.stopImmediatePropagation();
		this.removePlaceholder();

		const draggedFile = this.state.draggedFile;
		if (!draggedFile) return;

		const draggedName = draggedFile.name;
		const sourceParent = draggedFile.parent?.path ?? '';

		if (
			this.isSameFile(draggedFile, file) ||
			!this.canDropOnTarget(draggedFile, file)
		) {
			this.clearFolderDropTarget();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
			return;
		}

		// An empty or collapsed folder has no child gap to target, so its header
		// represents an explicit move-into-folder operation.
		if (this.state.folderDropTarget !== null) {
			const targetFolder = this.state.folderDropTarget.folder;

			if (!this.canDropOnTarget(draggedFile, file)) return;
			if (!this.canMoveToParent(draggedFile, targetFolder.path)) return;

			if (sourceParent !== targetFolder.path) {
				const destinationPath = targetFolder.path
					? `${targetFolder.path}/${draggedName}`
					: draggedName;
				const oldDraggedPath = draggedFile.path;

				this.plugin.beginInternalMove();
				try {
					await this.plugin.app.fileManager.renameFile(
						draggedFile,
						destinationPath
					);
				} catch {
					return;
				} finally {
					this.plugin.endInternalMove();
				}

				if (draggedFile instanceof TFolder) {
					this.remapFolderOrderKeys(oldDraggedPath, draggedFile.path);
				}
			}

			this.applyMoveIntoFolder(sourceParent, targetFolder.path, draggedName);
			this.clearFolderDropTarget();
			await this.plugin.saveSettings();
			this.cleanupStaleOrders();
			return;
		}

		const firstChildTarget = this.getFirstChildTarget(el, file, e.clientY);
		if (firstChildTarget) {
			await this.handleDrop(e, firstChildTarget.el, firstChildTarget.file, true);
			return;
		}

		this.clearFolderDropTarget();
		const destinationParent = file.parent?.path ?? '';

		if (sourceParent !== destinationParent) {
			if (!this.canMoveToParent(draggedFile, destinationParent)) return;
			const oldDraggedPath = draggedFile.path;
			const destinationPath = destinationParent
				? `${destinationParent}/${draggedName}`
				: draggedName;

			this.plugin.beginInternalMove();
			try {
				await this.plugin.app.fileManager.renameFile(
					draggedFile,
					destinationPath
				);
			} catch {
				return;
			} finally {
				this.plugin.endInternalMove();
			}

			if (draggedFile instanceof TFolder) {
				this.remapFolderOrderKeys(oldDraggedPath, draggedFile.path);
			}
		}

		// Update custom order only after the filesystem move succeeds. Obsidian's
		// rename event is suppressed during this plugin-controlled operation.
		this.applyReorder(
			sourceParent,
			destinationParent,
			draggedName,
			file.name,
			insertBefore
		);

		await this.plugin.saveSettings();
		this.cleanupStaleOrders();
	}

	private canDropOnTarget(dragged: TAbstractFile, target: TAbstractFile): boolean {
		const destinationParent = target.parent?.path ?? '';

		// Prevent dropping onto the source itself or into one of its descendants.
		if (dragged.path === destinationParent) return false;
		if (destinationParent.startsWith(dragged.path + '/')) return false;

		return true;
	}

	private isSameFile(
		first: TAbstractFile | null,
		second: TAbstractFile | null
	): boolean {
		return first !== null && second !== null && first.path === second.path;
	}

	// ── Folder-header drop target ────────────────────────────

	private isFolderCollapsed(el: HTMLElement): boolean {
		const row = el.closest('.tree-item');
		return (
			row?.classList.contains('is-collapsed') === true ||
			(row !== null &&
				!row.querySelector(':scope > .tree-item-children'))
		);
	}

	private isFolderEmptyOrCollapsed(
		el: HTMLElement,
		folder: TFolder
	): boolean {
		if (this.isFolderCollapsed(el)) return true;

		// A folder with no rendered children has no row gap to target.
		for (const child of folder.children) {
			if (this.isVisible(folder.path, child.name)) return false;
		}
		return true;
	}

	private setFolderDropTarget(el: HTMLElement, folder: TFolder): void {
		if (this.state.folderDropTarget?.el === el) return; // already active
		this.clearFolderDropTarget();
		el.addClass('drag-drop-sort-drop-folder');
		this.state.folderDropTarget = { el, folder, autoExpanded: false };
		this.scheduleFolderExpansion(el, folder);
	}

	private scheduleFolderExpansion(el: HTMLElement, folder: TFolder): void {
		if (folder.children.length === 0 || !this.isFolderCollapsed(el)) return;

		this.folderExpandTimer = window.setTimeout(() => {
			this.folderExpandTimer = null;
			const target = this.state.folderDropTarget;
			if (
				!this.state.draggedFile ||
				!target ||
				target.el !== el ||
				target.folder !== folder ||
				!this.isFolderCollapsed(el)
			) {
				return;
			}

			const collapseIcon = el.querySelector<HTMLElement>(
				':scope > .collapse-icon'
			);
			if (!collapseIcon) {
				console.warn(
					'Drag and Drop Sort: unable to auto-expand folder without a collapse control.',
					folder.path
				);
				return;
			}

			collapseIcon.click();
			target.autoExpanded = true;
			window.setTimeout(() => this.refreshVisibleOrder(), 0);
		}, FOLDER_AUTO_EXPAND_DELAY_MS);
	}

	private clearFolderDropTarget(): void {
		if (this.folderExpandTimer !== null) {
			window.clearTimeout(this.folderExpandTimer);
			this.folderExpandTimer = null;
		}
		if (this.state.folderDropTarget) {
			this.state.folderDropTarget.el.removeClass('drag-drop-sort-drop-folder');
			this.state.folderDropTarget = null;
		}
	}

	private getFirstChildTarget(
		el: HTMLElement,
		file: TAbstractFile,
		clientY: number
	): { el: HTMLElement; file: TAbstractFile } | null {
		if (!(file instanceof TFolder) || this.isFolderEmptyOrCollapsed(el, file)) {
			return null;
		}

		const rect = el.getBoundingClientRect();
		if (clientY < rect.top + rect.height / 2) return null;

		const row = el.closest('.tree-item');
		const childRows = row?.querySelector(':scope > .tree-item-children');
		if (!childRows) return null;

		for (const child of Array.from(childRows.children)) {
			if (
				!child.instanceOf(HTMLElement) ||
				!child.classList.contains('tree-item') ||
				!child.offsetParent
			) {
				continue;
			}

			const childEl = child.querySelector(':scope > .tree-item-self');
			const childFile = this.getFileForRow(child);
			if (childEl?.instanceOf(HTMLElement) && childFile) {
				return { el: childEl, file: childFile };
			}
		}

		return null;
	}

	private refreshVisibleOrder(): void {
		const leaf = this.plugin.getFileExplorerLeaf();
		if (!leaf) return;

		const view = leaf.view as unknown as FileExplorerView;
		if (view.fileItems) {
			this.captureVisibleOrder(view.fileItems);
		}
	}

	private applyMoveIntoFolder(
		sourceParent: string,
		targetFolderPath: string,
		draggedName: string
	): void {
		if (sourceParent === targetFolderPath) return;

		const sourceWorking = this.getWorkingOrder(sourceParent).filter(
			(name) => name !== draggedName
		);
		if (sourceWorking.length > 0) {
			this.plugin.settings.orders[sourceParent] = this.mergeHiddenBack(
				sourceParent,
				sourceWorking
			);
		} else {
			delete this.plugin.settings.orders[sourceParent];
		}
	}

	private canMoveToParent(dragged: TAbstractFile, destinationParent: string): boolean {
		if (dragged.path === destinationParent) return false;
		if (destinationParent.startsWith(dragged.path + '/')) return false;
		return true;
	}

	private applyReorder(
		sourceParent: string,
		destinationParent: string,
		draggedName: string,
		targetName: string,
		insertBefore: boolean
	): void {
		if (sourceParent !== destinationParent) {
			const sourceWorking = this.getWorkingOrder(sourceParent).filter(
				(name) => name !== draggedName
			);
			if (sourceWorking.length > 0) {
				this.plugin.settings.orders[sourceParent] = this.mergeHiddenBack(
					sourceParent,
					sourceWorking
				);
			} else {
				delete this.plugin.settings.orders[sourceParent];
			}
		}

		const destinationWorking = this.getWorkingOrder(destinationParent).filter(
			(name) => name !== draggedName
		);

		const targetIdx = destinationWorking.indexOf(targetName);
		if (targetIdx === -1) {
			destinationWorking.push(draggedName);
		} else if (insertBefore) {
			destinationWorking.splice(targetIdx, 0, draggedName);
		} else {
			destinationWorking.splice(targetIdx + 1, 0, draggedName);
		}

		this.plugin.settings.orders[destinationParent] = this.mergeHiddenBack(
			destinationParent,
			destinationWorking
		);
	}

	private getWorkingOrder(parentPath: string): string[] {
		const order = this.plugin.settings.orders[parentPath] ?? [];
		const visibleChildren = this.getVisibleChildren(parentPath);

		// Reorder only rendered children; hidden rows are merged back later so a
		// filtered explorer view cannot accidentally discard their positions.
		const working = order.filter(
			(name) => this.isVisible(parentPath, name) && visibleChildren.includes(name)
		);

		for (const child of visibleChildren) {
			if (!working.includes(child)) {
				working.push(child);
			}
		}

		return working;
	}

	private getVisibleChildren(parentPath: string): string[] {
		const folder = this.plugin.app.vault.getFolderByPath(parentPath);
		if (!folder) return [];

		const renderedOrder = this.visibleOrderByParent.get(parentPath);
		if (renderedOrder) return renderedOrder;

		return folder.children
			.map((c) => c.name)
			.filter((name) => this.isVisible(parentPath, name));
	}

	private isVisible(parentPath: string, name: string): boolean {
		return this.visibleByParent.get(parentPath)?.has(name) ?? true;
	}

	private remapFolderOrderKeys(oldPath: string, newPath: string): void {
		const remapped: Record<string, string[]> = {};
		// Folder moves change every descendant path, not just the moved folder's key.
		for (const [key, value] of Object.entries(this.plugin.settings.orders)) {
			if (key === oldPath || key.startsWith(oldPath + '/')) {
				const suffix = key.slice(oldPath.length);
				remapped[newPath + suffix] = value;
			} else {
				remapped[key] = value;
			}
		}
		this.plugin.settings.orders = remapped;
	}

	/**
	 * After reordering visible items, merge hidden items back at their
	 * original relative positions so they don't get lost.
	 */
	private mergeHiddenBack(
		parentPath: string,
		visibleOrder: string[]
	): string[] {
		const folder = this.plugin.app.vault.getFolderByPath(parentPath);
		if (!folder) return visibleOrder;

		const result = [...visibleOrder];
		const visibleSet = new Set(visibleOrder);

		// Walk original folder.children order; for each hidden item,
		// insert it at the correct logical position.
		let insertOffset = 0;
		for (const child of folder.children) {
			if (!visibleSet.has(child.name)) {
				// Hidden item — insert it at its natural position, but
				// relative to the visible items. Use insertOffset which
				// tracks how many hidden items we've already inserted.
				const idx = Math.min(result.length, insertOffset++);
				result.splice(idx, 0, child.name);
			} else {
				// Track where the next hidden item would go
				insertOffset = result.indexOf(child.name) + 1;
			}
		}

		return result;
	}

	/** Remove order entries for deleted/moved items. */
	private cleanupStaleOrders(): void {
		// Rename/delete events can leave persisted entries behind; prune them after
		// a drag operation while the vault has its final paths.
		for (const [path, order] of Object.entries(this.plugin.settings.orders)) {
			const folder = this.plugin.app.vault.getFolderByPath(path);
			if (!folder) {
				delete this.plugin.settings.orders[path];
				continue;
			}
			const names = new Set(folder.children.map((c) => c.name));
			const cleaned = order.filter((n) => names.has(n));
			if (cleaned.length !== order.length) {
				if (cleaned.length === 0) {
					delete this.plugin.settings.orders[path];
				} else {
					this.plugin.settings.orders[path] = cleaned;
				}
			}
		}
	}

	private removePlaceholder(): void {
		if (this.state.placeholder) {
			this.state.placeholder.remove();
			this.state.placeholder = null;
		}
		for (const indicator of Array.from(
			document.querySelectorAll('.drag-drop-sort-drop-indicator')
		)) {
			indicator.remove();
		}
	}

	cleanup(): void {
		this.removePlaceholder();
		this.clearFolderDropTarget();
		this.state.draggedEl = null;
		this.state.draggedFile = null;
		for (const fn of this.cleanupFns) {
			fn();
		}
		this.cleanupFns = [];
		this.visibleByParent.clear();
		this.visibleOrderByParent.clear();
	}
}

/* eslint-enable @typescript-eslint/no-redundant-type-constituents, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- End the documented Obsidian API boundary exception. */
