import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { useTasks, type TasksHandle } from "../../client/tasks/data";
import { at, createFakePaseo, makeAgent } from "./helpers/fake-paseo";
import "./helpers/quiet-renderer";
vi.mock("react-native", () => import("./helpers/rn-mock"));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps a newer running update when an older confirmation read finishes", async () => {
  const old = makeAgent({ id: "task", status: "idle", updatedAt: at(10) });
  const fake = createFakePaseo({ agents: [old] });
  const refAgent = fake.paseo.agents.ref.bind(fake.paseo.agents);
  let release!: () => void;
  let readStarted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { readStarted = resolve; });
  vi.spyOn(fake.paseo.agents, "ref").mockImplementation((agent) => {
    const ref = refAgent(agent);
    return {
      ...ref,
      async refresh() {
        const snapshot = await ref.refresh();
        readStarted();
        await gate;
        return snapshot;
      },
    };
  });
  let tasks!: TasksHandle;
  function Probe() {
    tasks = useTasks(fake.paseo, { doneWindow: "all", includeDone: true });
    return null;
  }
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
  try {
    await act(async () => {
      fake.pushAgentSnapshot({ ...old, updatedAt: at(9) });
      await started;
    });
    await act(async () => {
      fake.upsertAgent({ ...old, status: "running", updatedAt: at(11), activeTurn: { turnId: "next", startedAt: at(11) } });
    });
    expect(tasks.counts.running).toBe(1);
    await act(async () => { release(); });
    expect(tasks.byId.get("task")).toMatchObject({ lane: "running", status: "running" });
    expect(tasks.counts.running).toBe(1);
    expect(tasks.lanes.done.cards.map((card) => card.id)).not.toContain("task");
  } finally {
    release();
    act(() => renderer.unmount());
    vi.restoreAllMocks();
  }
});

const cases = [
  { name: "initializing with an active turn", from: "idle", change: { status: "initializing", activeTurn: { turnId: "next", startedAt: at(11) } }, lane: "running", status: "running" },
  { name: "history initialization", from: "idle", change: { status: "initializing", activeTurn: null }, lane: "done", status: "done" },
  { name: "running", from: "idle", change: { status: "running" }, lane: "running", status: "running" },
  { name: "needs input", from: "idle", change: { status: "running", attentionReason: "permission", requiresAttention: true }, lane: "needs_input", status: "needs_input" },
  { name: "failed", from: "idle", change: { status: "error", lastError: "API error" }, lane: "review", status: "failed" },
  { name: "unread", from: "idle", change: { status: "idle", attentionReason: "finished", requiresAttention: true }, lane: "review", status: "unread" },
  { name: "done", from: "running", change: { status: "idle" }, lane: "done", status: "done" },
  { name: "closed", from: "running", change: { status: "closed" }, lane: "done", status: "done" },
  { name: "archived", from: "running", change: { status: "closed", archivedAt: at(11) }, lane: "archived", status: "archived" },
] satisfies Array<{ name: string; from: "idle" | "running"; change: Partial<ReturnType<typeof makeAgent>>; lane: string; status: string }>;

it.each(cases)("preserves $name when an older opposite-list snapshot arrives", async ({ from, change, lane, status }) => {
  const old = makeAgent({ id: "task", status: from, updatedAt: at(10) });
  const fake = createFakePaseo({ agents: [old] });
  const list = fake.paseo.agents.list.bind(fake.paseo.agents);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.spyOn(fake.paseo.agents, "list").mockImplementation(async (options) => {
    const result = await list(options);
    if (options?.filter?.statuses?.includes(from)) await gate;
    return result;
  });
  let tasks!: TasksHandle;
  function Probe() {
    tasks = useTasks(fake.paseo, { doneWindow: "all", includeDone: true, includeArchived: true });
    return null;
  }
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await act(async () => { renderer = TestRenderer.create(React.createElement(Probe)); });
  try {
    act(() => fake.upsertAgent({ ...old, ...change, updatedAt: at(11) }));
    expect(tasks.byId.get("task")).toMatchObject({ lane, status });
    await act(async () => { release(); });
    expect(tasks.byId.get("task")).toMatchObject({ lane, status });
    expect(tasks.lanes[lane as keyof typeof tasks.lanes].cards.map((card) => card.id)).toEqual(["task"]);
  } finally {
    release();
    act(() => renderer.unmount());
    vi.restoreAllMocks();
  }
});
