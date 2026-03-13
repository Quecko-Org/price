import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PaymentEntity } from './entities/payment.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { BlockchainPaymentMiddleware } from '@/common/middleware/transaction.middleware';
import { UserEntity } from '@/user/entities/user.entity';
import { MailModule } from '@/common/mail/mail.module';


@Module({
  imports: [TypeOrmModule.forFeature([PaymentEntity,UserEntity]),MailModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
}) 
export class PaymentsModule implements NestModule {

  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(BlockchainPaymentMiddleware)
      .forRoutes('payments/verify','payments/upgrade');
  }

}


