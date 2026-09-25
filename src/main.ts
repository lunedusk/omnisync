/**
 * OmniSync – main plugin entry
 * Lunedusk
 */

import {
  App,
  Plugin,
  Notice,
  TAbstractFile,
  debounce,
} from "obsidian";
import {
  DEFAULT_SETTINGS,
  type OmniSyncSettings,
} from "./types";
import { OmniSyncSettingTab } from "./ui/settings-tab";
import { LocalIndex } from "./index/local-index";
import { SyncEngine } from "./sync/engine";
import { deriveKey, generateRecoveryKey } from "./crypto/e2ee";

export default class OmniSyncPlugin extends Plugin {
  settings: OmniSyncSettings = DEFAULT_SETTINGS;
  private index = new LocalIndex("");
  private engine: SyncEngine | null = null;
  private masterKey: Uint8Array | null = null;
  private keySalt: Uint8Array | null = null;
  private periodicTimer: number | null = null;
  private watcherDebounced: (() => void) | null = null;

  async onload() {
    console.log("[OmniSync] loading");

    await this.loadSettings();

    // Ensure device fingerprint exists
    if (!this.settings.deviceFingerprint) {
      this.settings.deviceFingerprint = `dev_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      await this.saveSettings();
    }

    // Load Local Index + key salt from plugin data (outside vault)
    const data = await this.loadData();
    const indexData = data?.localIndex ?? null;
    await this.index.load(indexData);
    if (data?.keySalt && Array.isArray(data.keySalt)) {
      this.keySalt = new Uint8Array(data.keySalt);
    }

    this.engine = new SyncEngine(
      this.app,
      this.settings,
      this.index,
      async () => this.masterKey
    );

    // Ribbon icon
    this.addRibbonIcon("cloud", "OmniSync – run sync", () => {
      this.runSync("ribbon");
    });

    // Commands
    this.addCommand({
      id: "omnisync-run",
      name: "Run sync now",
      callback: () => this.runSync("command"),
    });

    this.addCommand({
      id: "omnisync-open-settings",
      name: "Open OmniSync settings",
      callback: () => {
        // @ts-ignore
        this.app.setting.open();
        // @ts-ignore
        this.app.setting.openTabById("omnisync");
      },
    });

    // Settings tab
    this.addSettingTab(new OmniSyncSettingTab(this.app, this));

    // First-run guard
    if (!this.settings.firstRunCompleted) {
      new Notice(
        "OmniSync: complete first-run in Settings → Advanced (set a Recovery Key)"
      );
    }

    // Triggers
    if (this.settings.triggers.syncOnStart && this.settings.firstRunCompleted) {
      // slight delay so vault is fully ready
      window.setTimeout(() => this.runSync("start"), 2500);
    }

    this.restartWatcher();
    this.restartPeriodic();

    // Save index on unload
    this.register(() => {
      this.persistIndex();
    });
  }

  onunload() {
    this.stopPeriodic();
    this.persistIndex();
    console.log("[OmniSync] unloaded");
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
  }

  async saveSettings() {
    const data = (await this.loadData()) ?? {};
    data.settings = this.settings;
    // never store the master key
    await this.saveData(data);
  }

  private async persistIndex() {
    if (!this.index.isDirty()) return;
    const data = (await this.loadData()) ?? {};
    data.localIndex = this.index.toJSON();
    await this.saveData(data);
    this.index.markClean();
  }

  async runSync(reason: string) {
    if (!this.engine) return;
    if (!this.masterKey) {
      new Notice("OmniSync: unlock with your Recovery Key first (Settings → Advanced)");
      return;
    }
    const result = await this.engine.run(reason);
    await this.persistIndex();
    if (result.errors.length) {
      console.error("[OmniSync] errors", result.errors);
    }
  }

  /** Called from settings UI */
  async setRecoveryKey(passphrase: string): Promise<boolean> {
    try {
      const { key, salt } = await deriveKey(passphrase, this.keySalt ?? undefined);
      this.masterKey = key;
      this.keySalt = salt;
      // Persist only the salt (never the key)
      const data = (await this.loadData()) ?? {};
      data.keySalt = Array.from(salt);
      if (!this.settings.firstRunCompleted) {
        this.settings.firstRunCompleted = true;
        await this.saveSettings();
      }
      await this.saveData(data);
      return true;
    } catch (e) {
      console.error("[OmniSync] setRecoveryKey failed", e);
      return false;
    }
  }

  /**
   * Export Recovery Key as an encrypted JSON file the user stores offline.
   * Asks for the recovery key again + an export password (never writes plaintext).
   */
  async exportRecoveryKey() {
    const { ExportRecoveryModal } = await import("./ui/export-recovery-modal");
    new ExportRecoveryModal(this.app, this).open();
  }

  async writeRecoveryExportFile(json: string): Promise<void> {
    const name = `omnisync-recovery-${new Date().toISOString().slice(0, 10)}.json`;
    // Prefer vault root so user can find it; they should move it offline and delete
    await this.app.vault.adapter.write(name, json);
    new Notice(`Recovery export written to vault root as ${name} – move it offline and delete from the vault`);
  }

  private watcherRegistered = false;

  restartWatcher() {
    const seconds = Math.max(30, this.settings.triggers.watcherDebounceSeconds);
    this.watcherDebounced = debounce(
      () => {
        this.runSync("watcher");
      },
      seconds * 1000,
      true
    );

    if (this.watcherRegistered) return;
    this.watcherRegistered = true;

    const fire = () => {
      if (this.watcherDebounced) this.watcherDebounced();
    };

    this.registerEvent(this.app.vault.on("modify", fire));
    this.registerEvent(this.app.vault.on("create", fire));
    this.registerEvent(this.app.vault.on("delete", fire));
    this.registerEvent(this.app.vault.on("rename", fire));
  }

  restartPeriodic() {
    this.stopPeriodic();
    if (!this.settings.triggers.periodicEnabled) return;
    const ms = this.settings.triggers.periodicIntervalMinutes * 60 * 1000;
    this.periodicTimer = window.setInterval(() => {
      this.runSync("periodic");
    }, ms);
  }

  private stopPeriodic() {
    if (this.periodicTimer !== null) {
      window.clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }
}
