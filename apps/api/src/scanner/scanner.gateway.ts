import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import type { ScanRow } from '@trading-platform/shared-types';
import { authenticateWsClient, WsAuthedClient } from '../common/ws-auth';
import { PrismaService } from '../prisma/prisma.service';

/** Pushes live scan/quote updates on the /ws namespace (JWT-gated). */
@WebSocketGateway({
  namespace: '/ws',
  cors: {
    origin: process.env.WEB_ORIGIN?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  },
})
export class ScannerGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ScannerGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: WsAuthedClient) {
    const ok = await authenticateWsClient(client, this.jwt, this.prisma);
    if (ok) {
      this.logger.debug(`WS connected user=${client.data.userId}`);
    }
  }

  handleDisconnect(client: WsAuthedClient) {
    this.logger.debug(`WS disconnected ${client.id}`);
  }

  emitScanResult(userId: string, scanId: string, rows: ScanRow[]) {
    this.server?.to(`user:${userId}`).emit('scan:result', { scanId, rows });
  }

  emitQuoteUpdate(quote: {
    symbol: string;
    price: number;
    volume: number;
    ts: number;
  }) {
    this.server?.to('authenticated').emit('quote:update', quote);
  }
}
