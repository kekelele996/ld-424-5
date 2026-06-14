import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ReagentService } from '../services/reagent.service';
import { AuthenticatedRequest } from '../types/interfaces';
import { ok } from '../utils/response';

@ApiTags('reagents')
@ApiBearerAuth()
@Controller('reagents')
export class ReagentController {
  constructor(private readonly service: ReagentService) {}

  @Get()
  async list() {
    return ok(await this.service.list());
  }

  @Get('batch-expiry')
  @ApiOperation({
    summary: '批次效期视图',
    description: '按试剂列出各批号过期日期、入库数量、存放位置。快过期（含已过期）的批次排在前面。支持按单个试剂查询。',
  })
  @ApiQuery({ name: 'reagentId', required: false, description: '可选：指定单个试剂ID' })
  async batchExpiryView(@Query('reagentId') reagentId?: string) {
    return ok(await this.service.getBatchExpiryView(reagentId));
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return ok(await this.service.findOne(id));
  }

  @Post()
  async create(@Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    return ok(await this.service.create(body, req.user), '试剂已创建');
  }
}
