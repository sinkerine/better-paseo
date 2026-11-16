import { describe, expect, it } from "vitest";
import { resolveComposer, type ComposerResolutionPort } from "../../client/components/composer-resolution";

interface Region {
  parent: Region | null;
  document: Region[];
  owner: string | null;
  destination: string | null;
  fields: Draft[];
}
interface Draft {
  name: string;
  visible: boolean;
  readOnly: boolean;
  disabled: boolean;
}

/** In-memory adapter for the production resolver's public access port. */
function setup() {
  const document: Region[] = [];
  const searched: Region[] = [];
  const port: ComposerResolutionPort<Region, Draft> = {
    parent: (node) => node.parent,
    owner: (node) => node.owner,
    destinations: (source) => source.document,
    destinationOwner: (root) => root.destination,
    fields(root) { searched.push(root); return root.fields; },
    available: (draft) => draft.visible && !draft.readOnly && !draft.disabled,
  };
  const region = (values: Partial<Region> = {}): Region => ({
    parent: null, document, owner: null, destination: null, fields: [], ...values,
  });
  const draft = (name: string, values: Partial<Draft> = {}): Draft => ({
    name, visible: true, readOnly: false, disabled: false, ...values,
  });
  return { document, searched, port, region, draft };
}

const own = JSON.stringify(["server-a", "parent-a"]);
const other = JSON.stringify(["server-a", "parent-b"]);

describe("composer owner resolution", () => {
  it("routes a sibling pane to its visible unfocused destination after another parent's earlier root", () => {
    const f = setup();
    const wrong = f.draft("wrong parent");
    const main = f.draft("own parent");
    const btw = f.draft("BTW composer");
    f.document.push(f.region({ destination: other, fields: [wrong] }), f.region({ destination: own, fields: [main] }));
    const source = f.region({ owner: own, fields: [btw] });
    expect(resolveComposer(source, f.port)).toBe(main);
    expect(f.searched).toEqual([f.document[1]]);
  });

  it.each(["", "invalid", "null", "[]", '["server-a"]', '["server-a",""]', '["server-a",1]', '["server-a","parent-a","extra"]', '[ "server-a", "parent-a" ]'])(
    "refuses the explicit invalid key %j without searching ancestor drafts", (owner) => {
      const f = setup();
      const fallback = f.region({ fields: [f.draft("unsafe fallback")] });
      const source = f.region({ owner, parent: fallback });
      f.document.push(f.region({ destination: owner, fields: [f.draft("invalid destination")] }));
      expect(resolveComposer(source, f.port)).toBeNull();
      expect(f.searched).toEqual([]);
    },
  );

  it("does not confuse identical parent IDs on different servers", () => {
    const f = setup();
    const main = f.draft("own server");
    f.document.push(
      f.region({ destination: JSON.stringify(["server-b", "parent-a"]), fields: [f.draft("wrong server")] }),
      f.region({ destination: own, fields: [main] }),
    );
    expect(resolveComposer(f.region({ owner: own }), f.port)).toBe(main);
    expect(f.searched).toEqual([f.document[1]]);
  });

  it("refuses a missing destination even when an ancestor or source has a composer", () => {
    const f = setup();
    const ancestor = f.region({ fields: [f.draft("another parent's draft")] });
    const source = f.region({ owner: own, parent: ancestor, fields: [f.draft("BTW draft")] });
    f.document.push(f.region({ destination: other, fields: [f.draft("wrong destination")] }));
    expect(resolveComposer(source, f.port)).toBeNull();
    expect(f.searched).toEqual([]);
  });

  it.each(["visible", "readOnly", "disabled"] as const)("refuses an unavailable %s field without a wrong-parent fallback", (property) => {
    const f = setup();
    const unavailable = f.draft("unavailable", { [property]: property !== "visible" });
    const ancestor = f.region({ fields: [f.draft("unsafe fallback")] });
    f.document.push(f.region({ destination: own, fields: [unavailable] }));
    expect(resolveComposer(f.region({ owner: own, parent: ancestor }), f.port)).toBeNull();
    expect(f.searched).toEqual([f.document[0]]);
  });

  it("skips unavailable own fields and accepts an available field with the exact opaque key", () => {
    const f = setup();
    const key = JSON.stringify(['server"[x]', "parent\\with/slash"]);
    const available = f.draft("own draft");
    f.document.push(f.region({ destination: key, fields: [f.draft("hidden", { visible: false }), available] }));
    expect(resolveComposer(f.region({ owner: key }), f.port)).toBe(available);
  });

  it("does not consult a destination in a different document with the same key", () => {
    const f = setup();
    const foreign = [f.region({ destination: own, fields: [f.draft("foreign draft")] })];
    const source = f.region({ owner: own });
    expect(resolveComposer(source, f.port)).toBeNull();
    expect(f.searched).toEqual([]);
    source.document = foreign;
    expect(resolveComposer(source, f.port)?.name).toBe("foreign draft");
  });

  it("inherits the closest source in nested and preview content, including a refusal boundary", () => {
    const f = setup();
    const main = f.draft("own main");
    f.document.push(f.region({ destination: own, fields: [main] }), f.region({ destination: other, fields: [f.draft("outer main")] }));
    const outer = f.region({ owner: other });
    const preview = f.region({ owner: own, parent: outer });
    const selection = f.region({ parent: f.region({ parent: preview }) });
    expect(resolveComposer(selection, f.port)).toBe(main);
    preview.owner = "";
    expect(resolveComposer(selection, f.port)).toBeNull();
  });

  it("allows the real main root to be both source and destination", () => {
    const f = setup();
    const main = f.draft("main");
    const root = f.region({ owner: own, destination: own, fields: [main] });
    f.document.push(root);
    expect(resolveComposer(f.region({ parent: root }), f.port)).toBe(main);
  });

  it("keeps the nearest visible legacy ancestor behavior on unmarked surfaces", () => {
    const f = setup();
    const ownDraft = f.draft("legacy own");
    const ancestor = f.region({ fields: [f.draft("hidden tab", { visible: false }), ownDraft] });
    const source = f.region({ parent: ancestor });
    expect(resolveComposer(source, f.port)).toBe(ownDraft);
    expect(f.searched).toEqual([source, ancestor]);
    expect(resolveComposer(null, f.port)).toBeNull();
  });
});
