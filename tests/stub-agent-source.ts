import type {
  AgentSession,
  AgentSource,
  AgentSourceEvent,
} from "../src/agents/source";

export function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    sessionId: "s1",
    source: "stub",
    projectId: "/p/.git",
    projectName: "p",
    cwd: "/p",
    model: "claude-opus-5-5",
    isMain: true,
    state: "standby",
    runningSubagents: 0,
    stateSince: undefined,
    lastActivity: "2026-10-15T10:00:00.000Z",
    ...overrides,
  };
}

export function createStubAgentSource(initial: AgentSession[]): AgentSource & {
  emit(event: AgentSourceEvent): void;
  setSessions(sessions: AgentSession[]): void;
} {
  let current = [...initial];
  let stopped = false;
  const listeners = new Set<(event: AgentSourceEvent) => void>();
  return {
    name: "stub",
    async start() {
      stopped = false;
    },
    async stop() {
      stopped = true;
      listeners.clear();
    },
    sessions: () => [...current],
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    issues: () => [],
    emit(event) {
      if (stopped) return;
      for (const l of [...listeners]) {
        try {
          l(event);
        } catch {
          // a throwing listener must not stop the others
        }
      }
    },
    setSessions(sessions) {
      current = [...sessions];
    },
  };
}
