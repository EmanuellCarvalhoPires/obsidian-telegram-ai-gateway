// Minimal runtime mock of the "obsidian" package for vitest (aliased in vitest.config.mjs).
// Shared by all tests: do not change behavior here for one test; use vi.mock or
// vi.spyOn in the test file instead.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const requestUrlMock = {
  handler: async (_req: any): Promise<any> => {
    throw new Error("requestUrl not mocked in this test");
  },
};

/** Tests replace requestUrlMock.handler to answer requests. */
export function requestUrl(req: any): Promise<any> {
  return requestUrlMock.handler(typeof req === "string" ? { url: req } : req);
}

let language = "en";
export function setMockLanguage(lang: string): void {
  language = lang;
}
export function getLanguage(): string {
  return language;
}

export function setIcon(el: any, icon: string): void {
  if (el && typeof el === "object") el.dataset = { ...(el.dataset ?? {}), icon };
}

export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");
}

export function debounce<T extends unknown[]>(cb: (...args: T) => unknown, _timeout?: number) {
  const fn = (...args: T) => {
    cb(...args);
    return fn;
  };
  (fn as any).cancel = () => fn;
  (fn as any).run = () => undefined;
  return fn;
}

export const Platform = {
  isDesktop: true,
  isDesktopApp: true,
  isMobile: false,
  isMobileApp: false,
  isWin: process.platform === "win32",
  isMacOS: process.platform === "darwin",
  isLinux: process.platform === "linux",
};

export const notices: string[] = [];
export class Notice {
  message: string;
  noticeEl: any = {};
  containerEl: any = { addClass() {}, removeClass() {} };
  constructor(message: string | DocumentFragment, _timeout?: number) {
    this.message = typeof message === "string" ? message : "[fragment]";
    notices.push(this.message);
  }
  setMessage(message: string) {
    this.message = message;
    return this;
  }
  hide() {}
}

export class Events {
  private handlers = new Map<string, Array<(...args: any[]) => any>>();
  on(name: string, cb: (...args: any[]) => any) {
    const list = this.handlers.get(name) ?? [];
    list.push(cb);
    this.handlers.set(name, list);
    return { name, cb };
  }
  offref(ref: { name: string; cb: (...args: any[]) => any }) {
    const list = this.handlers.get(ref.name) ?? [];
    this.handlers.set(
      ref.name,
      list.filter((h) => h !== ref.cb),
    );
  }
  trigger(name: string, ...args: any[]) {
    for (const h of this.handlers.get(name) ?? []) h(...args);
  }
}

export class Component {
  load() {}
  onload() {}
  unload() {}
  onunload() {}
  register(_cb: () => any) {}
  registerEvent(_ref: any) {}
  registerDomEvent(..._args: any[]) {}
  registerInterval(id: number) {
    return id;
  }
  addChild<T>(c: T) {
    return c;
  }
}

export class Plugin extends Component {
  app: any;
  manifest: any;
  constructor(app: any, manifest: any) {
    super();
    this.app = app;
    this.manifest = manifest;
  }
  async loadData() {
    return null;
  }
  async saveData(_data: any) {}
  addSettingTab(_tab: any) {}
  addCommand(cmd: any) {
    return cmd;
  }
  addRibbonIcon(..._args: any[]) {
    return {};
  }
  registerView(..._args: any[]) {}
  addStatusBarItem() {
    return {};
  }
}

export class ItemView extends Component {
  app: any;
  leaf: any;
  containerEl: any;
  contentEl: any;
  constructor(leaf: any) {
    super();
    this.leaf = leaf;
    this.app = leaf?.app;
  }
  getViewType() {
    return "";
  }
  getDisplayText() {
    return "";
  }
  getIcon() {
    return "";
  }
}

export class Modal {
  app: any;
  contentEl: any;
  titleEl: any;
  modalEl: any;
  constructor(app: any) {
    this.app = app;
  }
  open() {}
  close() {}
  onOpen() {}
  onClose() {}
  setTitle(_t: string) {
    return this;
  }
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: any;
  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
  }
  display() {}
  hide() {}
}

export class Setting {
  settingEl: any = {};
  controlEl: any = {};
  constructor(_containerEl: any) {}
  setName(_n: any) {
    return this;
  }
  setDesc(_d: any) {
    return this;
  }
  setHeading() {
    return this;
  }
  setClass(_c: string) {
    return this;
  }
  addText(_cb: any) {
    return this;
  }
  addTextArea(_cb: any) {
    return this;
  }
  addToggle(_cb: any) {
    return this;
  }
  addButton(_cb: any) {
    return this;
  }
  addExtraButton(_cb: any) {
    return this;
  }
  addDropdown(_cb: any) {
    return this;
  }
}

export class TFile {
  path = "";
  name = "";
  basename = "";
  extension = "";
}
export class TFolder {
  path = "";
  name = "";
  children: any[] = [];
}
export class FileSystemAdapter {
  constructor(private base: string = "") {}
  getBasePath() {
    return this.base;
  }
}

export class WorkspaceLeaf {}
