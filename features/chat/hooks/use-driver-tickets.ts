import { useCallback, useState } from "react";

import { randomUUID } from "expo-crypto";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuthStore } from "@/store/auth-store";
import { apiClient } from "@/utils/api";

import type { DriverTicket } from "../types";

/** The sheet lists at most this many open subjects; a driver has a handful. */
const SHEET_PAGE_SIZE = 20;

const DRIVER_TICKETS_KEY = "chat-driver-tickets";

interface OpenedTicketResponse {
  data: DriverTicket;
  created: boolean;
}

/**
 * The driver's open subjects for the composer's sheet (design §8.2), read
 * only while the sheet is up, and "Novo assunto". The API answers the
 * driver's reduced view: his own tickets, never who handles them.
 */
function useDriverTickets(sheetOpen: boolean) {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();

  const queryKey = [DRIVER_TICKETS_KEY, user?.businessId ?? ""];

  const query = useQuery({
    queryKey,
    enabled: sheetOpen,
    // Opening the sheet is asking "what is open now": never a stale list.
    staleTime: 0,
    queryFn: () =>
      apiClient.get<{ data: DriverTicket[] }>(
        `/chat/tickets?status=OPEN&pageSize=${SHEET_PAGE_SIZE}`,
      ),
  });

  const [isOpening, setIsOpening] = useState<boolean>(false);

  /**
   * "Novo assunto": during a route the API answers that route's ticket, else
   * a new general one. The key makes a double tap one subject.
   */
  const openNewSubject = useCallback(async (): Promise<OpenedTicketResponse> => {
    setIsOpening(true);

    try {
      const opened = await apiClient.request<OpenedTicketResponse>("/chat/tickets", {
        method: "POST",
        headers: { "Idempotency-Key": randomUUID() },
        body: {},
      });

      void queryClient.invalidateQueries({ queryKey: [DRIVER_TICKETS_KEY] });

      return opened;
    } finally {
      setIsOpening(false);
    }
  }, [queryClient]);

  return {
    tickets: query.data?.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    openNewSubject,
    isOpening,
  };
}

export { useDriverTickets, DRIVER_TICKETS_KEY };
