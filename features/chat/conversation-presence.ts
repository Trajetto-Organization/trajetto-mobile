/**
 * Whether the conversation tab is the focused screen (MOB-05).
 *
 * While it is, and the app is in the foreground, the conversation fetches the
 * head of the thread itself on every return and reconnection, and confirms
 * delivery from that page (`absorbPageMeta`). `useChatRealtime`'s own
 * reconciliation GET would download the same messages a second time, so it
 * reads this and steps aside.
 *
 * Kept as a set of owners rather than a flag so a remount that overlaps the
 * previous instance cannot clear the other's state.
 */
const focusedOwners = new Set<object>();

function setConversationFocused(owner: object, focused: boolean): void {
  if (focused) {
    focusedOwners.add(owner);
  } else {
    focusedOwners.delete(owner);
  }
}

function conversationIsFocused(): boolean {
  return focusedOwners.size > 0;
}

export { conversationIsFocused, setConversationFocused };
