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

/** Pushes newly generated AI signals to premium clients only. */
@WebSocketGateway({
  namespace: '/ws',
  cors: {
    origin: process.env.WEB_ORIGIN?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  },
})
export class SignalsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(SignalsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: WsAuthedClient) {
    await authenticateWsClient(client, this.jwt, this.prisma);
  }

  emitNewSignal(signal: unknown) {
    this.server?.to('plan:premium').emit('signal:new', signal);
  }

  emitSignalResolved(signal: unknown) {
    this.server?.to('plan:premium').emit('signal:resolved', signal);
  }
}
