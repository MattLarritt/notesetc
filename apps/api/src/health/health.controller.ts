import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('healthz')
  @ApiOperation({ summary: 'Liveness probe — process is up.' })
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('readyz')
  @ApiOperation({ summary: 'Readiness probe — dependencies (DB) reachable.' })
  async readiness(): Promise<{ status: 'ok' | 'degraded'; checks: Record<string, string> }> {
    const checks: Record<string, string> = {};
    let healthy = true;
    try {
      await this.prisma.ping();
      checks.database = 'ok';
    } catch {
      checks.database = 'unreachable';
      healthy = false;
    }
    return { status: healthy ? 'ok' : 'degraded', checks };
  }
}
