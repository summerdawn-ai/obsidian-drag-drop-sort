import { TAbstractFile, TFolder } from 'obsidian';
import type CustomSortPlugin from './main';

interface DragState {
	draggedEl: HTMLElement | null;
	draggedFile: TAbstractFile | null;
	placeholder: HTMLElement | null;
	/** The folder row currently being treated as a "drop onto folder" target (empty/collapsed). */
	folderDropTarget: { el: HTMLElement; folder: TFolder } | null;
}

/**
 * Handles drag-and-drop reordering in the file explorer.
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
	/** Map of parentPath -> set of visible child names (from rendered explorer rows). */
	private visibleByParent: Map<string, Set<string>> = new Map();

	constructor(plugin: CustomSortPlugin) {
		this.plugin = plugin;
	}

	/**
	 * Set up drag-and-drop on all items in the file explorer.
	 */
	setup(explorerView: any): void {
		this.cleanup();

		const fileItems: Record<string, any> = explorerView.fileItems;
		if (!fileItems) return;

		// Build visible-items map from currently rendered rows.
		this.visibleByParent.clear();
		for (const item of Object.values(fileItems)) {
			if (!item || !item.file || !item.selfEl) continue;
			if (item.file.isRoot?.()) continue;
			const itemEl = item.selfEl as HTMLElement;
			if (itemEl.offsetParent === null) continue;

			const parentPath: string = item.file.parent?.path ?? '';
			if (!this.visibleByParent.has(parentPath)) {
				this.visibleByParent.set(parentPath, new Set());
			}
			this.visibleByParent.get(parentPath)!.add(item.file.name);
		}

		const childrenByParent = new Map<string, { item: any; el: HTMLElement }[]>();

		for (const item of Object.values(fileItems)) {
			if (!item || !item.file || !item.selfEl) continue;
			if (item.file.isRoot?.()) continue;

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
				this.setupItemDrag(el, item);
			}
		}
	}

	private setupItemDrag(el: HTMLElement, item: any): void {
		el.addClass('drag-drop-sort-draggable');

		const file: TAbstractFile = item.file;

		const onDragStart = (e: DragEvent) => {
			this.state.draggedEl = el;
			this.state.draggedFile = file;
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
			if (!this.state.draggedFile) return;
			if (this.state.draggedFile === file) return;

			// Own drag behavior entirely to avoid native expand/move conflicts.
			e.preventDefault();
			e.stopPropagation();

			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'move';
			}

			// ── Empty/collapsed folder: treat the folder row itself as a drop zone ──
			if (file instanceof TFolder && this.isFolderEmptyOrCollapsed(file)) {
				if (!this.canDropOnTarget(this.state.draggedFile, file)) return;

				this.removePlaceholder();
				this.setFolderDropTarget(el, file);
				return;
			}

			// ── Normal between-row indicator ──
			if (!this.canDropOnTarget(this.state.draggedFile, file)) return;

			this.clearFolderDropTarget();

			const rect = el.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;

			this.removePlaceholder();
			this.state.placeholder = createDiv({
				cls: 'drag-drop-sort-drop-indicator',
			});

			if (e.clientY < midY) {
				el.parentElement?.insertBefore(this.state.placeholder, el);
			} else {
				el.parentElement?.insertBefore(this.state.placeholder, el.nextSibling);
			}
		};

		const onDrop = async (e: DragEvent) => {
			if (!this.state.draggedFile) return;
			if (this.state.draggedFile === file) return;

			e.preventDefault();
			e.stopPropagation();
			this.removePlaceholder();

			const draggedFile = this.state.draggedFile;
			const draggedName = draggedFile.name;
			const sourceParent = draggedFile.parent?.path ?? '';

			// ── Drop onto empty/collapsed folder header ──
			if (this.state.folderDropTarget !== null) {
				const targetFolder = this.state.folderDropTarget.folder;

				if (!this.canDropOnTarget(draggedFile, file)) return;
				if (!this.canMoveToParent(draggedFile, targetFolder.path)) return;

				// Insert at position 0 in the target folder
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

				this.applyReorderToEmptyFolder(sourceParent, targetFolder.path, draggedName);
				this.clearFolderDropTarget();

				await this.plugin.saveSettings();
				this.cleanupStaleOrders();
				return;
			}

			// ── Normal between-row drop ──
			if (!this.canDropOnTarget(this.state.draggedFile, file)) return;

			this.clearFolderDropTarget();

			const destinationParent = file.parent?.path ?? '';

			const rect = el.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			const insertBefore = e.clientY < midY;

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

			this.applyReorder(
				sourceParent,
				destinationParent,
				draggedName,
				file.name,
				insertBefore
			);

			await this.plugin.saveSettings();
			this.cleanupStaleOrders();
		};

		el.addEventListener('dragstart', onDragStart);
		el.addEventListener('dragend', onDragEnd);
		el.addEventListener('dragover', onDragOver);
		el.addEventListener('drop', onDrop);

		this.cleanupFns.push(() => {
			el.removeEventListener('dragstart', onDragStart);
			el.removeEventListener('dragend', onDragEnd);
			el.removeEventListener('dragover', onDragOver);
			el.removeEventListener('drop', onDrop);
			el.removeClass('drag-drop-sort-draggable');
		});
	}

	private canDropOnTarget(dragged: TAbstractFile, target: TAbstractFile): boolean {
		const destinationParent = target.parent?.path ?? '';

		if (dragged.path === destinationParent) return false;
		if (destinationParent.startsWith(dragged.path + '/')) return false;

		return true;
	}

	// ── Empty / collapsed folder drop target ─────────────────

	private isFolderEmptyOrCollapsed(folder: TFolder): boolean {
		// Check visible children: if any visible child exists and is rendered, folder is "non-empty" for drop purposes
		for (const child of folder.children) {
			if (this.isVisible(folder.path, child.name)) return false;
		}
		return true;
	}

	private setFolderDropTarget(el: HTMLElement, folder: TFolder): void {
		if (this.state.folderDropTarget?.el === el) return; // already active
		this.clearFolderDropTarget();
		el.addClass('drag-drop-sort-drop-folder');
		this.state.folderDropTarget = { el, folder };
	}

	private clearFolderDropTarget(): void {
		if (this.state.folderDropTarget) {
			this.state.folderDropTarget.el.removeClass('drag-drop-sort-drop-folder');
			this.state.folderDropTarget = null;
		}
	}

	private applyReorderToEmptyFolder(
		sourceParent: string,
		targetFolderPath: string,
		draggedName: string
	): void {
		// Remove from source
		if (sourceParent !== targetFolderPath) {
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
		} else {
			// Same parent — just ensure it's removed from current order
			const working = this.getWorkingOrder(targetFolderPath).filter(
				(name) => name !== draggedName
			);
			if (working.length > 0) {
				this.plugin.settings.orders[targetFolderPath] = this.mergeHiddenBack(
					targetFolderPath,
					working
				);
			}
		}

		// Insert at position 0 in target
		const destinationWorking = this.getWorkingOrder(targetFolderPath).filter(
			(name) => name !== draggedName
		);
		destinationWorking.splice(0, 0, draggedName);

		this.plugin.settings.orders[targetFolderPath] = this.mergeHiddenBack(
			targetFolderPath,
			destinationWorking
		);
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

		return folder.children
			.map((c) => c.name)
			.filter((name) => this.isVisible(parentPath, name));
	}

	private isVisible(parentPath: string, name: string): boolean {
		return this.visibleByParent.get(parentPath)?.has(name) ?? true;
	}

	private remapFolderOrderKeys(oldPath: string, newPath: string): void {
		const remapped: Record<string, string[]> = {};
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
	}

	cleanup(): void {
		for (const fn of this.cleanupFns) {
			fn();
		}
		this.cleanupFns = [];
		this.visibleByParent.clear();
	}
}
