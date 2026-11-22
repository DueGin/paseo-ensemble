import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OutsideProjectError, projectFile, removeProjectFile, within, writeProjectFile } from "../server/common";

describe("writing only inside the project", () => {
  let root: string;
  let elsewhere: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "project-files-"));
    elsewhere = mkdtempSync(join(tmpdir(), "project-elsewhere-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it("writes a file in the project, creating its folders", async () => {
    const path = await writeProjectFile(root, ".agents/teams/web.json", "{}\n");
    expect(path).toBe(join(realpathSync(root), ".agents/teams/web.json"));
    expect(readFileSync(join(root, ".agents/teams/web.json"), "utf8")).toBe("{}\n");
  });

  it("works when the project's own path goes through a link (as /tmp does on macOS)", async () => {
    const linkedRoot = join(elsewhere, "linked-root");
    symlinkSync(root, linkedRoot);
    await writeProjectFile(linkedRoot, ".agents/runs/R0001.json", "{}\n");
    expect(readFileSync(join(root, ".agents/runs/R0001.json"), "utf8")).toBe("{}\n");
  });

  it("refuses a file that is a link out of the project, and leaves the outside file alone", async () => {
    mkdirSync(join(root, ".agents/teams"), { recursive: true });
    writeFileSync(join(elsewhere, "secret.json"), "keep\n");
    symlinkSync(join(elsewhere, "secret.json"), join(root, ".agents/teams/web.json"));
    await expect(writeProjectFile(root, ".agents/teams/web.json", "{}\n")).rejects.toBeInstanceOf(OutsideProjectError);
    expect(readFileSync(join(elsewhere, "secret.json"), "utf8")).toBe("keep\n");
  });

  it.each([".agents/teams", ".agents"])("refuses a file under a folder (%s) that links out of the project", async (linked) => {
    mkdirSync(join(root, linked, ".."), { recursive: true });
    symlinkSync(elsewhere, join(root, linked));
    await expect(writeProjectFile(root, ".agents/teams/web.json", "{}\n")).rejects.toThrow("leads outside the project");
    expect(existsSync(join(elsewhere, "web.json"))).toBe(false);
    expect(existsSync(join(elsewhere, "teams"))).toBe(false);
  });

  it("refuses a link to nothing, so writing it can't create a file wherever it points", async () => {
    mkdirSync(join(root, ".claude"));
    symlinkSync(join(elsewhere, "missing.json"), join(root, ".claude/settings.local.json"));
    await expect(writeProjectFile(root, ".claude/settings.local.json", "{}\n")).rejects.toBeInstanceOf(OutsideProjectError);
    expect(existsSync(join(elsewhere, "missing.json"))).toBe(false);
  });

  it("refuses a path that climbs out of the project", async () => {
    await expect(projectFile(root, "../escape.json")).rejects.toBeInstanceOf(OutsideProjectError);
  });

  it("follows a link that stays inside the project, writing its target and keeping the link", async () => {
    mkdirSync(join(root, "teams"));
    writeFileSync(join(root, "teams/real.json"), "old\n");
    mkdirSync(join(root, ".agents/teams"), { recursive: true });
    symlinkSync(join(root, "teams/real.json"), join(root, ".agents/teams/web.json"));
    await writeProjectFile(root, ".agents/teams/web.json", "new\n");
    expect(readFileSync(join(root, "teams/real.json"), "utf8")).toBe("new\n");
    expect(lstatSync(join(root, ".agents/teams/web.json")).isSymbolicLink()).toBe(true);
  });

  it("removes a link itself, never the file it points to", async () => {
    mkdirSync(join(root, ".agents/teams"), { recursive: true });
    writeFileSync(join(elsewhere, "secret.json"), "keep\n");
    symlinkSync(join(elsewhere, "secret.json"), join(root, ".agents/teams/web.json"));
    await removeProjectFile(root, ".agents/teams/web.json");
    expect(existsSync(join(root, ".agents/teams/web.json"))).toBe(false);
    expect(readFileSync(join(elsewhere, "secret.json"), "utf8")).toBe("keep\n");
  });

  it("refuses to remove a file from a folder that links out of the project", async () => {
    mkdirSync(join(root, ".agents"));
    writeFileSync(join(elsewhere, "web.json"), "keep\n");
    symlinkSync(elsewhere, join(root, ".agents/teams"));
    await expect(removeProjectFile(root, ".agents/teams/web.json")).rejects.toBeInstanceOf(OutsideProjectError);
    expect(readFileSync(join(elsewhere, "web.json"), "utf8")).toBe("keep\n");
  });

  it("tells inside from outside by whole path parts", () => {
    expect(within("/p", "/p")).toBe(true);
    expect(within("/p", "/p/a/b")).toBe(true);
    expect(within("/p", "/p2/a")).toBe(false);
    expect(within("/p", "/")).toBe(false);
    expect(within("/p", "/p/..x")).toBe(true);
  });
});
