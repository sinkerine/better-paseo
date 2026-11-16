export type SelectionChatResult = "Added" | "Copying" | "Copied instead" | "Couldn't copy";

export interface SelectionChatActionPort {
  insert(snippet: string): boolean;
  copy(text: string): Promise<void>;
  show(result: SelectionChatResult): void;
  pending(value: boolean): void;
}

/** A refused destination copies raw text and reports success only after the write settles. */
export async function addSelectionToChat(snippet: string, text: string, port: SelectionChatActionPort): Promise<void> {
  if (port.insert(snippet)) {
    port.show("Added");
    return;
  }
  port.pending(true);
  port.show("Copying");
  try {
    await port.copy(text);
    port.show("Copied instead");
  } catch {
    port.show("Couldn't copy");
  } finally {
    port.pending(false);
  }
}
