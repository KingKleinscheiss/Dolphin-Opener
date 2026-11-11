import type { FastifyInstance } from 'fastify';
import type { Scheduler } from '../scheduler/scheduler.js';

export function registerWebSocket(app: FastifyInstance, scheduler: Scheduler): void {
  app.get('/ws', { websocket: true }, (socket) => {
    const send = (snapshot: unknown) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: 'snapshot', snapshot }));
      }
    };

    send(scheduler.getSnapshot());
    const onChange = (snapshot: unknown) => send(snapshot);
    scheduler.on('change', onChange);

    socket.on('close', () => {
      scheduler.off('change', onChange);
    });
  });
}
