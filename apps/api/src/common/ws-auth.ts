import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { JwtPayload } from '../auth/auth.service';
import { wsConnectionsGauge } from '../metrics/counters';
import { PrismaService } from '../prisma/prisma.service';

const logger = new Logger('WsAuth');

export type WsAuthedClient = Socket & {
  data: {
    userId?: string;
    email?: string;
    planTier?: string;
  };
};

/**
 * Validate handshake JWT and join isolation rooms.
 * Rejects the socket when the token is missing/invalid.
 */
export async function authenticateWsClient(
  client: WsAuthedClient,
  jwt: JwtService,
  prisma: PrismaService,
): Promise<boolean> {
  const token =
    (client.handshake.auth?.token as string | undefined) ||
    (typeof client.handshake.headers.authorization === 'string'
      ? client.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
      : undefined);

  if (!token) {
    logger.warn(`WS reject ${client.id}: missing token`);
    client.disconnect(true);
    return false;
  }

  try {
    const payload = await jwt.verifyAsync<JwtPayload>(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { subscription: true },
    });
    if (!user) {
      client.disconnect(true);
      return false;
    }
    const planTier = user.subscription?.planTier ?? 'free';
    client.data.userId = user.id;
    client.data.email = user.email;
    client.data.planTier = planTier;
    await client.join('authenticated');
    await client.join(`user:${user.id}`);
    await client.join(`plan:${planTier}`);
    wsConnectionsGauge.inc();
    client.once('disconnect', () => wsConnectionsGauge.dec());
    return true;
  } catch (err) {
    logger.warn(`WS reject ${client.id}: ${(err as Error).message}`);
    client.disconnect(true);
    return false;
  }
}
