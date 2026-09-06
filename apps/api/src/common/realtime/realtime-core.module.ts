import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EVENT_BROKER, InProcessEventBroker } from './event-broker.js';
import {
  STREAM_TICKET_STORE,
  InMemoryStreamTicketStore,
  STREAM_TICKET,
} from './stream-ticket.service.js';
import { StreamAccessService } from './stream-access.service.js';
import { StreamTicketGuard } from './stream-ticket.guard.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';

/**
 * Real-time primitives. Domain modules import this to PUBLISH (EVENT_BROKER);
 * the realtime and display controllers import it to mint tickets and serve
 * streams.
 *
 * Both providers are in-process. Swapping either for a shared implementation
 * is a `useClass` change here — the two injection tokens are the seam.
 */
@Module({
  imports: [ConfigModule, AuthorizationModule],
  providers: [
    { provide: EVENT_BROKER, useClass: InProcessEventBroker },
    {
      provide: STREAM_TICKET_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new InMemoryStreamTicketStore(
          parseInt(
            config.get<string>('STREAM_TICKET_TTL_MS', String(STREAM_TICKET.DEFAULT_TTL_MS)),
            10,
          ),
        ),
    },
    StreamAccessService,
    StreamTicketGuard,
  ],
  exports: [EVENT_BROKER, STREAM_TICKET_STORE, StreamAccessService, StreamTicketGuard],
})
export class RealtimeCoreModule {}
