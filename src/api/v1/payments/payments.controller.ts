
import {
  Controller,
  Post,
  Body,
  Get,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { VerifyPaymentDto } from './dto/payment.dto';
import { AuthGuard } from '@nestjs/passport';



@Controller('payments')
export class PaymentsController {

  constructor(private paymentService: PaymentsService) { }

  @UseGuards(AuthGuard('jwt'))
  @Post('verify')
  verifyPayment(@Req() req, @Body() dto: VerifyPaymentDto,
  ) {

    const payment = req.payment;

    return this.paymentService.storePayment(
      req.user,
      payment,
      dto
    );
  }


  @UseGuards(AuthGuard('jwt'))
  @Post('upgrade')
  upgradePlan(
    @Req() req,
    @Body() dto: VerifyPaymentDto,
  ) {
    const payment = req.payment;

    return this.paymentService.verifyUpgradePayment(req.user, payment, dto);
  } 

  @UseGuards(AuthGuard('jwt'))
  @Get('current')
  current(@Req() req) {
    return this.paymentService.getCurrentPlan(req.user.id);
  }


  @UseGuards(AuthGuard('jwt'))
  @Get('history')
  history(@Req() req) {
    return this.paymentService.getUserPayments(req.user.id);
  }
}