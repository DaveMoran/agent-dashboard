# Feature Specification: Server Skeleton

**Feature Branch**: `001-server-skeleton`

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "Build the project skeleton for Agent Visualizer, a local read-only web UI. A Bun + TypeScript server started with `agent-visualizer <repo-path>` validates that the path is a directory, loads an optional `agent-visualizer.config.json` (from the target repo or cwd), and serves a health endpoint at `/api/health` returning the repo path and version. A Vite + React app is served by the same server (dev proxy in development, static build in production) and shows a placeholder page with the repo name. Support a `--port` flag with automatic fallback to a free port if the default is taken. On startup, write a small `server.json` (port, PID, repo path, start time) into the visualizer's own state directory (never into the target repo), and remove it on clean shutdown, so other tools can discover a running instance. Include `bun run dev`, `bun run build`, and `bun test` scripts."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Launch the visualizer against a repo (Priority: P1)

A developer runs `agent-visualizer <repo-path>` in a terminal, opens the printed local address in a browser, and sees a page that names the repo they pointed it at. This confirms the tool started, found the repo and is serving its interface.

**Why this priority**: Every later feature (specs board, timeline, live updates) depends on a running server that knows its target repo and serves a UI. It is the smallest slice that delivers a visible result.

**Independent Test**: Run the command against any existing directory, open the printed address, and confirm the page shows that directory's name. Requesting the health endpoint returns the repo path and the tool's version.

**Acceptance Scenarios**:

1. **Given** a valid directory, **When** the developer runs `agent-visualizer <repo-path>`, **Then** the terminal prints the local address and the page at that address shows the repo name.
2. **Given** the server is running, **When** the health endpoint `/api/health` is requested, **Then** it responds successfully with the absolute repo path and the tool version.
3. **Given** a path that does not exist or is a file rather than a directory, **When** the developer runs the command, **Then** it exits with a non-zero status and a clear message naming the problem, without starting a server.
4. **Given** no repo path is supplied, **When** the developer runs the command, **Then** it exits with a usage message.

---

### User Story 2 - Choose a port and survive port conflicts (Priority: P2)

A developer may already have something on the default port, or may want a specific one. They can pass a `--port` flag. If the requested or default port is taken, the tool picks a free port automatically and tells the developer which one it used.

**Why this priority**: Developers run many local services and often several visualizer instances; a startup that fails on a busy port would be a constant annoyance. It is secondary to the server working at all.

**Independent Test**: Occupy the default port with another process, start the tool, and confirm it starts on a different port and prints it. Start it with `--port` set to a free port and confirm it uses exactly that port.

**Acceptance Scenarios**:

1. **Given** the default port is free, **When** the tool starts without `--port`, **Then** it uses the default port.
2. **Given** `--port <n>` and port `n` is free, **When** the tool starts, **Then** it listens on `n`.
3. **Given** the chosen port is already in use, **When** the tool starts, **Then** it falls back to a free port and prints the port actually used.
4. **Given** an invalid `--port` value (non-numeric or outside the valid range), **When** the tool starts, **Then** it exits with a clear error.

---

### User Story 3 - Let other tools discover a running instance (Priority: P2)

While running, the tool records a small `server.json` (port, process ID, repo path, start time) in its own state directory so that other tools, such as a future launcher skill, can find out whether a visualizer is running for a given repo and where. On clean shutdown the record is removed. The record is never written into the target repo.

**Why this priority**: It unlocks the planned double-agent launcher, but nothing in the visual experience depends on it yet.

**Independent Test**: Start the tool, read `server.json` from the state directory and confirm it matches the running instance; stop the tool with an interrupt and confirm the record is gone. Confirm the target repo has no new files.

**Acceptance Scenarios**:

1. **Given** the tool has started, **When** `server.json` is read, **Then** it contains the actual port in use, the process ID, the absolute repo path and the start time.
2. **Given** the tool is running, **When** it receives an interrupt or terminate signal, **Then** it shuts down cleanly and `server.json` is removed.
3. **Given** a stale `server.json` left by a crashed instance, **When** a new instance starts for the same repo, **Then** the stale record is replaced, not treated as a conflict.
4. **Given** any run, **When** the target repo is inspected afterwards, **Then** it contains no files created or modified by the tool.

---

### User Story 4 - Optional configuration file (Priority: P3)

A developer can place an `agent-visualizer.config.json` in the target repo or in the current working directory to set defaults (for example the port). When absent, the tool runs with built-in defaults. When both exist, the one in the target repo wins. Command-line flags override the file.

**Why this priority**: Nothing in this feature requires configuration, but later features will, so the loading mechanism and precedence should exist from the start.

**Independent Test**: Place a config file setting a port, start the tool without flags and confirm it uses that port; then pass `--port` and confirm the flag wins; then remove the file and confirm defaults.

**Acceptance Scenarios**:

1. **Given** no config file anywhere, **When** the tool starts, **Then** it uses built-in defaults without warnings.
2. **Given** a config file in the target repo, **When** the tool starts, **Then** its values are applied.
3. **Given** config files in both the target repo and the current directory, **When** the tool starts, **Then** the target repo's file is used.
4. **Given** a config file that is not valid JSON, **When** the tool starts, **Then** it exits with an error naming the file and the problem.

---

### User Story 5 - Develop and build the tool (Priority: P3)

A contributor can start a development mode where UI changes reload live, produce a production build, and run the test suite, each with a single documented command (`bun run dev`, `bun run build`, `bun test`). In production mode the same server serves the built UI, so one process is all a user needs.

**Why this priority**: Required to build the rest of the tool, but invisible to end users.

**Independent Test**: Run each of the three commands from a clean checkout and confirm each completes successfully; run the built tool and confirm the UI loads from the single server process.

**Acceptance Scenarios**:

1. **Given** a clean checkout with dependencies installed, **When** `bun test` is run, **Then** the suite passes.
2. **Given** the same checkout, **When** `bun run build` is run, **Then** a production UI build is produced and the server serves it.
3. **Given** the same checkout, **When** `bun run dev` is run against a repo, **Then** the UI is reachable and edits to UI source appear without restarting the server.

---

### Edge Cases

- Repo path given as a relative path, `~`-prefixed path or with a trailing slash: it is resolved to an absolute, normalized path.
- Repo path is a symlink: the resolved real path is reported consistently in the page, health response and `server.json`.
- Repo path is a directory that is not a git repository: still accepted, since this feature does not require git.
- Repo path is a directory the user cannot read: exits with a clear permission error.
- State directory does not exist yet or is not writable: it is created if possible, otherwise the tool exits with a clear error rather than running undiscoverable.
- Two instances started for the same repo: the second does not silently overwrite a live first instance's record; it reports that an instance is already running (with its address).
- Instances for different repos run side by side without clashing records.
- Process killed abruptly (no clean shutdown): the stale record is detected and replaced on next start.
- Unknown flags are rejected with the usage message.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a command-line entry point `agent-visualizer <repo-path>` that starts a local web server for the given repo.
- **FR-002**: The system MUST validate that `<repo-path>` exists and is a readable directory before starting, and otherwise exit non-zero with a clear message.
- **FR-003**: The system MUST resolve the repo path to an absolute, normalized real path and use that value consistently everywhere it is shown or recorded.
- **FR-004**: The system MUST print the local address (including the actual port) on startup.
- **FR-005**: The system MUST serve a health endpoint at `/api/health` returning, at minimum, the absolute repo path and the tool's version.
- **FR-006**: The system MUST serve a web UI from the same server that shows a placeholder page including the repo name.
- **FR-007**: The system MUST support a `--port` flag, validate its value and use it when the port is free.
- **FR-008**: The system MUST fall back automatically to a free port when the requested or default port is in use, and report the port actually used.
- **FR-009**: The system MUST load an optional `agent-visualizer.config.json`, searching the target repo first and then the current working directory, with precedence: command-line flags, then config file, then built-in defaults.
- **FR-010**: The system MUST reject a config file that cannot be parsed, with an error identifying the file.
- **FR-011**: On startup, the system MUST write a `server.json` containing the port, process ID, absolute repo path and start time into the tool's own state directory, never into the target repo.
- **FR-012**: The system MUST remove `server.json` on clean shutdown (interrupt or terminate signal).
- **FR-013**: The system MUST replace a stale `server.json` (one whose process is no longer running) when starting for the same repo, and MUST refuse to start a second instance for a repo whose recorded instance is still alive, reporting its address.
- **FR-014**: The system MUST NOT create, modify or delete any file inside the target repo.
- **FR-015**: The project MUST expose single-command workflows for development (`bun run dev`), production build (`bun run build`) and tests (`bun test`).
- **FR-016**: In production mode the single server process MUST serve both the API and the built UI; in development mode UI requests MUST be proxied to the live-reloading UI dev server.
- **FR-017**: The project MUST include automated tests covering path validation, port selection and fallback, config loading and precedence, the health endpoint, and `server.json` creation and removal.
- **FR-018**: The repository `README.md` MUST document installation, usage, flags, the config file, the state directory and `server.json`, and the three development commands (per the constitution's documentation principle).

### Key Entities

- **Target repo**: The directory being observed; identified by its absolute real path; never modified.
- **Instance record (`server.json`)**: Port, process ID, repo path and start time of a running visualizer; one per target repo; lives in the tool's state directory.
- **Configuration**: Optional settings (initially the port) loaded from `agent-visualizer.config.json`, overridable by flags.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can go from running the command to seeing the repo name in the browser in under 5 seconds on a typical laptop.
- **SC-002**: With the default port occupied, the tool still starts successfully on the first attempt 100% of the time, and the printed address works.
- **SC-003**: After a clean shutdown, zero instance records remain for that run, and after any run the target repo has zero changed files.
- **SC-004**: Another program can determine whether an instance is running for a given repo, and at which address, by reading one record, with no network scan.
- **SC-005**: 100% of invalid invocations (missing path, bad path, bad port, malformed config) exit non-zero with a message that names the specific problem.
- **SC-006**: A new contributor can install, run, build and test the project by following only the README, with each of the three commands succeeding on the first try.

## Assumptions

- The runtime, language and UI toolchain are those fixed by the project constitution (Bun, TypeScript strict, React with Vite); they are not re-decided here.
- The default port is a fixed, unremarkable local port chosen at planning time (it only needs to be stable and documented).
- The state directory lives under the user's home directory in a folder owned by the tool (for example `~/.agent-visualizer/`), with one subfolder or file per target repo so instances for different repos don't collide.
- "Version" in the health response is the project's package version.
- The placeholder page is intentionally minimal; the board, timeline and live updates arrive in later features.
- Only a single target repo per running instance is supported; multi-repo views are out of scope.
- Reading or interpreting specs, transcripts or git history is out of scope; this feature only establishes the runnable skeleton.
- The `agent-visualizer` command is available via the package's declared binary (for example through `bun link` or running the entry file directly); publishing it to a registry is out of scope.
