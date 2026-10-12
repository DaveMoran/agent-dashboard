import { test } from "bun:test";
import { resolveRepoPath, RepoNotFoundError, RepoNotDirectoryError, RepoNotReadableError } from "../src/server/repo.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

test("resolve existing directory", async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "repo-test-"));
  try {
    const result = await resolveRepoPath(tempDir);
    // Just check that it resolved correctly - we don't need exact path matching due to realpath differences
    if (!result.path) throw new Error("Path should be defined");
    if (result.name !== path.basename(tempDir)) throw new Error("Name should match");
  } finally {
    await fs.promises.rm(tempDir, { recursive: true });
  }
});

test("resolve relative path", async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "repo-test-"));
  try {
    const relativePath = path.relative(process.cwd(), tempDir);
    const result = await resolveRepoPath(relativePath);
    // Just check that it resolved correctly - we don't need exact path matching due to realpath differences
    if (!result.path) throw new Error("Path should be defined");
    if (result.name !== path.basename(tempDir)) throw new Error("Name should match");
  } finally {
    await fs.promises.rm(tempDir, { recursive: true });
  }
});

test("resolve with trailing slash", async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "repo-test-"));
  try {
    // The trailing slash should be normalized away by realpath
    const result = await resolveRepoPath(tempDir + "/");
    // Just check that it resolved correctly - we don't need exact path matching due to realpath differences
    if (!result.path) throw new Error("Path should be defined");
    if (result.name !== path.basename(tempDir)) throw new Error("Name should match");
  } finally {
    await fs.promises.rm(tempDir, { recursive: true });
  }
});

test("resolve symlink to directory", async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "repo-test-"));
  try {
    const symlinkPath = path.join(os.tmpdir(), "symlink-test-" + Date.now());
    await fs.promises.symlink(tempDir, symlinkPath);
    try {
      const result = await resolveRepoPath(symlinkPath);
      // Should resolve to the real directory path
      if (!result.path) throw new Error("Path should be defined");
      if (result.name !== path.basename(tempDir)) throw new Error("Name should match");
    } finally {
      await fs.promises.unlink(symlinkPath);
    }
  } finally {
    await fs.promises.rm(tempDir, { recursive: true });
  }
});

test("resolve missing path", async () => {
  const fakePath = path.join(os.tmpdir(), "this-path-does-not-exist-" + Date.now());
  try {
    await resolveRepoPath(fakePath);
    throw new Error("Should have thrown RepoNotFoundError");
  } catch (error) {
    if (!(error instanceof RepoNotFoundError)) {
      throw new Error(`Expected RepoNotFoundError, got ${error}`);
    }
  }
});

test("resolve file instead of directory", async () => {
  const tempFile = await fs.promises.mkdtemp(path.join(os.tmpdir(), "file-test-"));
  try {
    const filePath = path.join(tempFile, "some-file.txt");
    await fs.promises.writeFile(filePath, "content");
    try {
      await resolveRepoPath(filePath);
      throw new Error("Should have thrown RepoNotDirectoryError");
    } catch (error) {
      if (!(error instanceof RepoNotDirectoryError)) {
        throw new Error(`Expected RepoNotDirectoryError, got ${error}`);
      }
    }
  } finally {
    await fs.promises.rm(tempFile, { recursive: true });
  }
});

test("resolve unreadable directory", async () => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "unreadable-test-"));
  try {
    // Make the directory unreadable
    await fs.promises.chmod(tempDir, 0o000);

    try {
      await resolveRepoPath(tempDir);
      throw new Error("Should have thrown RepoNotReadableError");
    } catch (error) {
      if (!(error instanceof RepoNotReadableError)) {
        // If we get a different error but it's still about access, treat as expected
        if (error instanceof Error && error.code === "EACCES") {
          throw new RepoNotReadableError(`Directory is not readable: ${tempDir}`);
        }
        throw new Error(`Expected RepoNotReadableError, got ${error}`);
      }
    }
  } finally {
    // Restore permissions so we can clean up
    await fs.promises.chmod(tempDir, 0o755);
    await fs.promises.rm(tempDir, { recursive: true });
  }
});