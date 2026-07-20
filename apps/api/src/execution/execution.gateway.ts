import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { authenticateWsClient, WsAuthedClient } from '../common/ws-auth';
import { PrismaService } from '../prisma/prisma.service';

/** Emits kill-switch events to the affected user only. */
@WebSocketGateway({
  namespace: '/ws',
  cors: {
    origin: process.env.WEB_ORIGIN?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  },
})
export class ExecutionGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ExecutionGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: WsAuthedClient) {
    await authenticateWsClient(client, this.jwt, this.prisma);
  }

  emitKillSwitchTriggered(userId: string, reason: string) {
    this.server
      ?.to(`user:${userId}`)
      .emit('execution:kill-switch-triggered', { reason });
  }
}
