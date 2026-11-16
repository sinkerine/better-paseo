import { describe, expect, it } from "vitest";
import { addSelectionToChat, type SelectionChatActionPort, type SelectionChatResult } from "../../client/components/selection-chat-action";

function setup(inserted: boolean, copy: (text: string) => Promise<void> = async () => {}) {
  const snippets: string[] = [];
  const copied: string[] = [];
  const results: SelectionChatResult[] = [];
  const pending: boolean[] = [];
  const port: SelectionChatActionPort = {
    insert(snippet) { snippets.push(snippet); return inserted; },
    async copy(text) { copied.push(text); await copy(text); },
    show: (result) => { results.push(result); },
    pending: (value) => { pending.push(value); },
  };
  return { port, snippets, copied, results, pending };
}

describe("selection Add to chat action", () => {
  it.each(["> prose\n\n", "```\ncode\n```\n\n"])("passes the quoted snippet unchanged to a successful edit: %j", async (snippet) => {
    const f = setup(true);
    await addSelectionToChat(snippet, "raw", f.port);
    expect(f.snippets).toEqual([snippet]);
    expect(f.results).toEqual(["Added"]);
    expect(f.copied).toEqual([]);
    expect(f.pending).toEqual([]);
  });

  it("keeps Copying pending until the raw-text fallback resolves", async () => {
    let finish!: () => void;
    const f = setup(false, () => new Promise<void>((resolve) => { finish = resolve; }));
    const action = addSelectionToChat("> raw output\n\n", "raw output", f.port);
    expect(f.results).toEqual(["Copying"]);
    expect(f.pending).toEqual([true]);
    expect(f.copied).toEqual(["raw output"]);
    finish();
    await action;
    expect(f.results).toEqual(["Copying", "Copied instead"]);
    expect(f.pending).toEqual([true, false]);
  });

  it("reports a clipboard failure without success and permits retry", async () => {
    let calls = 0;
    const f = setup(false, async () => { if (++calls === 1) throw new Error("denied"); });
    await addSelectionToChat("> text\n\n", "text", f.port);
    expect(f.results).toEqual(["Copying", "Couldn't copy"]);
    expect(f.pending).toEqual([true, false]);
    await addSelectionToChat("> text\n\n", "text", f.port);
    expect(f.results).toEqual(["Copying", "Couldn't copy", "Copying", "Copied instead"]);
    expect(f.pending).toEqual([true, false, true, false]);
  });
});
