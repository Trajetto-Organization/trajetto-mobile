export type { FuelType } from "../hooks/use-fuel-type-infinite-scroll";
export type { Driver } from "../hooks/use-driver-infinite-scroll";

export type { Branch } from "../hooks/use-branch-infinite-scroll";

export interface FuelRecord {
  id: string;
  vehicleId: string;
  driverId: string;
  fuelTypeId: string;
  branchId: string;
  businessId: string;
  current_mileage: number;
  liters_amount: number;
  price_per_liter: number;
  total_amount: number;
  refueling_date: string;
  odometer_photo_url?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  vehicle?: {
    model: string;
    brand: string;
    license_plate: string;
  };
  driver?: {
    name: string;
    cnh: string;
  };
  fuelType?: {
    name: string;
  };
  branch?: {
    name: string;
  };
}

export interface CreateFuelRequest {
  vehicleId: string;
  driverId: string;
  fuelTypeId: string;
  branchId: string;
  current_mileage: number;
  liters_amount: number;
  price_per_liter: number;
  refueling_date: string;
  odometer_photo: File | null;
  notes?: string;
}

export interface FuelFormData {
  vehicleId: string;
  driverId: string;
  fuelTypeId: string;
  branchId: string;
  businessId: string;
  current_mileage: string;
  liters_amount: string;
  price_per_liter: string;
  refueling_date: string;
  notes?: string;
}
