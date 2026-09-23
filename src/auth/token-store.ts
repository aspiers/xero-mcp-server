import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * Shape of the OAuth2 token store on disk. It is the raw token response from
 * Xero's identity endpoint with two added bookkeeping fields:
 * - `_obtained_at`: epoch seconds when the token was minted/refreshed.
 * - `expires_at`: epoch seconds when the access token expires.
 *
 * Both the bootstrap flow (authorization-code) and the running server's
 * RefreshingTokenXeroClient (refresh-token) read and write this exact shape, so
 * the two cannot drift.
 */
export interface TokenStore {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  _obtained_at?: number;
  expires_at?: number;
  // Tolerate any extra fields Xero returns without losing them on re-persist.
  [key: string]: unknown;
}

/** Read and parse the token store. Throws if the file is missing or malformed. */
export function readTokens(file: string): TokenStore {
  const raw = fs.readFileSync(file, "utf-8");
  try {
    return JSON.parse(raw) as TokenStore;
  } catch {
    // JSON.parse messages quote the offending input, which could put a token
    // fragment into a tool response.
    throw new Error(`Token file ${file} is not valid JSON`);
  }
}

/**
 * Write the token store atomically with 0600 perms, so a crash mid-write can
 * never leave a truncated token file and the refresh token inside is never
 * world-readable.
 */
export function persistTokens(file: string, tok: TokenStore): void {
  if (!tok.access_token || !tok.refresh_token) {
    throw new Error(
      "Refusing to persist a token set without access_token and refresh_token",
    );
  }

  // A per-writer name stops concurrent writers clobbering one temp file, and
  // O_EXCL guarantees the 0600 mode applies to a file this call created
  // rather than to a leftover with looser permissions.
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(tok, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }

  // Without syncing the directory the rename itself may not survive a crash,
  // resurrecting a refresh token Xero has already rotated away.
  const dirFd = fs.openSync(path.dirname(file), "r");
  try {
    fs.fsyncSync(dirFd);
  } finally {
    fs.closeSync(dirFd);
  }
}

// Refresh requests time out well inside this, so a lock this old can only
// belong to a holder that died mid-refresh.
export const TOKEN_LOCK_STALE_MS = 60_000;
const TOKEN_LOCK_TIMEOUT_MS = 45_000;
const TOKEN_LOCK_RETRY_MS = 100;

/**
 * Run `fn` while holding an exclusive lock on the token file, shared across
 * every process using it. Xero rotates the refresh token on each use, so two
 * processes refreshing from the same stored token would race and could leave
 * an already-spent refresh token on disk.
 */
export async function withTokenLock<T>(
  file: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lock = `${file}.lock`;
  const deadline = Date.now() + TOKEN_LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, "wx", 0o600));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    try {
      if (Date.now() - fs.statSync(lock).mtimeMs > TOKEN_LOCK_STALE_MS) {
        fs.rmSync(lock, { force: true });
        continue;
      }
    } catch {
      // Lock vanished between open and stat: retry immediately.
      continue;
    }

    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for token lock ${lock}`);
    }
    await new Promise((resolve) => setTimeout(resolve, TOKEN_LOCK_RETRY_MS));
  }

  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

/** Epoch seconds at which the access token expires. */
export function tokenExpiresAt(tok: TokenStore): number {
  // Prefer an absolute expires_at; fall back to _obtained_at + expires_in;
  // if neither is present, treat as already expired.
  return tok.expires_at ?? (tok._obtained_at ?? 0) + (tok.expires_in ?? 1800);
}

/**
 * Stamp `_obtained_at`/`expires_at` onto a fresh token response (mutates and
 * returns it). `expires_in` defaults to 1800s (30 min) when Xero omits it.
 */
export function stampExpiry(tok: TokenStore): TokenStore {
  const now = Math.floor(Date.now() / 1000);
  tok._obtained_at = now;
  tok.expires_at = now + (tok.expires_in ?? 1800);
  return tok;
}
