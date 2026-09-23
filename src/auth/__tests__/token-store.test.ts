import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  persistTokens,
  readTokens,
  TOKEN_LOCK_STALE_MS,
  tokenExpiresAt,
  withTokenLock,
} from "../token-store.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "token-store-"));
  file = path.join(dir, "tokens.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("persistTokens", () => {
  it("writes a 0600 file and leaves no temp files behind", () => {
    persistTokens(file, { access_token: "a", refresh_token: "r" });

    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(readTokens(file)).toEqual({ access_token: "a", refresh_token: "r" });
    expect(fs.readdirSync(dir)).toEqual(["tokens.json"]);
  });

  it("is not affected by a leftover temp file with loose permissions", () => {
    fs.writeFileSync(`${file}.tmp`, "stale", { mode: 0o644 });

    persistTokens(file, { access_token: "a", refresh_token: "r" });

    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("refuses a token set without a refresh token", () => {
    expect(() =>
      persistTokens(file, { access_token: "a", refresh_token: "" }),
    ).toThrow(/refresh_token/);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("readTokens", () => {
  it("does not quote file contents when the JSON is corrupt", () => {
    fs.writeFileSync(file, '{"refresh_token": "secret-value"');

    expect(() => readTokens(file)).toThrow(/not valid JSON/);
    expect(() => readTokens(file)).not.toThrow(/secret-value/);
  });
});

describe("tokenExpiresAt", () => {
  it("prefers expires_at, then _obtained_at + expires_in", () => {
    const base = { access_token: "a", refresh_token: "r" };
    expect(tokenExpiresAt({ ...base, expires_at: 50, _obtained_at: 1 })).toBe(50);
    expect(tokenExpiresAt({ ...base, _obtained_at: 10, expires_in: 5 })).toBe(15);
    expect(tokenExpiresAt(base)).toBe(1800);
  });
});

describe("withTokenLock", () => {
  it("serialises concurrent holders", async () => {
    const events: string[] = [];
    const hold = (name: string) =>
      withTokenLock(file, async () => {
        events.push(`${name}:start`);
        await new Promise((resolve) => setTimeout(resolve, 150));
        events.push(`${name}:end`);
      });

    await Promise.all([hold("a"), hold("b")]);

    expect(events).toHaveLength(4);
    expect(events[0].split(":")[0]).toBe(events[1].split(":")[0]);
    expect(events[2].split(":")[0]).toBe(events[3].split(":")[0]);
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });

  it("releases the lock when the holder throws", async () => {
    await expect(
      withTokenLock(file, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });

  it("breaks a stale lock left by a dead holder", async () => {
    const lock = `${file}.lock`;
    fs.writeFileSync(lock, "");
    const past = (Date.now() - TOKEN_LOCK_STALE_MS - 1000) / 1000;
    fs.utimesSync(lock, past, past);

    await expect(withTokenLock(file, async () => "ran")).resolves.toBe("ran");
  });
});
