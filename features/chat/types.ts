type ChatMessageKind = "TEXT" | "IMAGE" | "AUDIO";

interface ChatPerson {
  id: string;
  name: string;
}

/** A message as the API presents it: attachment already a signed URL. */
interface ChatMessage {
  id: string;
  kind: ChatMessageKind;
  body: string | null;
  attachment_url: string | null;
  duration_ms: number | null;
  deliveryId: string | null;
  broadcast_id: string | null;
  client_submission_id: string | null;
  threadId: string;
  senderId: string;
  sender: ChatPerson;
  delivery: { id: string; recipient_name: string; status: string } | null;
  created_at: string;
}

/**
 * A message as the screen renders it: the server shape plus the optimistic
 * lifecycle. `pending` shows the clock, `failed` offers the retry — the
 * client_submission_id makes that retry safe by construction. `localUri`
 * keeps the picked file so a failed upload can try again.
 */
interface ClientChatMessage extends ChatMessage {
  pending?: boolean;
  failed?: boolean;
  localUri?: string;
  localFileSize?: number;
  localMimeType?: string;
}

interface ChatMessagesResponse {
  threadId: string | null;
  data: ChatMessage[];
  nextCursor: { created_at: string; id: string } | null;
  counterpartLastReadAt: string | null;

  /**
   * How far the other side has confirmed RECEIVING this side's messages.
   *
   * For the driver this is the staff cursor: the most advanced confirmation
   * any of the company's open panels has sent. It used to arrive null on this
   * side and is now filled in, which is what turns the single check into the
   * grey double one.
   */
  counterpartDeliveredAt: string | null;
}

/**
 * The socket counterpart of `counterpartDeliveredAt`. The driver only ever
 * receives `side: "STAFF"`, but the side is on the wire so the reader can
 * prove it rather than assume it.
 */
interface ChatDeliveredEvent {
  threadId: string;
  side: "DRIVER" | "STAFF";
  driverUserId: string | null;
  delivered_at: string;
}

interface ChatThreadsResponse {
  data: Array<{ id: string; unreadCount: number }>;
  total: number;
  totalUnread: number;
}

export type {
  ChatMessageKind,
  ChatPerson,
  ChatMessage,
  ClientChatMessage,
  ChatMessagesResponse,
  ChatDeliveredEvent,
  ChatThreadsResponse,
};
