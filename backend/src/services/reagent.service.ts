import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reagent } from '../models/reagent.entity';
import { StockInRecord } from '../models/stockInRecord.entity';
import { UsageRecord } from '../models/usageRecord.entity';
import { ItemType, UsageStatus } from '../types/enums';
import { AuthUser, BatchExpiryItem, BatchExpiryStatus, BatchExpirySummary, BatchExpiryViewResult } from '../types/interfaces';
import { AuditService } from './audit.service';
import { AlertService } from './alert.service';

const URGENT_DAYS_THRESHOLD = 30;
const WARNING_DAYS_THRESHOLD = 90;

interface FIFOStockIn {
  recordId: string;
  batchNumber: string;
  stockInDate: Date;
  productionDate?: string;
  expirationDate?: string;
  quantity: number;
  remaining: number;
}

function calcDaysUntil(dateStr: string | undefined, today: Date): number | undefined {
  if (!dateStr) return undefined;
  const expiry = new Date(dateStr);
  expiry.setHours(0, 0, 0, 0);
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  const diffMs = expiry.getTime() - t.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function classifyStatus(days: number | undefined): BatchExpiryStatus {
  if (days === undefined) return BatchExpiryStatus.Normal;
  if (days < 0) return BatchExpiryStatus.Expired;
  if (days <= URGENT_DAYS_THRESHOLD) return BatchExpiryStatus.Urgent;
  if (days <= WARNING_DAYS_THRESHOLD) return BatchExpiryStatus.Warning;
  return BatchExpiryStatus.Normal;
}

@Injectable()
export class ReagentService {
  constructor(
    @InjectRepository(Reagent) private readonly repo: Repository<Reagent>,
    @InjectRepository(StockInRecord) private readonly stockInRepo: Repository<StockInRecord>,
    @InjectRepository(UsageRecord) private readonly usageRepo: Repository<UsageRecord>,
    private readonly audit: AuditService,
    private readonly alerts: AlertService,
  ) {}

  list() {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  async create(payload: Partial<Reagent> & Record<string, unknown>, user: AuthUser) {
    const normalized: Partial<Reagent> = {
      ...payload,
      casNumber: String(payload.casNumber ?? payload.cas ?? ''),
      molecularFormula: String(payload.molecularFormula ?? payload.formula ?? ''),
      molecularWeight: Number(payload.molecularWeight ?? 0),
      purityGrade: String(payload.purityGrade ?? payload.purity ?? ''),
      currentStock: Number(payload.currentStock ?? payload.stock ?? 0),
      minStockThreshold: Number(payload.minStockThreshold ?? payload.minThreshold ?? 0),
    };
    const reagent = await this.repo.save(this.repo.create(normalized));
    await this.audit.record(user, 'CREATE_REAGENT', 'reagent', { id: reagent.id, hazardLevel: reagent.hazardLevel });
    await this.alerts.cacheLowStockAlert(reagent, 'reagent');
    return reagent;
  }

  async findOne(id: string) {
    const reagent = await this.repo.findOneBy({ id });
    if (!reagent) throw new NotFoundException('试剂不存在');
    return reagent;
  }

  async adjustStock(id: string, delta: number, user: AuthUser, action = 'ADJUST_REAGENT_STOCK') {
    const reagent = await this.findOne(id);
    reagent.currentStock = Number(reagent.currentStock) + delta;
    const saved = await this.repo.save(reagent);
    await this.audit.record(user, action, 'reagent', { id, delta, currentStock: saved.currentStock });
    await this.alerts.cacheLowStockAlert(saved, 'reagent');
    return saved;
  }

  async getBatchExpiryView(reagentId?: string): Promise<BatchExpiryViewResult> {
    const today = new Date();
    const reagentWhere = reagentId ? { id: reagentId } : {};
    const reagents = await this.repo.find({ where: reagentWhere, order: { name: 'ASC' } });
    if (reagentId && reagents.length === 0) throw new NotFoundException('试剂不存在');
    const reagentIds = reagents.map((r) => r.id);
    const reagentMap = new Map(reagents.map((r) => [r.id, r]));

    const stockIns = await this.stockInRepo.find({
      where: { itemType: ItemType.Reagent },
      order: { itemId: 'ASC', stockInDate: 'ASC' },
    });
    const filteredStockIns = reagentIds.length > 0 ? stockIns.filter((s) => reagentIds.includes(s.itemId)) : stockIns;

    const usages = await this.usageRepo.find({
      where: { itemType: ItemType.Reagent, approvalStatus: UsageStatus.Approved },
      order: { itemId: 'ASC', usageDate: 'ASC' },
    });
    const filteredUsages = reagentIds.length > 0 ? usages.filter((u) => reagentIds.includes(u.itemId)) : usages;

    const stockInsByReagent = new Map<string, FIFOStockIn[]>();
    for (const si of filteredStockIns) {
      if (!reagentMap.has(si.itemId)) continue;
      const arr = stockInsByReagent.get(si.itemId) ?? [];
      arr.push({
        recordId: si.id,
        batchNumber: si.batchNumber,
        stockInDate: si.stockInDate,
        productionDate: si.productionDate,
        expirationDate: si.expirationDate,
        quantity: Number(si.quantity),
        remaining: Number(si.quantity),
      });
      stockInsByReagent.set(si.itemId, arr);
    }

    for (const u of filteredUsages) {
      const batches = stockInsByReagent.get(u.itemId);
      if (!batches) continue;
      let toConsume = Number(u.quantity);
      for (const batch of batches) {
        if (toConsume <= 0) break;
        const deduct = Math.min(batch.remaining, toConsume);
        batch.remaining -= deduct;
        toConsume -= deduct;
      }
    }

    const items: BatchExpiryItem[] = [];
    for (const [rid, batches] of stockInsByReagent) {
      const reagent = reagentMap.get(rid)!;
      for (const b of batches) {
        const days = calcDaysUntil(b.expirationDate, today);
        const status = classifyStatus(days);
        items.push({
          reagentId: reagent.id,
          reagentName: reagent.name,
          casNumber: reagent.casNumber,
          molecularFormula: reagent.molecularFormula,
          purityGrade: reagent.purityGrade,
          hazardLevel: reagent.hazardLevel,
          storageCondition: reagent.storageCondition,
          unit: reagent.unit,
          location: reagent.location,
          batchNumber: b.batchNumber,
          stockInRecordId: b.recordId,
          stockInDate: b.stockInDate,
          productionDate: b.productionDate,
          expirationDate: b.expirationDate,
          stockInQuantity: b.quantity,
          estimatedRemaining: Number(b.remaining.toFixed(3)),
          daysUntilExpiry: days,
          status,
        });
      }
    }

    items.sort((a, b) => {
      const ad = a.daysUntilExpiry ?? Number.MAX_SAFE_INTEGER;
      const bd = b.daysUntilExpiry ?? Number.MAX_SAFE_INTEGER;
      if (ad !== bd) return ad - bd;
      if (a.reagentName !== b.reagentName) return a.reagentName.localeCompare(b.reagentName);
      return a.stockInDate.getTime() - b.stockInDate.getTime();
    });

    const summary: BatchExpirySummary = {
      totalBatches: items.length,
      expiredCount: items.filter((i) => i.status === BatchExpiryStatus.Expired).length,
      urgentCount: items.filter((i) => i.status === BatchExpiryStatus.Urgent).length,
      warningCount: items.filter((i) => i.status === BatchExpiryStatus.Warning).length,
      normalCount: items.filter((i) => i.status === BatchExpiryStatus.Normal).length,
      totalRemainingQuantity: items.reduce((sum, i) => sum + i.estimatedRemaining, 0),
    };

    return {
      items,
      summary,
      urgentDaysThreshold: URGENT_DAYS_THRESHOLD,
      warningDaysThreshold: WARNING_DAYS_THRESHOLD,
    };
  }
}
