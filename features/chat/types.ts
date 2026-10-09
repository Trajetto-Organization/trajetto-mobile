type ChatMessageKind = "TEXT" | "IMAGE" | "AUDIO";

interface ChatPerson {
  id: string;
  name: string;
}

/** The route a message was said during, as the API tags it (decision 6.7). */
interface ChatRouteTag {
  id: string;
  code: number;
  name: string | null;
}

/** A message as the API presents it: attachment already a signed URL. */
interface ChatMessage {
  id: string;
  kind: ChatMessageKind;
  body: string | null;
  attachment_url: string | null;
  duration_ms: number | null;
  deliveryId: string | null;

  /**
   * Optional: an API older than decision 6.7 sends neither key, and the
   * bubble must still render its messages.
   */
  routeId?: string | null;
  route?: ChatRouteTag | null;

  broadcast_id: string | null;
  client_submission_id: string | null;
  threadId: string;
  senderId: string;
  sender: ChatPerson;
  delivery: { id: string; recipient_name: string; status: string } | null;
  created_at: string;

  /**
   * The support ticket (decision 14.5) the message belongs to. Optional: the
   * 7-day cache holds messages from before the tickets, and a mass notice
   * has none.
   */
  ticketId?: string | null;
}

/**
 * A ticket as the driver sees it (never who handles it at the company). The
 * page of messages and the `supportTicket` event both carry this view.
 */
interface DriverTicket {
  id: string;
  number: number;
  kind?: string;
  status: "OPEN" | "CLOSED";
  subject: string;
  version: number;
  close_outcome?: "RESOLVED" | "APPROVED" | "DENIED" | "MIGRATED" | null;
  close_note?: string | null;
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

  /**
   * Arrived by socket while the list may have a hole below it (the socket
   * dropped, or the catch-up that began with it up has not landed yet).
   * Real, but no evidence that the history on screen reaches up to it — see
   * `mergeNewestPage` — and never reported as read (`readCursorFor`). A page
   * that covers it replaces it with the server's copy; a catch-up that began
   * with the socket up and landed clears the mark (`clearGapMarks`).
   */
  afterGap?: boolean;
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

  /** Decision 14.5: the tickets of this page's messages (driver's view). */
  tickets?: DriverTicket[];

  /**
   * Decision 14.5: how far the tower read each ticket of this page (a ticket
   * read moves only that ticket's cursor). Absent from an older API.
   */
  counterpartTicketReadAt?: Record<string, string>;
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
  DriverTicket,
  ChatMessageKind,
  ChatPerson,
  ChatRouteTag,
  ChatMessage,
  ClientChatMessage,
  ChatMessagesResponse,
  ChatDeliveredEvent,
  ChatThreadsResponse,
};
