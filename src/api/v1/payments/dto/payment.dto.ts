import { UserPlan } from "@/common/enums/payment.enum";
import { IsEnum, IsNotEmpty, IsNumber } from "class-validator";

export class VerifyPaymentDto {


  @IsEnum(UserPlan, { message: 'Plan must be basic, growth or pro' })
  plan: UserPlan;


  @IsNotEmpty({ message: 'currency is required' })
  currency: string;

  @IsNotEmpty({ message: 'amount is required' })
  amountCurrency: number;

  @IsNotEmpty({ message: 'transaction id is required' })
  transactionId: string;

  @IsNotEmpty({ message: 'wallet address is required' })
  walletAddress: string;
}

