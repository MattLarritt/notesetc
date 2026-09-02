import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Principal } from '@notesetc/shared';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentPrincipal } from '../auth/current-principal.decorator';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiBearerAuth('api-token')
@Controller('search')
@UseGuards(AuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Search pages (permission-scoped to what the caller can read).' })
  async query(
    @CurrentPrincipal() principal: Principal,
    @Query('q') q = '',
    @Query('space') space?: string,
  ) {
    const data = await this.search.query(principal, q, space);
    return { data };
  }
}
