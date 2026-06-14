import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../models/auditLog.entity';
import { Reagent } from '../models/reagent.entity';
import { StockInRecord } from '../models/stockInRecord.entity';
import { UsageRecord } from '../models/usageRecord.entity';
import { ReagentController } from '../controllers/reagent.controller';
import { AuditService } from '../services/audit.service';
import { AlertService } from '../services/alert.service';
import { ReagentService } from '../services/reagent.service';

@Module({
  imports: [TypeOrmModule.forFeature([Reagent, StockInRecord, UsageRecord, AuditLog])],
  controllers: [ReagentController],
  providers: [ReagentService, AuditService, AlertService],
  exports: [ReagentService],
})
export class ReagentRoutesModule {}
