/**
 * Local-only OAuth via loopback HTTP server.
 * No hosted website required – redirect_uri is http://127.0.0.1:<port>/callback
 *
 * User still creates an OAuth client in Google Cloud / Azure portal:
 * - Application type: Desktop / Public client
 * - Authorized redirect URI: http://127.0.0.1:17832/callback  (port may vary)
 */

import { Notice } from "obsidian";

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export interface LoopbackOAuthOptions {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  /** Preferred port; will try nearby ports if busy */
  preferredPort?: number;
  extraTokenParams?: Record<string, string>;
}

function randomState(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Start a one-shot loopback server, open the system browser, wait for the
 * authorization code, exchange it for tokens, then shut down.
 * Works on Obsidian desktop (Node/Electron). On mobile, throws – use paste-token.
 */
export async function runLoopbackOAuth(
  opts: LoopbackOAuthOptions
): Promise<OAuthTokens> {
  // Detect mobile / no Node http
  const http = await importNodeHttp();
  if (!http) {
    throw new Error(
      "Loopback OAuth requires Obsidian desktop. On mobile, paste an access token instead."
    );
  }

  const state = randomState();
  const port = opts.preferredPort ?? 17832;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authParams = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: opts.scopes.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
  });
  const fullAuthUrl = `${opts.authUrl}?${authParams}`;

  return new Promise<OAuthTokens>((resolve, reject) => {
    let settled = false;
    const server = http.createServer(async (req: any, res: any) => {
      try {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
        if (url.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        const err = url.searchParams.get("error");

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        if (err || !code || returnedState !== state) {
          res.end(
            `<html><body><h2>OmniSync – authorisation failed</h2><p>${err ?? "missing code"}</p><p>You can close this window.</p></body></html>`
          );
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error(err ?? "OAuth callback missing code or bad state"));
          }
          return;
        }

        res.end(
          `<html><body><h2>OmniSync – connected</h2><p>You can close this window and return to Obsidian.</p></body></html>`
        );

        const body = new URLSearchParams({
          code,
          client_id: opts.clientId,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          ...(opts.clientSecret ? { client_secret: opts.clientSecret } : {}),
          ...(opts.extraTokenParams ?? {}),
        });

        const tokenRes = await fetch(opts.tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        if (!tokenRes.ok) {
          const t = await tokenRes.text();
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error(`Token exchange failed ${tokenRes.status}: ${t.slice(0, 200)}`));
          }
          return;
        }
        const json = (await tokenRes.json()) as {
          access_token: string;
          refresh_token?: string;
          expires_in?: number;
        };
        if (!settled) {
          settled = true;
          cleanup();
          resolve({
            accessToken: json.access_token,
            refreshToken: json.refresh_token,
            expiresIn: json.expires_in,
          });
        }
      } catch (e) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(e);
        }
      }
    });

    const cleanup = () => {
      try {
        server.close();
      } catch {
        /* ignore */
      }
    };

    server.listen(port, "127.0.0.1", () => {
      new Notice("OmniSync: opening browser for sign-in…");
      // Open system browser
      try {
        // Electron / Obsidian desktop
        const { shell } = (window as any).require?.("electron") ?? {};
        if (shell?.openExternal) {
          shell.openExternal(fullAuthUrl);
        } else {
          window.open(fullAuthUrl, "_blank");
        }
      } catch {
        window.open(fullAuthUrl, "_blank");
      }
    });

    server.on("error", (e: Error) => {
      if (!settled) {
        settled = true;
        reject(new Error(`Could not bind loopback port ${port}: ${e.message}`));
      }
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error("OAuth timed out – no callback received"));
      }
    }, 5 * 60 * 1000);
  });
}

async function importNodeHttp(): Promise<any | null> {
  try {
    // Obsidian desktop runs on Electron – require works
    const req = (window as any).require;
    if (typeof req === "function") {
      return req("http");
    }
  } catch {
    /* not available */
  }
  try {
    // Bundled environments may expose node:http
    return await import("http");
  } catch {
    return null;
  }
}

/** Google Drive OAuth (desktop client) */
export async function oauthGoogleDrive(
  clientId: string,
  clientSecret?: string
): Promise<OAuthTokens> {
  return runLoopbackOAuth({
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId,
    clientSecret,
    scopes: [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.appdata",
    ],
    preferredPort: 17832,
  });
}

/** Microsoft OneDrive / Graph OAuth (public client) */
export async function oauthOneDrive(clientId: string): Promise<OAuthTokens> {
  return runLoopbackOAuth({
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    clientId,
    scopes: [
      "offline_access",
      "Files.ReadWrite",
      "User.Read",
    ],
    preferredPort: 17833,
    extraTokenParams: {},
  });
}
