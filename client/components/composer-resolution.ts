export const CHAT_COMPOSER_OWNER_ATTRIBUTE = "data-chat-composer-owner";
export const CHAT_COMPOSER_ROOT_ATTRIBUTE = "data-chat-composer-root";

/** DOM access stays at the boundary so owner routing can be checked in memory. */
export interface ComposerResolutionPort<Node, Field> {
  parent(node: Node): Node | null;
  owner(node: Node): string | null;
  destinations(source: Node): Iterable<Node>;
  destinationOwner(root: Node): string | null;
  fields(root: Node): Iterable<Field>;
  available(field: Field): boolean;
}

function validOwner(value: string): boolean {
  try {
    const key: unknown = JSON.parse(value);
    return Array.isArray(key) && key.length === 2
      && key.every((part: unknown) => typeof part === "string" && part.length > 0)
      && JSON.stringify(key) === value;
  } catch {
    return false;
  }
}

/** An explicit source is authoritative even when it has no usable destination. */
export function resolveComposer<Node, Field>(from: Node | null, port: ComposerResolutionPort<Node, Field>): Field | null {
  if (from === null) return null;
  for (let source: Node | null = from; source !== null; source = port.parent(source)) {
    const owner = port.owner(source);
    if (owner === null) continue;
    if (!validOwner(owner)) return null;
    for (const root of port.destinations(from)) {
      if (port.destinationOwner(root) !== owner) continue;
      for (const field of port.fields(root)) {
        if (port.available(field)) return field;
      }
    }
    return null;
  }
  // Older hosts have no ownership marks and retain their ancestor search.
  for (let scope: Node | null = from; scope !== null; scope = port.parent(scope)) {
    for (const field of port.fields(scope)) {
      if (port.available(field)) return field;
    }
  }
  return null;
}
