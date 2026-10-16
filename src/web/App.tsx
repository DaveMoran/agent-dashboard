import { useEffect, useState } from "react";

type Health = { status: string; repoPath: string; repoName: string; version: string };

type State = { kind: "loading" } | { kind: "ready"; health: Health } | { kind: "error"; message: string };

export function App() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((res) => {
        if (!res.ok) throw new Error(`Server answered ${res.status}`);
        return res.json() as Promise<Health>;
      })
      .then((health) => {
        if (!cancelled) setState({ kind: "ready", health });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setState({ kind: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") return <p>Loading…</p>;
  if (state.kind === "error") {
    return <p role="alert">Could not reach the Agent Visualizer server: {state.message}</p>;
  }
  return (
    <main>
      <h1>{state.health.repoName}</h1>
      <p>{state.health.repoPath}</p>
    </main>
  );
}
