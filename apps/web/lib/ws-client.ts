"use client";

import { io, type Socket } from "socket.io-client";
import type { ScanRow, Signal } from "./types";

export type WsEvents = {
  "scan:result": { scanId: string; rows: ScanRow[] };
  "signal:new": Signal;
  "signal:resolved": Pick<Signal, "id" | "symbol" | "status"> &
    Partial<Pick<Signal, "resolvedAt" | "resolvedPrice" | "realizedReturn">>;
  "quote:update": { symbol: string; price: number; volume: number; ts: number };
  "execution:kill-switch-triggered": { reason: string };
};

type EventName = keyof WsEvents;
type Handler<E extends EventName> = (payload: WsEvents[E]) => void;

let socket: Socket | null = null;

function getWsUrl() {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3001";
}

export function getSocket(token?: string | null): Socket {
  if (socket?.connected) return socket;

  socket = io(`${getWsUrl()}/ws`, {
    autoConnect: false,
    transports: ["websocket"],
    auth: token ? { token } : undefined,
    reconnectionAttempts: 8,
    reconnectionDelay: 1000,
  });

  return socket;
}

export function connectSocket(token?: string | null) {
  const s = getSocket(token);
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function onWsEvent<E extends EventName>(event: E, handler: Handler<E>) {
  const s = getSocket();
  const wrapped = (payload: WsEvents[E]) => handler(payload);
  // Socket.io ClientToServerEvents typing does not model our custom event map.
  (s as Socket).on(event, wrapped as never);
  return () => {
    (s as Socket).off(event, wrapped as never);
  };
}

export function getSocketStatus(): "disconnected" | "connecting" | "connected" {
  if (!socket) return "disconnected";
  if (socket.connected) return "connected";
  return "connecting";
}
