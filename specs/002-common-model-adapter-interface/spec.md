# Feature Specification: Common Spec Model and Adapter Contract

**Feature Branch**: `002-common-model-adapter-interface`

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "Define the common spec model and adapter contract that every spec-framework adapter (Spec Kit, OpenSpec, BMAD, plain markdown) will implement. Types: Spec { id, title, status, dependsOn[], tasks[{id, text, done, phase?, parallel?}], artifacts[], branch?, source? } where source records which root (git worktree) the spec was read from; status is one of drafted | planned | ready | in-progress | review | done | blocked; Event { ts, role: planner|coder|human|git, specId?, kind, detail }. Adapter interface: detect(repo), discover(repo) (paths/globs to watch, accepting one or more roots because the planner and coder may use different git worktrees of the same repo), parse(files) -> Spec[]. Validate adapter output: unique spec ids, valid status values, dependsOn references that don't resolve, self-dependencies and dependency cycles are reported as issues and never crash the tool. Add an adapter registry with deterministic auto-detection (registration order breaks ties), where agent-visualizer.config.json may force an adapter with an \"adapter\" key (unknown name is a clear error listing available adapters). Add a debounced file watcher that re-runs discover and parse when watched files change and emits a spec-changed notification carrying the new snapshot and any issues; a failing parse keeps the last good snapshot and emits an error notification. The watcher is read-only. No concrete adapter in this feature; test with a stub adapter that lives only in the test fixtures. Core code must not mention any specific framework."

## User Scenarios & Testing *(mandatory)*

The people served by this feature are contributors: whoever writes an adapter for a spec framework, and whoever builds the views (board, graph, timeline) that consume specs. End users benefit indirectly, because every later view shows the same data in the same shape regardless of which framework a repo uses.

### User Story 1 - Write an adapter against one stable contract (Priority: P1)

An adapter author wants to teach the tool a new spec framework. They implement three operations: "does this framework apply to this repo?", "which files should be watched?", and "turn these files into specs". They get back specs in one shared shape (identity, title, status, dependencies, tasks, artifacts, branch, source). They never touch core code to do this.

**Why this priority**: Every later feature (Spec Kit, OpenSpec, BMAD and plain-markdown adapters, the board, the graph, the timeline) depends on this shared shape. Without it nothing else can be built in parallel or tested in isolation.

**Independent Test**: Register a stub adapter from the test fixtures that reports three specs. Ask the core for the current specs and confirm all three come back in the shared shape, with no framework-specific code anywhere in the core.

**Acceptance Scenarios**:

1. **Given** a stub adapter that recognizes a fixture repo and returns three valid specs, **When** the core loads specs for that repo, **Then** it returns exactly those three specs with id, title, status, dependencies, tasks, artifacts, branch and source preserved.
2. **Given** an adapter that returns tasks with and without the optional phase and parallel markers, **When** the specs are loaded, **Then** tasks keep their order and the optional markers are present only where the adapter supplied them.
3. **Given** a repo with two roots (two git worktrees of the same repo), **When** the adapter is asked what to watch and to parse, **Then** it receives both roots, and each returned spec records which root it was read from.
4. **Given** the core source code, **When** it is searched for the names of any specific spec framework, **Then** none appear.

---

### User Story 2 - Bad adapter output is reported, never fatal (Priority: P1)

A contributor's adapter, or a messy repo, produces data that does not fit the shared shape: two specs with the same id, an unknown status, a dependency on a spec that does not exist, a spec that depends on itself, or a dependency cycle. The tool keeps running and reports each problem clearly, so the contributor can find and fix it.

**Why this priority**: Spec files are written by people and agents and are frequently half-finished. A tool that crashes on the first malformed spec cannot be left running while work is in progress, which is its whole purpose.

**Independent Test**: Feed the validator a set of specs containing each kind of problem and confirm that every problem is reported with the spec it concerns, the valid specs are still returned, and nothing throws.

**Acceptance Scenarios**:

1. **Given** two specs with the same id, **When** they are validated, **Then** a duplicate-id issue names that id, the first occurrence is kept and the later one is excluded.
2. **Given** a spec whose status is not one of drafted, planned, ready, in-progress, review, done or blocked, **When** it is validated, **Then** an invalid-status issue names the spec and the bad value, and the spec is excluded.
3. **Given** a spec that depends on an id no other spec has, **When** it is validated, **Then** an unresolved-dependency issue names both ids and the spec is still returned.
4. **Given** a spec that lists itself as a dependency, **When** it is validated, **Then** a self-dependency issue is reported and the spec is still returned.
5. **Given** specs A → B → C → A, **When** they are validated, **Then** a single cycle issue lists the specs in the cycle and all three specs are still returned.
6. **Given** any combination of the above, **When** validation runs, **Then** it completes without error and returns both the accepted specs and the full list of issues.

---

### User Story 3 - The right adapter is chosen automatically, or by configuration (Priority: P2)

A developer points the tool at a repo and it works out which spec framework the repo uses. If more than one adapter recognizes the repo, the choice is predictable: the adapter registered first wins, and the developer can see which adapters matched. A developer whose repo is ambiguous, or who wants a specific adapter, sets an "adapter" key in the existing configuration file to force it.

**Why this priority**: Auto-detection is what makes the tool usable with zero setup on most repos. It only becomes meaningful once real adapters exist (from feature 003 on), so it ranks below the contract itself.

**Independent Test**: Register two stub adapters that both recognize a fixture repo and confirm the first registered is chosen, every time. Then set the "adapter" key to the second and confirm it is chosen. Then set it to a name that does not exist and confirm a clear error lists the available adapter names.

**Acceptance Scenarios**:

1. **Given** exactly one registered adapter that recognizes the repo, **When** the tool selects an adapter, **Then** that adapter is selected.
2. **Given** two adapters that both recognize the repo, **When** selection runs any number of times, **Then** the one registered first is selected every time, and the result also reports which adapters matched.
3. **Given** no adapter recognizes the repo and none is forced, **When** selection runs, **Then** the tool reports "no adapter" as a normal state (an empty spec list), not a crash.
4. **Given** the configuration names a registered adapter, **When** selection runs, **Then** that adapter is used even if another would have been detected first.
5. **Given** the configuration names an adapter that is registered but does not recognize the repo, **When** selection runs, **Then** the forced adapter is still used and a warning says it did not recognize the repo.
6. **Given** the configuration names an adapter that is not registered, **When** the tool starts, **Then** it stops with an error that names the unknown value and lists every available adapter name.
7. **Given** an adapter whose detection itself fails unexpectedly, **When** selection runs, **Then** that adapter is treated as not matching, the failure is reported, and other adapters are still considered.

---

### User Story 4 - Spec changes show up on their own (Priority: P2)

While the planner and coder work, spec files change constantly. The tool notices those changes on its own and produces a fresh, validated picture of all specs, so later views can update without anyone restarting anything. Bursts of changes (an editor saving several files, an agent writing a whole spec folder) produce one update, not dozens. If a change leaves the files temporarily unreadable, the tool keeps showing the last good picture and says what went wrong.

**Why this priority**: Live updates are central to the product, but the views that display them arrive in later features (006 onward). The behavior must be specified and tested now so those features can rely on it.

**Independent Test**: Start watching a fixture repo through a stub adapter. Change a watched file and confirm exactly one spec-changed notification arrives with the new picture. Make ten changes in quick succession and confirm they produce a single notification. Make the stub adapter fail and confirm an error notification arrives while the previous picture is kept.

**Acceptance Scenarios**:

1. **Given** watching has started, **When** it begins, **Then** an initial notification delivers the current picture (specs and issues) before any file changes.
2. **Given** watching has started, **When** one watched file changes, **Then** one spec-changed notification arrives carrying the complete new picture and its validation issues.
3. **Given** watching has started, **When** many watched files change within a short burst, **Then** a single notification arrives after the burst settles.
4. **Given** watching has started, **When** a new spec folder or file appears that the adapter would discover, **Then** it is picked up without restarting the watcher.
5. **Given** watching has started, **When** the adapter fails while parsing after a change, **Then** an error notification describes the failure and the last good picture remains the current one.
6. **Given** a later change fixes the problem, **When** parsing succeeds again, **Then** a normal spec-changed notification resumes with the new picture.
7. **Given** watching is stopped, **When** files change afterwards, **Then** no further notifications arrive and nothing is left running.
8. **Given** any amount of watching, **When** the observed repo is inspected afterwards, **Then** no file in it was created, modified or deleted by the tool.

---

### User Story 5 - Activity has a shared shape too (Priority: P3)

Later features turn agent sessions, commits and human actions into a timeline. Contributors building those features need one shared shape for an activity event: when it happened, who did it (planner, coder, human or git), which spec it concerns if known, what kind of event it is, and its details.

**Why this priority**: Nothing produces events yet (transcripts and git arrive in features 004 and 005), but defining the shape now keeps those features consistent and lets the timeline be designed against it.

**Independent Test**: Construct events of each role, with and without a spec reference, and confirm they validate. Construct events with a missing time or an unknown role and confirm each is rejected with a clear reason.

**Acceptance Scenarios**:

1. **Given** an event with a valid time, one of the four roles, a kind and details, **When** it is validated, **Then** it is accepted, with or without a spec reference.
2. **Given** an event with an unknown role or a missing or invalid time, **When** it is validated, **Then** it is rejected with a reason naming the field.

---

### Edge Cases

- A spec has no title: the spec is kept and its id is used as the title, with an issue noting the missing title.
- Two tasks in one spec share an id: both are kept in order and an issue names the duplicate task id.
- The same spec id is returned from two roots (worktrees): this is reported as a duplicate like any other; choosing which copy is authoritative is framework-specific and left to each adapter (feature 003 defines it for its framework).
- An adapter returns an empty list: that is a valid picture with no specs, not an error.
- A watched path does not exist yet, or disappears: watching continues; when it reappears it is picked up again.
- A watched folder cannot be read (permissions): an issue is reported and watching of everything else continues.
- A dependency cycle and an unresolved dependency involve the same spec: both issues are reported.
- Changes keep arriving continuously for a long time: a notification is still delivered at least once within a bounded time, so the picture never goes stale indefinitely.
- An editor saves a file by writing a temporary file and renaming it: this counts as one change.
- The configuration's "adapter" value has the wrong type (for example a number): the tool stops with an error naming the file and the problem, consistent with how other invalid configuration values are handled.

## Requirements *(mandatory)*

### Functional Requirements

**Shared model**

- **FR-001**: The system MUST define one shared spec shape containing: id, title, status, dependencies (list of spec ids), tasks, artifacts (list of file paths), an optional branch, and an optional source identifying the root the spec was read from.
- **FR-002**: The system MUST define a task shape containing: id, text, done (yes/no), an optional phase, and an optional parallel marker. Task order MUST be preserved as the adapter supplied it.
- **FR-003**: The status vocabulary MUST be exactly: drafted, planned, ready, in-progress, review, done, blocked.
- **FR-004**: The system MUST define one shared activity-event shape containing: a timestamp, a role (planner, coder, human or git), an optional spec id, a kind, and free-form details.

**Adapter contract**

- **FR-005**: An adapter MUST be able to declare, through three operations, (a) whether it applies to a repo, (b) which paths and patterns should be watched, and (c) how a set of files becomes a list of specs.
- **FR-006**: The watch-path and parse operations MUST accept one or more roots belonging to the same repo, so that specs in several git worktrees can be read together.
- **FR-007**: Each adapter MUST have a unique, stable name used for configuration and reporting.
- **FR-008**: Adding a new adapter MUST NOT require changes to core code beyond registering it.
- **FR-009**: Core code MUST NOT contain the name of, or logic specific to, any spec framework.

**Validation**

- **FR-010**: The system MUST validate every adapter result and return both the accepted specs and a list of issues; validation MUST never stop the tool.
- **FR-011**: Each issue MUST state its kind, the spec (and task, where relevant) it concerns, and a human-readable message.
- **FR-012**: Duplicate spec ids MUST be reported; the first occurrence MUST be kept and later ones excluded.
- **FR-013**: Specs with a status outside the vocabulary MUST be reported and excluded.
- **FR-014**: Dependencies that do not resolve to another spec MUST be reported; the spec MUST be kept.
- **FR-015**: Self-dependencies MUST be reported; the spec MUST be kept.
- **FR-016**: Dependency cycles MUST be reported once per cycle, listing the specs involved; the specs MUST be kept.
- **FR-017**: A missing title MUST be reported and the id used in its place; duplicate task ids within a spec MUST be reported and both tasks kept.
- **FR-018**: Events MUST be validated for a valid timestamp and a known role; invalid events MUST be rejected with a reason naming the field.

**Adapter selection**

- **FR-019**: The system MUST keep a registry of adapters in a defined order.
- **FR-020**: Auto-detection MUST be deterministic: among adapters that recognize the repo, the earliest registered MUST be selected, and the result MUST also list every adapter that matched.
- **FR-021**: When no adapter recognizes the repo and none is forced, the system MUST treat this as a normal state with no specs.
- **FR-022**: An adapter whose detection fails unexpectedly MUST be treated as not matching and the failure reported; selection MUST continue with the others.
- **FR-023**: The existing configuration file MUST accept an optional "adapter" key naming an adapter. When present and registered, that adapter MUST be used; if it does not recognize the repo, a warning MUST say so.
- **FR-024**: An "adapter" value that is not a registered name MUST stop the tool with an error naming the value and listing every available adapter name. A value of the wrong type MUST stop the tool with an error naming the file, consistent with the existing configuration errors.

**Watching**

- **FR-025**: The system MUST watch the paths the selected adapter declares and, on change, re-run both path discovery and parsing, so that newly created spec files and folders are included.
- **FR-026**: Watching MUST deliver an initial notification with the current picture when it starts.
- **FR-027**: After changes, the system MUST deliver a spec-changed notification carrying the complete new set of accepted specs and the full list of issues.
- **FR-028**: Bursts of changes MUST be coalesced into one notification delivered after a short quiet period. If changes never stop, a notification MUST still be delivered within a bounded maximum delay.
- **FR-029**: If parsing fails, the system MUST deliver an error notification describing the failure and MUST keep the last good picture as current.
- **FR-030**: Unreadable or missing watched paths MUST be reported without stopping the watching of other paths.
- **FR-031**: Stopping the watcher MUST stop all notifications and release everything it holds.
- **FR-032**: Watching and parsing MUST NOT create, modify or delete any file in the observed repo.

**Testing**

- **FR-033**: The feature MUST ship with a stub adapter that exists only in test fixtures, and with automated tests covering the contract, every validation rule, adapter selection (including ties, forcing, unknown names and failing detection), and watching (initial notification, single change, burst, new files, parse failure and recovery, stop, read-only).
- **FR-034**: Documentation MUST describe the shared model, the adapter contract, how to register an adapter, and the new "adapter" configuration key (per the constitution's documentation principle).

### Key Entities

- **Spec**: One unit of planned work as the tool understands it, independent of framework. Has an id, title, status, dependencies on other specs, ordered tasks, the files that make it up, and optionally the branch it belongs to and the root it was read from.
- **Task**: One step within a spec, with an id, text, whether it is done, and optional phase and parallel markers.
- **Activity Event**: Something that happened (a prompt, an edit, a test run, a commit, a status change), with when, who, which spec if known, what kind, and details.
- **Adapter**: A named plug-in that knows one spec framework: how to recognize it, what to watch, and how to read it.
- **Adapter Registry**: The ordered list of adapters the tool knows, plus the rule for choosing one for a repo.
- **Validation Issue**: A reported problem with adapter output: its kind, the spec or task concerned, and a message.
- **Snapshot**: The current picture of a repo: the accepted specs plus the issues found, as of one moment.
- **Notification**: A message from the watcher: an initial or spec-changed notification carrying a snapshot, or an error notification carrying a failure while the last good snapshot stays current.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new adapter can be added by writing only the adapter itself and one registration entry; zero lines of core code change.
- **SC-002**: 100% of the malformed-input cases listed in this spec produce a reported issue, and none of them stops the tool.
- **SC-003**: Adapter selection on the same repo contents produces the same result in 100% of repeated runs.
- **SC-004**: After a single spec file change, an updated picture is available within 1 second.
- **SC-005**: A burst of 20 changes within half a second produces exactly one notification.
- **SC-006**: Under a continuous stream of changes, the picture is never more than 5 seconds out of date.
- **SC-007**: After any amount of watching, the observed repo contains zero files created, modified or deleted by the tool.
- **SC-008**: A contributor can write a working adapter for a new framework using only the project documentation, without reading core source code.

## Assumptions

- Runtime, language and tooling are fixed by the constitution and by feature 001; they are not re-decided here.
- The quiet period for coalescing bursts defaults to a fraction of a second and the maximum delay to a few seconds; exact values are chosen at planning time and may become configurable later.
- Each notification carries the complete snapshot rather than a list of differences; consumers that need differences can compute them.
- Snapshots are held in memory only; nothing is persisted.
- Whether a spec is held up by unfinished dependencies is derived by consumers from dependency and status data (for the board's "blocked" highlight). The "blocked" status itself is set only when a framework explicitly marks a spec as blocked.
- Unknown extra fields in adapter output are ignored rather than rejected, so adapters can carry framework details without breaking the core.
- The set of event kinds is open (for example prompt, file-edit, bash, test-run, commit, status-change, spec-created); the role vocabulary is fixed at four for now and can be extended in a later feature.
- Selecting which copy of a spec is authoritative when it exists in several worktrees is framework-specific and belongs to each adapter; the core only reports duplicates.
- The only change to configuration is the new optional "adapter" key; the existing file location, precedence and error behavior from feature 001 are unchanged.
- This feature does not connect the watcher to the running server, the web page or any network channel; exposing snapshots to the UI is feature 006.
- No real framework adapter ships in this feature; the first is feature 003.
