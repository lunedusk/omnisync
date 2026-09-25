import { App, Modal, Setting, Notice } from "obsidian";
import type OmniSyncPlugin from "../main";
import { exportRecoveryKeyEncrypted } from "../crypto/recovery-export";

export class ExportRecoveryModal extends Modal {
  constructor(app: App, private plugin: OmniSyncPlugin) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Export Recovery Key" });
    contentEl.createEl("p", {
      text: "Re-enter your Recovery Key and choose an export password. The file is encrypted; never share the export password with the same channel as the file.",
    });

    let recoveryKey = "";
    let exportPassword = "";
    let confirmPassword = "";

    new Setting(contentEl).setName("Recovery Key").addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder("Your OmniSync recovery key");
      t.onChange((v) => (recoveryKey = v));
    });
    new Setting(contentEl).setName("Export password").addText((t) => {
      t.inputEl.type = "password";
      t.onChange((v) => (exportPassword = v));
    });
    new Setting(contentEl).setName("Confirm export password").addText((t) => {
      t.inputEl.type = "password";
      t.onChange((v) => (confirmPassword = v));
    });

    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Export encrypted file")
        .setCta()
        .onClick(async () => {
          if (!recoveryKey.trim()) {
            new Notice("Recovery Key required");
            return;
          }
          if (exportPassword.length < 8) {
            new Notice("Export password must be at least 8 characters");
            return;
          }
          if (exportPassword !== confirmPassword) {
            new Notice("Passwords do not match");
            return;
          }
          try {
            const json = await exportRecoveryKeyEncrypted(
              recoveryKey.trim(),
              exportPassword
            );
            await this.plugin.writeRecoveryExportFile(json);
            this.close();
          } catch (e: any) {
            new Notice("Export failed: " + (e?.message ?? e));
          }
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
