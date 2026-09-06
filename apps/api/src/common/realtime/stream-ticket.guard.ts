import {
  Injectable,
  Inject,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import {
  STREAM_TICKET_STORE,
  type StreamTicketStore,
  type StreamTicketRecord,
} from './stream-ticket.service.js';
import { StreamAccessService } from './stream-access.service.js';

export interface StreamRequest {
  stream?: StreamTicketRecord;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
}

/**
 * Authenticates an SSE connection with a stream ticket.
 *
 * Accepts the ticket from `X-Stream-Ticket` (preferred for non-browser
 * clients) or `?ticket=` (the only option EventSource has). Nothing else is
 * accepted: a staff JWT or a display credential presented here is rejected,
 * because neither should ever travel in a URL.
 *
 * Every failure is one generic 401. The ticket is consumed (single use)
 * before authorization is re-checked, so a failed attempt burns it.
 */
@Injectable()
export class StreamTicketGuard implements CanActivate {
  constructor(
    @Inject(STREAM_TICKET_STORE) private readonly tickets: StreamTicketStore,
    private readonly access: StreamAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StreamRequest>();
    const raw = request.headers['x-stream-ticket'] ?? request.query['ticket'];

    const record = this.tickets.consume(raw);
    if (!record) throw new UnauthorizedException('Invalid stream ticket');

    if (!(await this.access.isStillAuthorized(record))) {
      throw new UnauthorizedException('Invalid stream ticket');
    }

    request.stream = record;
    return true;
  }
}
