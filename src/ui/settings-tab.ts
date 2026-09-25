/**
 * Tabbed settings UI – ADR 0005
 * Tabs: General | Remotes | Filters | Triggers | Advanced | Conflicts
 */

import {
  App,
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  TextComponent,
} from "obsidian";
import type OmniSyncPlugin from "../main";
import type {
  Direction,
  ConflictPolicy,
  E2EEAlgorithm,
  RemoteType,
} from "../types";
import { generateRecoveryKey } from "../crypto/e2ee";

export class OmniSyncSettingTab extends PluginSettingTab {
  plugin: OmniSyncPlugin;
  private activeTab = "general";

  constructor(app: App, plugin: OmniSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("omnisync-settings");

    // Tab bar
    const tabBar = containerEl.createDiv("omnisync-tab-bar");
    const tabs = [
      { id: "general", label: "General" },
      { id: "remotes", label: "Remotes" },
      { id: "filters", label: "Filters" },
      { id: "triggers", label: "Triggers" },
      { id: "advanced", label: "Advanced" },
      { id: "conflicts", label: "Conflicts" },
    ];
    for (const t of tabs) {
      const btn = tabBar.createEl("button", {
        text: t.label,
        cls: this.activeTab === t.id ? "is-active" : "",
      });
      btn.onclick = () => {
        this.activeTab = t.id;
        this.display();
      };
    }

    const pane = containerEl.createDiv("omnisync-tab-pane");
    switch (this.activeTab) {
      case "general":
        this.renderGeneral(pane);
        break;
      case "remotes":
        this.renderRemotes(pane);
        break;
      case "filters":
        this.renderFilters(pane);
        break;
      case "triggers":
        this.renderTriggers(pane);
        break;
      case "advanced":
        this.renderAdvanced(pane);
        break;
      case "conflicts":
        this.renderConflicts(pane);
        break;
    }
  }

  private renderGeneral(el: HTMLElement) {
    el.createEl("h2", { text: "General" });

    new Setting(el)
      .setName("Direction")
      .setDesc("How changes flow between this device and the Active Remote")
      .addDropdown((dd) => {
        const opts: Record<Direction, string> = {
          bidirectional: "Bidirectional (default)",
          "incremental-push": "Incremental Push",
          "incremental-pull": "Incremental Pull",
          "incremental-push-delete": "Incremental Push & Delete",
          "incremental-pull-delete": "Incremental Pull & Delete",
        };
        for (const [k, v] of Object.entries(opts)) dd.addOption(k, v);
        dd.setValue(this.plugin.settings.direction);
        dd.onChange(async (v) => {
          this.plugin.settings.direction = v as Direction;
          await this.plugin.saveSettings();
        });
      });

    new Setting(el)
      .setName("Conflict Policy")
      .setDesc("When the same path has diverged")
      .addDropdown((dd) => {
        dd.addOption("newer-survives", "Newer Survives (default)");
        dd.addOption("larger-survives", "Larger Survives");
        dd.setValue(this.plugin.settings.conflictPolicy);
        dd.onChange(async (v) => {
          this.plugin.settings.conflictPolicy = v as ConflictPolicy;
          await this.plugin.saveSettings();
        });
      });

    new Setting(el)
      .setName("Thread Limit")
      .setDesc("Max concurrent transfers. Leave empty for adaptive.")
      .addText((txt) => {
        txt
          .setPlaceholder("adaptive")
          .setValue(
            this.plugin.settings.threadLimit?.toString() ?? ""
          )
          .onChange(async (v) => {
            const n = parseInt(v, 10);
            this.plugin.settings.threadLimit = isNaN(n) ? null : Math.max(1, n);
            await this.plugin.saveSettings();
          });
      });

    new Setting(el)
      .setName("Run sync now")
      .addButton((btn) =>
        btn.setButtonText("Sync").setCta().onClick(() => {
          this.plugin.runSync("manual");
        })
      );
  }

  private renderRemotes(el: HTMLElement) {
    el.createEl("h2", { text: "Remotes" });
    el.createEl("p", {
      text: "Only one Remote can be active at a time. Credentials stay on this device (plugin settings are never synced).",
    });

    new Setting(el)
      .setName("Active Remote")
      .addDropdown((dd) => {
        dd.addOption("", "— none —");
        for (const r of this.plugin.settings.remotes) {
          dd.addOption(r.id, `${r.name} (${r.type})`);
        }
        dd.setValue(this.plugin.settings.activeRemoteId ?? "");
        dd.onChange(async (v) => {
          this.plugin.settings.activeRemoteId = v || null;
          await this.plugin.saveSettings();
        });
      });

    for (const remote of this.plugin.settings.remotes) {
      const box = el.createDiv({ cls: "omnisync-remote-card" });
      box.createEl("h3", { text: `${remote.name} (${remote.type})` });

      if (remote.type === "s3") {
        this.field(box, "Endpoint", remote.config.endpoint ?? "", (v) => {
          remote.config.endpoint = v;
        });
        this.field(box, "Region", remote.config.region ?? "auto", (v) => {
          remote.config.region = v;
        });
        this.field(box, "Bucket", remote.config.bucket ?? "", (v) => {
          remote.config.bucket = v;
        });
        this.field(box, "Access Key ID", remote.config.accessKeyId ?? "", (v) => {
          remote.config.accessKeyId = v;
        }, true);
        this.field(box, "Secret Access Key", remote.config.secretAccessKey ?? "", (v) => {
          remote.config.secretAccessKey = v;
        }, true);
        this.field(box, "Prefix", remote.config.prefix ?? "omnisync", (v) => {
          remote.config.prefix = v;
        });
        new Setting(box)
          .setName("Force path-style")
          .setDesc("Enable for MinIO / some R2 setups")
          .addToggle((t) =>
            t
              .setValue(remote.config.forcePathStyle === "true" || remote.config.forcePathStyle === true as any)
              .onChange(async (v) => {
                remote.config.forcePathStyle = v ? "true" : "false";
                await this.plugin.saveSettings();
              })
          );
      } else if (remote.type === "google-drive") {
        this.field(box, "Client ID (Desktop OAuth client)", remote.config.clientId ?? "", (v) => {
          remote.config.clientId = v;
        });
        this.field(box, "Client Secret (optional)", remote.config.clientSecret ?? "", (v) => {
          remote.config.clientSecret = v;
        }, true);
        this.field(box, "Access Token", remote.config.accessToken ?? "", (v) => {
          remote.config.accessToken = v;
        }, true);
        this.field(box, "Refresh Token", remote.config.refreshToken ?? "", (v) => {
          remote.config.refreshToken = v;
        }, true);
        this.field(box, "Folder ID (optional)", remote.config.folderId ?? "", (v) => {
          remote.config.folderId = v;
        });
        new Setting(box)
          .setName("Sign in with Google")
          .setDesc(
            "Local loopback OAuth (desktop only). Create a Desktop OAuth client in Google Cloud Console; add redirect http://127.0.0.1:17832/callback"
          )
          .addButton((b) =>
            b.setButtonText("Sign in").onClick(async () => {
              if (!remote.config.clientId) {
                new Notice("Enter Client ID first");
                return;
              }
              try {
                const { oauthGoogleDrive } = await import("../oauth/loopback");
                const tokens = await oauthGoogleDrive(
                  remote.config.clientId,
                  remote.config.clientSecret || undefined
                );
                remote.config.accessToken = tokens.accessToken;
                if (tokens.refreshToken) remote.config.refreshToken = tokens.refreshToken;
                await this.plugin.saveSettings();
                new Notice("Google Drive connected");
                this.display();
              } catch (e: any) {
                new Notice("OAuth failed: " + (e?.message ?? e));
              }
            })
          );
      } else if (remote.type === "onedrive") {
        this.field(box, "Client ID (public app)", remote.config.clientId ?? "", (v) => {
          remote.config.clientId = v;
        });
        this.field(box, "Access Token", remote.config.accessToken ?? "", (v) => {
          remote.config.accessToken = v;
        }, true);
        this.field(box, "Refresh Token", remote.config.refreshToken ?? "", (v) => {
          remote.config.refreshToken = v;
        }, true);
        this.field(box, "Root folder name", remote.config.rootFolder ?? "OmniSync", (v) => {
          remote.config.rootFolder = v;
        });
        new Setting(box)
          .setName("Sign in with Microsoft")
          .setDesc(
            "Local loopback OAuth (desktop only). Register a public client; redirect http://127.0.0.1:17833/callback"
          )
          .addButton((b) =>
            b.setButtonText("Sign in").onClick(async () => {
              if (!remote.config.clientId) {
                new Notice("Enter Client ID first");
                return;
              }
              try {
                const { oauthOneDrive } = await import("../oauth/loopback");
                const tokens = await oauthOneDrive(remote.config.clientId);
                remote.config.accessToken = tokens.accessToken;
                if (tokens.refreshToken) remote.config.refreshToken = tokens.refreshToken;
                await this.plugin.saveSettings();
                new Notice("OneDrive connected");
                this.display();
              } catch (e: any) {
                new Notice("OAuth failed: " + (e?.message ?? e));
              }
            })
          );
      }

      new Setting(box)
        .addButton((b) =>
          b.setButtonText("Save credentials").setCta().onClick(async () => {
            await this.plugin.saveSettings();
            new Notice("Remote credentials saved");
          })
        )
        .addButton((b) =>
          b.setButtonText("Test connection").onClick(async () => {
            try {
              const { createRemoteAdapter } = await import("../remotes/factory");
              const adapter = createRemoteAdapter(remote);
              const ok = await adapter.testConnection();
              new Notice(ok ? "Connection OK" : "Connection failed");
            } catch (e: any) {
              new Notice("Test failed: " + (e?.message ?? e));
            }
          })
        )
        .addButton((b) =>
          b.setButtonText("Remove").setWarning().onClick(async () => {
            this.plugin.settings.remotes = this.plugin.settings.remotes.filter(
              (r) => r.id !== remote.id
            );
            if (this.plugin.settings.activeRemoteId === remote.id) {
              this.plugin.settings.activeRemoteId = null;
            }
            await this.plugin.saveSettings();
            this.display();
          })
        );
    }

    el.createEl("h3", { text: "Add Remote" });
    let newName = "";
    let newType: RemoteType = "s3";
    new Setting(el).setName("Name").addText((t) => t.onChange((v) => (newName = v)));
    new Setting(el)
      .setName("Type")
      .addDropdown((dd) => {
        dd.addOption("s3", "S3-compatible");
        dd.addOption("google-drive", "Google Drive");
        dd.addOption("onedrive", "OneDrive");
        dd.onChange((v) => (newType = v as RemoteType));
      });
    new Setting(el).addButton((b) =>
      b.setButtonText("Add").setCta().onClick(async () => {
        if (!newName.trim()) {
          new Notice("Name is required");
          return;
        }
        const id = `r_${Date.now().toString(36)}`;
        this.plugin.settings.remotes.push({
          id,
          name: newName.trim(),
          type: newType,
          config: {},
        });
        if (!this.plugin.settings.activeRemoteId) {
          this.plugin.settings.activeRemoteId = id;
        }
        await this.plugin.saveSettings();
        this.display();
      })
    );
  }

  private field(
    parent: HTMLElement,
    name: string,
    value: string,
    onChange: (v: string) => void,
    password = false
  ) {
    new Setting(parent).setName(name).addText((t) => {
      t.setValue(value);
      if (password) t.inputEl.type = "password";
      t.onChange((v) => onChange(v));
    });
  }

  private renderFilters(el: HTMLElement) {
    el.createEl("h2", { text: "Filters" });
    const f = this.plugin.settings.filters;

    new Setting(el)
      .setName("Sync themes & snippets")
      .addToggle((t) =>
        t.setValue(f.syncThemesAndSnippets).onChange(async (v) => {
          f.syncThemesAndSnippets = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(el)
      .setName("Sync community plugins + data")
      .addToggle((t) =>
        t.setValue(f.syncCommunityPlugins).onChange(async (v) => {
          f.syncCommunityPlugins = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(el)
      .setName("Sync core settings / workspace / bookmarks")
      .addToggle((t) =>
        t.setValue(f.syncCoreSettings).onChange(async (v) => {
          f.syncCoreSettings = v;
          await this.plugin.saveSettings();
        })
      );

    this.regexList(el, "Ignore regex", f.ignoreRegex, async (list) => {
      f.ignoreRegex = list;
      await this.plugin.saveSettings();
    });
    this.regexList(el, "Allow regex (empty = all)", f.allowRegex, async (list) => {
      f.allowRegex = list;
      await this.plugin.saveSettings();
    });
  }

  private regexList(
    el: HTMLElement,
    title: string,
    list: string[],
    onChange: (list: string[]) => Promise<void>
  ) {
    el.createEl("h3", { text: title });
    list.forEach((re, i) => {
      new Setting(el).setName(re).addButton((b) =>
        b.setButtonText("Remove").onClick(async () => {
          list.splice(i, 1);
          await onChange(list);
          this.display();
        })
      );
    });
    let draft = "";
    new Setting(el)
      .addText((t) => t.setPlaceholder("regex").onChange((v) => (draft = v)))
      .addButton((b) =>
        b.setButtonText("Add").onClick(async () => {
          if (draft.trim()) {
            list.push(draft.trim());
            await onChange(list);
            this.display();
          }
        })
      );
  }

  private renderTriggers(el: HTMLElement) {
    el.createEl("h2", { text: "Triggers" });
    const t = this.plugin.settings.triggers;

    new Setting(el)
      .setName("Sync on Obsidian start")
      .addToggle((tg) =>
        tg.setValue(t.syncOnStart).onChange(async (v) => {
          t.syncOnStart = v;
          await this.plugin.saveSettings();
        })
      );
    new Setting(el)
      .setName("File-watcher debounce (seconds)")
      .setDesc("Minimum 30 s to avoid syncing while you type")
      .addText((txt) =>
        txt
          .setValue(String(t.watcherDebounceSeconds))
          .onChange(async (v) => {
            const n = Math.max(30, parseInt(v, 10) || 30);
            t.watcherDebounceSeconds = n;
            await this.plugin.saveSettings();
            this.plugin.restartWatcher();
          })
      );
    new Setting(el)
      .setName("Periodic sync")
      .addToggle((tg) =>
        tg.setValue(t.periodicEnabled).onChange(async (v) => {
          t.periodicEnabled = v;
          await this.plugin.saveSettings();
          this.plugin.restartPeriodic();
        })
      );
    new Setting(el)
      .setName("Periodic interval (minutes)")
      .addText((txt) =>
        txt
          .setValue(String(t.periodicIntervalMinutes))
          .onChange(async (v) => {
            t.periodicIntervalMinutes = Math.max(1, parseInt(v, 10) || 30);
            await this.plugin.saveSettings();
            this.plugin.restartPeriodic();
          })
      );
    new Setting(el)
      .setName("Sync on every file save")
      .setDesc("Usually unnecessary when the watcher is enabled")
      .addToggle((tg) =>
        tg.setValue(t.syncOnFileSave).onChange(async (v) => {
          t.syncOnFileSave = v;
          await this.plugin.saveSettings();
        })
      );
  }

  private renderAdvanced(el: HTMLElement) {
    el.createEl("h2", { text: "Advanced" });

    new Setting(el)
      .setName("E2EE algorithm")
      .setDesc("libsodium secretstream is the recommended default")
      .addDropdown((dd) => {
        dd.addOption("libsodium-secretstream", "libsodium secretstream (default)");
        dd.addOption("aes-256-gcm", "AES-256-GCM");
        dd.setValue(this.plugin.settings.e2eeAlgorithm);
        dd.onChange(async (v) => {
          this.plugin.settings.e2eeAlgorithm = v as E2EEAlgorithm;
          await this.plugin.saveSettings();
        });
      });

    new Setting(el)
      .setName("Unlock / set Recovery Key")
      .setDesc("Required before any sync can run")
      .addButton((b) =>
        b.setButtonText("Unlock").onClick(() => {
          new RecoveryKeyModal(this.app, this.plugin).open();
        })
      );

    new Setting(el)
      .setName("Export Recovery Key")
      .setDesc("Writes an encrypted file you can store offline")
      .addButton((b) =>
        b.setButtonText("Export").onClick(() => {
          this.plugin.exportRecoveryKey();
        })
      );

    new Setting(el)
      .setName("Generate new Recovery Key")
      .setDesc("Dangerous – only do this if you are starting fresh")
      .addButton((b) =>
        b.setButtonText("Generate").setWarning().onClick(async () => {
          const key = await generateRecoveryKey();
          new Notice("New Recovery Key generated – copy it now, it will not be shown again");
          // Show in a modal so user can copy
          const modal = new Modal(this.app);
          modal.titleEl.setText("Your new Recovery Key");
          modal.contentEl.createEl("p", {
            text: "Store this somewhere safe. It will not be shown again.",
          });
          const pre = modal.contentEl.createEl("pre");
          pre.setText(key);
          modal.open();
          await this.plugin.setRecoveryKey(key);
        })
      );
  }

  private renderConflicts(el: HTMLElement) {
    el.createEl("h2", { text: "Conflicts" });
    el.createEl("p", {
      text: "Losing versions are kept under .omnisync-conflicts/. Restore overwrites the live path; delete removes the preserved copy.",
    });

    void (async () => {
      try {
        const list = await this.app.vault.adapter.list(".omnisync-conflicts");
        const files = list?.files ?? [];
        if (!files.length) {
          el.createEl("p", { text: "No preserved conflicts." });
          return;
        }
        for (const f of files) {
          const base = f.split("/").pop() ?? f;
          new Setting(el)
            .setName(base)
            .setDesc(f)
            .addButton((b) =>
              b.setButtonText("Restore").onClick(async () => {
                // filename: timestamp_path__with__slashes
                const withoutTs = base.replace(/^\d{4}-\d{2}-\d{2}T[\d-]+Z_/, "");
                const target = withoutTs.replace(/__/g, "/");
                const data = await this.app.vault.adapter.readBinary(f);
                const parent = target.includes("/")
                  ? target.replace(/\/[^/]+$/, "")
                  : "";
                if (parent) {
                  await this.app.vault.adapter.mkdir(parent).catch(() => {});
                }
                await this.app.vault.adapter.writeBinary(target, data);
                new Notice(`Restored ${target}`);
              })
            )
            .addButton((b) =>
              b.setButtonText("Delete").setWarning().onClick(async () => {
                await this.app.vault.adapter.remove(f);
                new Notice("Deleted preserved conflict");
                this.display();
              })
            );
        }
      } catch {
        el.createEl("p", { text: "No conflicts folder yet." });
      }
    })();
  }
}

class RecoveryKeyModal extends Modal {
  constructor(app: App, private plugin: OmniSyncPlugin) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Enter Recovery Key" });
    let value = "";
    const input = new TextComponent(contentEl)
      .setPlaceholder("Recovery key or passphrase")
      .onChange((v) => (value = v));
    input.inputEl.type = "password";
    contentEl.createEl("br");
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Unlock")
        .setCta()
        .onClick(async () => {
          const ok = await this.plugin.setRecoveryKey(value);
          if (ok) {
            new Notice("Unlocked");
            this.close();
          } else {
            new Notice("Could not unlock – check the key");
          }
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
