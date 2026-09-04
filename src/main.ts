// Must run before SDK usage to patch Electron EventEmitter defaults.
import { patchSetMaxListenersForElectron } from "@pivi/obsidian-host/electronCompat";
patchSetMaxListenersForElectron();

import { Plugin } from "obsidian";

import {
  createPiviApplication,
  type PiviApplicationLifecycle,
} from "@/app/PiviApplication";

/** Obsidian lifecycle shell. Product state and assembly live in the application. */
export default class PiviPlugin extends Plugin {
  private application: PiviApplicationLifecycle | null = null;

  async onload(): Promise<void> {
    const application = createPiviApplication(this);
    this.application = application;
    await application.onload();
  }

  onunload(): void {
    this.application?.onunload();
    this.application = null;
  }
}
