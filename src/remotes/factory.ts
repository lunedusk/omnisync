import type { RemoteConfig } from "../types";
import type { RemoteAdapter } from "./types";
import { S3Adapter, type S3Config } from "./s3";
import { GDriveAdapter, type GDriveConfig } from "./gdrive";
import { OneDriveAdapter, type OneDriveConfig } from "./onedrive";

/**
 * Create a concrete adapter from a saved RemoteConfig.
 * Credentials live in remote.config and are never synced.
 */
export function createRemoteAdapter(remote: RemoteConfig): RemoteAdapter {
  switch (remote.type) {
    case "s3":
      return new S3Adapter(remote.id, remote.config as unknown as S3Config);
    case "google-drive":
      return new GDriveAdapter(
        remote.id,
        remote.config as unknown as GDriveConfig
      );
    case "onedrive":
      return new OneDriveAdapter(
        remote.id,
        remote.config as unknown as OneDriveConfig
      );
    default:
      throw new Error(`Unknown remote type: ${(remote as any).type}`);
  }
}
