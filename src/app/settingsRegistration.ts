import type { Plugin } from 'obsidian';

import type { PiviPluginHost } from '@/app/hostContracts';
import { PiviSettingTabHost } from "@/app/ui/PiviSettingTabHost";

export function registerPiviSettings(owner: Plugin, host: PiviPluginHost): void {
  owner.addSettingTab(
    new PiviSettingTabHost(host.app, owner, host, () => host.ensureWorkspaceServices()),
  );
}
