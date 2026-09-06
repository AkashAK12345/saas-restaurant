import { IsEnum } from 'class-validator';
import { RealtimeChannel } from '../../common/realtime/channels.js';

/** Used by the DISPLAY ticket route, where the channel must be validated against the device kind. */
export class CreateDisplayStreamTicketDto {
  @IsEnum(RealtimeChannel)
  channel!: RealtimeChannel;
}
