import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/utils/api-error";
import { OccurrenceFormError } from "@/features/occurrences/occurrence-form";

/**
 * The occurrence report as the driver's action sends it (decisions 6.2 and
 * 6.3; docs/contratos-app/occurrences.md §3 and §7).
 *
 * The hook runs for real — its location capture, its validation, its body —
 * with the network edge (`submitOrQueue`) and the native modules replaced.
 * Pinned: the form's answers go out checked by the API's rules, never an
 * answer the API would refuse into the queue; `form_version` goes out in
 * every report; a report the tower must authorize shows "Aguardando
 * autorização da torre" on the stop at once; a refusal reaches the screen.
 */

vi.mock("react", () => ({
  useState: <T,>(initial: T) => [initial, () => undefined],
}));

const SUBMISSION_ID = "0b3c6c0e-8f7a-4a51-9d7e-2f1c5b8a9e01";

vi.mock("expo-crypto", () => ({ randomUUID: () => SUBMISSION_ID }));
vi.mock("expo-haptics", () => ({
  impactAsync: async () => undefined,
  ImpactFeedbackStyle: { Light: "light" },
}));

vi.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
  getCurrentPositionAsync: async () => ({ coords: { latitude: -15.6, longitude: -56.1 } }),
  getLastKnownPositionAsync: async () => null,
  Accuracy: { Balanced: 3 },
  PermissionStatus: { GRANTED: "granted" },
}));

const toasts: Array<{ type: string; text1: string; text2?: string; onPress?: () => void }> = [];

vi.mock("react-native-toast-message", () => ({
  default: {
    show: (toast: { type: string; text1: string; text2?: string; onPress?: () => void }) =>
      toasts.push(toast),
    hide: () => undefined,
  },
}));

const navigate = vi.fn();

vi.mock("expo-router", () => ({ router: { navigate: (...args: unknown[]) => navigate(...args) } }));

vi.mock("@/features/notifications/proof-feedback-store", () => ({
  markDeliveryProofSubmitted: async () => undefined,
}));

let cachedList: unknown = undefined;

vi.mock("@/providers/query-provider", () => ({
  queryClient: {
    invalidateQueries: async () => undefined,
    setQueryData: (_key: unknown, update: (old: unknown) => unknown) => {
      cachedList = update(cachedList);
    },
  },
}));

type SubmitInput = {
  endpoint: string;
  body: Record<string, unknown>;
  submissionId: string;
  onSent?: (response: unknown) => void | Promise<void>;
};

/** What the edge does with the next submission. */
let edge: (input: SubmitInput) => Promise<"sent" | "queued"> = async () => "queued";

const submitOrQueue = vi.fn((input: SubmitInput) => edge(input));

vi.mock("@/features/submissions/submit-or-queue", () => ({
  submitOrQueue: (input: SubmitInput) => submitOrQueue(input),
}));

let useDeliveryActions: typeof import("@/features/deliveries/hooks/use-delivery-actions").useDeliveryActions;

beforeAll(async () => {
  ({ useDeliveryActions } = await import("@/features/deliveries/hooks/use-delivery-actions"));
});

const FORM_TYPE = {
  name: "Cliente ausente",
  requires_authorization: true,
  form_version: 3,
  form_fields: [
    { key: "quem_atendeu", label: "Quem atendeu", type: "text", required: true, max_length: 20, multiline: false },
    { key: "volumes", label: "Volumes", type: "number", required: true, integer: true, min: 1 },
    { key: "ligou_cliente", label: "Ligou para o cliente", type: "boolean", required: true },
  ],
};

const lastBody = () => submitOrQueue.mock.calls.at(-1)![0].body;

beforeEach(() => {
  submitOrQueue.mockClear();
  toasts.length = 0;
  cachedList = undefined;
  edge = async () => "queued";
});

describe("what a report sends (contract §3, §7)", () => {
  it("form_version in every report — 1 for a type cached before forms", async () => {
    await useDeliveryActions("business-1").reportOccurrence({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      occurrenceTypeId: "type-1",
    });

    expect(lastBody()).toMatchObject({ occurrenceTypeId: "type-1", form_version: 1 });
    expect(lastBody()).not.toHaveProperty("form_answers");
  });

  it("the answers, checked and tidied, with the version the screen showed", async () => {
    const done = await useDeliveryActions("business-1").reportOccurrence({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      occurrenceTypeId: "type-ausente",
      occurrenceType: FORM_TYPE,
      answers: { quem_atendeu: "  Porteiro  João ", volumes: "2", ligou_cliente: false },
    });

    expect(done).toBe(true);
    expect(lastBody()).toMatchObject({
      client_submission_id: SUBMISSION_ID,
      occurrenceTypeId: "type-ausente",
      form_answers: { quem_atendeu: "Porteiro João", volumes: 2, ligou_cliente: false },
      form_version: 3,
    });
  });

  it("an answer the API would refuse never reaches the queue, and the screen hears why", async () => {
    const refusals: unknown[] = [];

    const done = await useDeliveryActions("business-1").reportOccurrence({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      occurrenceTypeId: "type-ausente",
      occurrenceType: FORM_TYPE,
      answers: { quem_atendeu: "Porteiro", volumes: "2,5" },
      onRefused: (error) => refusals.push(error),
    });

    expect(done).toBe(false);
    expect(submitOrQueue).not.toHaveBeenCalled();
    expect(refusals[0]).toBeInstanceOf(OccurrenceFormError);
    expect((refusals[0] as OccurrenceFormError).fieldErrors).toEqual({
      volumes: '"Volumes" deve ser um número inteiro.',
      ligou_cliente: 'Responda "Ligou para o cliente".',
    });
    expect(toasts.at(-1)).toMatchObject({
      type: "error",
      text1: "Não foi possível registrar a ocorrência.",
      text2: '"Volumes" deve ser um número inteiro.',
    });
  });
});

describe("the tower's authorization at the tap (decision 6.3)", () => {
  it("a PENDING answer puts 'Aguardando autorização da torre' on the stop at once", async () => {
    cachedList = {
      data: [
        { id: "delivery-1", status: "IN_TRANSIT", authorization_request: null },
        { id: "delivery-2", status: "IN_TRANSIT", authorization_request: null },
      ],
      occurrence_types: [],
    };

    edge = async (input) => {
      await input.onSent?.({
        message: "Ocorrência registrada. Aguardando autorização da torre.",
        data: { id: "occ-9", authorization_status: "PENDING", replayed: false },
      });

      return "sent";
    };

    await useDeliveryActions("business-1").reportOccurrence({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      occurrenceTypeId: "type-ausente",
      occurrenceType: FORM_TYPE,
      answers: { quem_atendeu: "Porteiro", volumes: "2", ligou_cliente: true },
    });

    const list = cachedList as { data: Array<{ id: string; authorization_request: unknown }> };

    expect(list.data[0].authorization_request).toMatchObject({
      occurrenceId: "occ-9",
      occurrenceTypeId: "type-ausente",
      occurrenceTypeName: "Cliente ausente",
      status: "PENDING",
      note: null,
    });
    expect(list.data[1].authorization_request).toBeNull();

    expect(toasts.at(-1)).toMatchObject({
      type: "success",
      text1: "Ocorrência registrada",
      text2: "Aguardando autorização da torre. A resposta chega aqui e por notificação.",
    });
  });

  // The server dates the request when it takes the report (created_at);
  // dated by the tap, the stop's "newest wins" read one date before the
  // reread and another after it.
  it("the request on the stop is dated by the API's answer, not by the tap", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });

    try {
      vi.setSystemTime(new Date("2026-09-29T15:02:00.000Z"));

      cachedList = {
        data: [{ id: "delivery-1", status: "IN_TRANSIT", authorization_request: null }],
        occurrence_types: [],
      };

      edge = async (input) => {
        // A slow photo upload on a weak signal, before the 201.
        vi.setSystemTime(new Date("2026-09-29T15:04:30.000Z"));

        await input.onSent?.({ data: { id: "occ-10", authorization_status: "PENDING" } });

        return "sent";
      };

      await useDeliveryActions("business-1").reportOccurrence({
        deliveryId: "delivery-1",
        recipientName: "Maria",
        occurrenceTypeId: "type-ausente",
        occurrenceType: FORM_TYPE,
        answers: { quem_atendeu: "Porteiro", volumes: "2", ligou_cliente: true },
      });

      expect(lastBody().occurred_at).toBe("2026-09-29T15:02:00.000Z");
      expect(
        (cachedList as { data: Array<{ authorization_request: { requestedAt: string } }> }).data[0]
          .authorization_request.requestedAt,
      ).toBe("2026-09-29T15:04:30.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a report that needs no authorization reads as before", async () => {
    edge = async (input) => {
      await input.onSent?.({ data: { id: "occ-1", authorization_status: "NOT_REQUIRED" } });
      return "sent";
    };

    await useDeliveryActions("business-1").reportOccurrence({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      occurrenceTypeId: "type-1",
    });

    expect(toasts.at(-1)).toMatchObject({
      text1: "Ocorrência registrada com sucesso!",
      text2: "O gestor foi avisado.",
    });
  });

  it("queued offline, a request for the tower says so", async () => {
    await useDeliveryActions("business-1").reportOccurrence({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      occurrenceTypeId: "type-ausente",
      occurrenceType: FORM_TYPE,
      answers: { quem_atendeu: "Porteiro", volumes: "1", ligou_cliente: true },
    });

    expect(toasts.at(-1)).toMatchObject({
      type: "info",
      text1: "Pedido de autorização salvo no aparelho",
    });
  });

  it("a refusal at the tap reaches the screen with its code (a form that changed)", async () => {
    const outdated = new ApiError(
      "O formulário deste tipo de ocorrência mudou desde que foi aberto. Revise as respostas e envie de novo.",
      409,
      "Conflict",
      "HTTP",
      "OCCURRENCE_FORM_OUTDATED",
    );

    edge = async () => {
      throw outdated;
    };

    const refusals: unknown[] = [];

    const done = await useDeliveryActions("business-1").reportOccurrence({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      occurrenceTypeId: "type-ausente",
      occurrenceType: FORM_TYPE,
      answers: { quem_atendeu: "Porteiro", volumes: "1", ligou_cliente: true },
      onRefused: (error) => refusals.push(error),
    });

    expect(done).toBe(false);
    expect(refusals).toEqual([outdated]);
  });
});

describe("'Falar com a central sobre isto' (tickets design §8.4)", () => {
  it("the success toast opens the chat on the occurrence's ticket", async () => {
    navigate.mockClear();

    edge = async (input) => {
      await input.onSent?.({
        data: {
          id: "occ-1",
          authorization_status: "NOT_REQUIRED",
          ticket: { id: "ticket-1", number: 128 },
        },
      });
      return "sent";
    };

    await useDeliveryActions("business-1").reportOccurrence({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      occurrenceTypeId: "type-1",
    });

    const toast = toasts.at(-1);
    expect(toast?.text1).toBe("Ocorrência registrada com sucesso!");

    toast?.onPress?.();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));

    expect(navigate.mock.calls[0][0]).toMatchObject({
      pathname: "/chat",
      params: {
        deliveryId: "delivery-1",
        recipient: "Maria",
        ticketId: "ticket-1",
        ticketNumber: "128",
      },
    });
  });

  it("without a ticket in the answer, the chat opens on the delivery (the API resolves it)", async () => {
    navigate.mockClear();

    edge = async (input) => {
      await input.onSent?.({ data: { id: "occ-1", authorization_status: "NOT_REQUIRED" } });
      return "sent";
    };

    await useDeliveryActions("business-1").reportOccurrence({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      occurrenceTypeId: "type-1",
    });

    toasts.at(-1)?.onPress?.();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));

    expect(navigate.mock.calls[0][0]).toMatchObject({
      pathname: "/chat",
      params: { deliveryId: "delivery-1", ticketId: "" },
    });
  });

  it("a queued report has no shortcut: the ticket does not exist yet", async () => {
    edge = async () => "queued";

    await useDeliveryActions("business-1").reportOccurrence({
      deliveryId: "delivery-1",
      recipientName: "Maria",
      occurrenceTypeId: "type-1",
    });

    expect(toasts.at(-1)?.onPress).toBeUndefined();
  });
});
