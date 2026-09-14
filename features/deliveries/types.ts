import type { DeliveryStatus } from "./delivery-rules";

interface DriverDeliveryItem {
  id: string;
  description: string;
  quantity: string | number;
  unit?: string | null;
  unit_value?: string | number | null;
}

/** One stop of the day, as `/delivery/my-deliveries` serves it. */
interface DriverDelivery {
  id: string;
  code?: string | null;
  invoice_number?: string | null;
  status: DeliveryStatus;
  recipient_name: string;
  recipient_telephone?: string | null;
  street: string;
  address_number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city: string;
  uf: string;
  cep?: string | null;
  scheduled_date?: string | null;
  notes?: string | null;
  shipper?: { id: string; name: string } | null;
  items?: DriverDeliveryItem[];
}

/** The driver's occurrence vocabulary — active types only. */
interface DriverOccurrenceType {
  id: string;
  name: string;
  description: string | null;
  requires_photo: boolean;
  blocks_delivery: boolean;
}

interface MyDeliveriesResponse {
  data: DriverDelivery[];
  occurrence_types: DriverOccurrenceType[];
}

export type { DriverDelivery, DriverDeliveryItem, DriverOccurrenceType, MyDeliveriesResponse };
