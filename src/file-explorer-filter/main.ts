import {
	App,
	Menu,
	Notice,
	Plugin,
	PluginSettingTab,
	setIcon,
	Setting,
	TFolder,
	WorkspaceLeaf,
} from "obsidian";

interface FileExplorerFilterSettings {
	scope: string | null;
	hideMatchingNames: boolean;
	nameFilterEnabled: boolean;
	nameFilterText: string;
}

interface StoredFileExplorerFilterSettings
	extends Partial<FileExplorerFilterSettings> {
	hideDone?: boolean;
}

interface FileExplorerView {
	containerEl: HTMLElement;
	// These are internal Obsidian APIs, so every level is optional across versions.
	tree?: {
		infinityScroll?: {
			invalidateAll?: () => void;
		};
	};
}

const DEFAULT_SETTINGS: FileExplorerFilterSettings = {
	scope: null,
	hideMatchingNames: false,
	nameFilterEnabled: true,
	nameFilterText: "[DONE]",
};

const HIDDEN_CLASS = "file-explorer-filter-hidden";
const BUTTON_CLASS = "file-explorer-filter-button";

export default class FileExplorerFilterPlugin extends Plugin {
	private filterSettings: FileExplorerFilterSettings = DEFAULT_SETTINGS;
	private observers = new Map<HTMLElement, MutationObserver>();
	private buttons = new Map<HTMLElement, HTMLElement>();
	private refreshTimer: number | null = null;
	private setupTimer: number | null = null;
	private layoutInvalidationTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new FileExplorerFilterSettingTab(this.app, this));

		// Explorer DOM is created lazily, so setup must run both after the initial
		// layout and whenever Obsidian replaces that layout.
		this.app.workspace.onLayoutReady(() => this.setupExplorerViewsSafely());

		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.setupExplorerViewsSafely()),
		);
		this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));

		this.addCommand({
			id: "show-file-explorer-filter-menu",
			name: "Show File Explorer Filter menu",
			callback: () => this.showFilterMenu(),
		});
		this.addCommand({
			id: "toggle-name-filter",
			name: "Toggle files and folders matching the name filter",
			callback: () => {
				if (this.filterSettings.nameFilterEnabled) {
					void this.setHideMatchingNames(
						!this.filterSettings.hideMatchingNames,
					);
				}
			},
		});
	}

	onunload(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
		if (this.setupTimer !== null) {
			window.clearTimeout(this.setupTimer);
		}
		if (this.layoutInvalidationTimer !== null) {
			window.clearTimeout(this.layoutInvalidationTimer);
		}

		for (const observer of this.observers.values()) {
			observer.disconnect();
		}
		this.observers.clear();

		for (const button of this.buttons.values()) {
			button.remove();
		}
		this.buttons.clear();

		document
			.querySelectorAll(`.${HIDDEN_CLASS}`)
			.forEach((element) => element.classList.remove(HIDDEN_CLASS));
	}

	private async loadSettings(): Promise<void> {
		const stored =
			((await this.loadData()) as StoredFileExplorerFilterSettings | null) ?? {};
		this.filterSettings = Object.assign({}, DEFAULT_SETTINGS, stored);

		// Keep the old key readable so existing users do not lose this preference
		// when upgrading from the earlier setting name.
		if (
			typeof stored.hideMatchingNames !== "boolean" &&
			typeof stored.hideDone === "boolean"
		) {
			this.filterSettings.hideMatchingNames = stored.hideDone;
		}

		const trimmedText = this.filterSettings.nameFilterText.trim();
		this.filterSettings.nameFilterText =
			trimmedText.length > 0 ? trimmedText : DEFAULT_SETTINGS.nameFilterText;
	}

	private async saveSettings(): Promise<void> {
		await this.saveData(this.filterSettings);
	}

	private getExplorerLeaves(): WorkspaceLeaf[] {
		return this.app.workspace.getLeavesOfType("file-explorer");
	}

	private setupExplorerViewsSafely(): void {
		try {
			this.setupExplorerViews();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("File Explorer Filter failed to set up the explorer:", error);
			new Notice(`File Explorer Filter: ${message}`, 10000);
		}
	}

	private setupExplorerViews(): void {
		const activeContainers = new Set<HTMLElement>();

		for (const leaf of this.getExplorerLeaves()) {
			const view = leaf.view as unknown as FileExplorerView;
			const container = view.containerEl;
			if (!container) {
				continue;
			}
			activeContainers.add(container);

			if (!this.buttons.has(container)) {
				// On mobile the sidebar may render after layout-ready, so the toolbar
				// can be absent on the first setup attempt.
				const toolbar = container.querySelector<HTMLElement>(
					".nav-header .nav-buttons-container",
				);
				if (toolbar) {
					// Register one button per explorer container because workspaces can
					// contain multiple File explorer leaves.
					const button = document.createElement("div");
					button.addClass("clickable-icon", "nav-action-button");
					button.addClass(BUTTON_CLASS);
					button.setAttribute("aria-label", "Filter File explorer");
					button.setAttribute("role", "button");
					button.tabIndex = 0;
					setIcon(button, "list-filter");
					this.registerDomEvent(button, "click", (event) =>
						this.showFilterMenu(event),
					);
					this.registerDomEvent(button, "keydown", (event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							this.showFilterMenu();
						}
					});
					toolbar.appendChild(button);
					this.buttons.set(container, button);
				}
			}

			if (!this.observers.has(container)) {
				// Re-run setup when Obsidian creates the toolbar or rebuilds tree rows.
				const observer = new MutationObserver(() => {
					this.scheduleSetup();
					this.scheduleRefresh();
				});
				observer.observe(container, { childList: true, subtree: true });
				this.observers.set(container, observer);
			}
		}

		for (const [container, observer] of this.observers) {
			if (!activeContainers.has(container)) {
				observer.disconnect();
				this.observers.delete(container);
				this.buttons.get(container)?.remove();
				this.buttons.delete(container);
			}
		}

		this.refresh();
	}

	private showFilterMenu(event?: MouseEvent): void {
		const menu = new Menu();
		// Scope choices are limited to top-level folders, while descendants remain
		// visible to preserve the selected folder's navigable tree context.
		const rootFolders = this.app.vault
			.getRoot()
			.children.filter((item): item is TFolder => item instanceof TFolder)
			.sort((left, right) => left.name.localeCompare(right.name));

		menu.addItem((item) =>
			item
				.setTitle("All folders")
				.setIcon(this.filterSettings.scope === null ? "check" : "folder-tree")
				.onClick(() => void this.setScope(null)),
		);

		for (const folder of rootFolders) {
			menu.addItem((item) =>
				item
					.setTitle(folder.name)
					.setIcon(this.filterSettings.scope === folder.path ? "check" : "folder")
					.onClick(() => void this.setScope(folder.path)),
			);
		}

		if (this.filterSettings.nameFilterEnabled) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(
						`Hide names containing "${this.filterSettings.nameFilterText}"`,
					)
					.setIcon(
						this.filterSettings.hideMatchingNames
							? "check-square"
							: "square",
					)
					.onClick(() =>
						void this.setHideMatchingNames(
							!this.filterSettings.hideMatchingNames,
						),
					),
			);
		}

		if (event) {
			menu.showAtMouseEvent(event);
		} else {
			const button = this.buttons.values().next().value as HTMLElement | undefined;
			if (button) {
				const rect = button.getBoundingClientRect();
				menu.showAtPosition({ x: rect.left, y: rect.bottom });
			}
		}
	}

	private async setScope(scope: string | null): Promise<void> {
		const scopeChanged = this.filterSettings.scope !== scope;
		this.filterSettings.scope = scope;
		await this.saveSettings();
		this.refresh();
		if (scopeChanged) {
			this.scheduleLayoutInvalidation();
		}
	}

	async setNameFilterEnabled(enabled: boolean): Promise<void> {
		this.filterSettings.nameFilterEnabled = enabled;
		if (!enabled) {
			this.filterSettings.hideMatchingNames = false;
		}
		await this.saveSettings();
		this.refresh();
	}

	async setNameFilterText(text: string): Promise<boolean> {
		const trimmedText = text.trim();
		if (trimmedText.length === 0) {
			return false;
		}

		this.filterSettings.nameFilterText = trimmedText;
		await this.saveSettings();
		this.refresh();
		return true;
	}

	getNameFilterText(): string {
		return this.filterSettings.nameFilterText;
	}

	isNameFilterEnabled(): boolean {
		return this.filterSettings.nameFilterEnabled;
	}

	private async setHideMatchingNames(hidden: boolean): Promise<void> {
		this.filterSettings.hideMatchingNames =
			this.filterSettings.nameFilterEnabled && hidden;
		await this.saveSettings();
		this.refresh();
	}

	private scheduleRefresh(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}

		// Coalesce bursts of vault and DOM mutations into one filtering pass.
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refresh();
		}, 50);
	}

	private scheduleSetup(): void {
		if (this.setupTimer !== null) {
			window.clearTimeout(this.setupTimer);
		}

		this.setupTimer = window.setTimeout(() => {
			this.setupTimer = null;
			this.setupExplorerViewsSafely();
		}, 50);
	}

	private scheduleLayoutInvalidation(): void {
		if (this.layoutInvalidationTimer !== null) {
			window.clearTimeout(this.layoutInvalidationTimer);
		}

		this.layoutInvalidationTimer = window.setTimeout(() => {
			this.layoutInvalidationTimer = null;
			this.invalidateExplorerLayout();
		}, 100);
	}

	private invalidateExplorerLayout(): void {
		for (const leaf of this.getExplorerLeaves()) {
			const view = leaf.view as unknown as FileExplorerView;
			// display:none changes the visual rows but not Obsidian's cached
			// virtual-scroll measurements; invalidate those measurements explicitly.
			view.tree?.infinityScroll?.invalidateAll?.();
		}
	}

	private refresh(): void {
		let layoutChanged = false;
		for (const leaf of this.getExplorerLeaves()) {
			const view = leaf.view as unknown as FileExplorerView;
			layoutChanged =
				this.filterExplorer(view.containerEl) || layoutChanged;
		}

		for (const button of this.buttons.values()) {
			const scopeLabel = this.filterSettings.scope ?? "All folders";
			const nameFilterLabel = this.filterSettings.hideMatchingNames
				? `, names containing "${this.filterSettings.nameFilterText}" hidden`
				: "";
			button.setAttribute(
				"aria-label",
				`File Explorer Filter: ${scopeLabel}${nameFilterLabel}`,
			);
			button.toggleClass(
				"is-active",
				this.filterSettings.scope !== null ||
					this.filterSettings.hideMatchingNames,
			);
		}

		if (layoutChanged) {
			// Wait for the current batch of explorer rows to render before
			// invalidating virtual-scroll measurements.
			this.scheduleLayoutInvalidation();
		}
	}

	private filterExplorer(container: HTMLElement): boolean {
		let layoutChanged = false;
		const titles = container.querySelectorAll<HTMLElement>(
			".nav-file-title[data-path], .nav-folder-title[data-path]",
		);

		for (const title of Array.from(titles)) {
			const path = title.dataset.path;
			const treeItem = title.closest<HTMLElement>(".tree-item");
			if (!path || !treeItem) {
				continue;
			}

			// Keep rows in the DOM and hide them with CSS so ordering and other
			// File explorer plugins continue to operate on the same tree.
			const hiddenByScope = !this.isPathInScope(path);
			const hiddenByName =
				this.filterSettings.nameFilterEnabled &&
				this.filterSettings.hideMatchingNames &&
				this.nameContainsFilter(path);
			const shouldHide = hiddenByScope || hiddenByName;
			// Toggle only when the state changes so MutationObserver callbacks do not
			// create an unnecessary refresh loop.
			if (treeItem.classList.contains(HIDDEN_CLASS) !== shouldHide) {
				treeItem.toggleClass(HIDDEN_CLASS, shouldHide);
				layoutChanged = true;
			}
		}

		return layoutChanged;
	}

	private isPathInScope(path: string): boolean {
		const scope = this.filterSettings.scope;
		if (scope === null) {
			return true;
		}

		// Keep the selected folder, its descendants, and its ancestor chain visible
		// so the scoped subtree remains connected in the explorer tree.
		return (
			path === scope ||
			path.startsWith(`${scope}/`) ||
			scope.startsWith(`${path}/`)
		);
	}

	private nameContainsFilter(path: string): boolean {
		// Match the visible file or folder name, not the complete parent path.
		const name = path.split("/").pop() ?? path;
		return name
			.toLocaleLowerCase()
			.includes(this.filterSettings.nameFilterText.toLocaleLowerCase());
	}
}

class FileExplorerFilterSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: FileExplorerFilterPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "File Explorer Filter" });

		new Setting(containerEl)
			.setName("Show name filter")
			.setDesc(
				"Show a menu option that hides files and folders containing configured text.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.isNameFilterEnabled())
					.onChange(async (enabled) => {
						await this.plugin.setNameFilterEnabled(enabled);
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName("Name contains")
			.setDesc("Case-insensitive text to match in file and folder names.")
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_SETTINGS.nameFilterText)
					.setValue(this.plugin.getNameFilterText())
					.setDisabled(!this.plugin.isNameFilterEnabled());

				text.inputEl.addEventListener("blur", () => {
					void (async () => {
						const accepted = await this.plugin.setNameFilterText(
							text.getValue(),
						);
						if (!accepted) {
							text.setValue(this.plugin.getNameFilterText());
							new Notice("Name filter text cannot be empty or whitespace.");
						}
					})();
				});
			});
	}
}
