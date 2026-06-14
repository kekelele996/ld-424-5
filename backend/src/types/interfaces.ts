import { Request } from 'express';
import { HazardLevel, ItemType, Role, StorageCondition } from './enums';

export interface AuthUser {
  id: string;
  role: Role;
  name?: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export enum BatchExpiryStatus {
  Expired = 'Expired',
  Urgent = 'Urgent',
  Warning = 'Warning',
  Normal = 'Normal',
}

export interface BatchExpiryItem {
  reagentId: string;
  reagentName: string;
  casNumber?: string;
  molecularFormula: string;
  purityGrade: string;
  hazardLevel: HazardLevel;
  storageCondition: StorageCondition;
  unit: string;
  location: string;
  batchNumber: string;
  stockInRecordId: string;
  stockInDate: Date;
  productionDate?: string;
  expirationDate?: string;
  stockInQuantity: number;
  estimatedRemaining: number;
  daysUntilExpiry?: number;
  status: BatchExpiryStatus;
}

export interface BatchExpirySummary {
  totalBatches: number;
  expiredCount: number;
  urgentCount: number;
  warningCount: number;
  normalCount: number;
  totalRemainingQuantity: number;
}

export interface BatchExpiryViewResult {
  items: BatchExpiryItem[];
  summary: BatchExpirySummary;
  urgentDaysThreshold: number;
  warningDaysThreshold: number;
}
