# Local Index lives entirely outside the Vault

The Local Index (metadata + content hashes used for fast change detection) is stored only in the plugin’s private data directory, never inside the Vault. This guarantees it cannot be accidentally pushed or pulled, and allows each device to maintain an independent index even when the same Vault is opened on multiple machines.
