import {
  Injectable,
  NestMiddleware,
  BadRequestException,
} from '@nestjs/common';

import { Request, Response, NextFunction } from 'express';
import { ethers, LogDescription } from 'ethers';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import PAYMENT_ABI from '../../api/v1/payments/payment-abi.json';
import { PaymentEntity } from '@/api/v1/payments/entities/payment.entity';
import { PLAN_MAP } from '../enums/payment.enum';


@Injectable()
export class BlockchainPaymentMiddleware implements NestMiddleware {

  private provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

  private CONTRACT_ADDRESS =
    (process.env.CONTRACT_ADDRESS || '').toLowerCase();
    private PAYMENT_CONTRACT =
    (process.env.PAYMENT_CONTRACT || '').toLowerCase(); 
  private contract = new ethers.Contract(
    this.CONTRACT_ADDRESS,
    PAYMENT_ABI,
    this.provider
  );

  constructor(
    @InjectRepository(PaymentEntity)
    private paymentRepo: Repository<PaymentEntity>,
  ) { }

  async use(req: Request, res: Response, next: NextFunction) {

    try {

      const { transactionId, walletAddress, userId, plan } = req.body;

      if (!transactionId)
        throw new BadRequestException('Transaction hash required');

      if (!walletAddress)
        throw new BadRequestException('Wallet address required');

      // prevent duplicate tx
      const exists = await this.paymentRepo.findOne({
        where: { transactionId },
      });

      if (exists)
        throw new BadRequestException('Transaction already used');

      const tx = await this.provider.getTransaction(transactionId);

      if (!tx)
        throw new BadRequestException('Transaction not found');
console.log("ttt",tx)
      // ensure tx sent to contract
      if (!tx.to || tx.to.toLowerCase() !== this.CONTRACT_ADDRESS)
        throw new BadRequestException('Invalid contract address');

      const receipt = await this.provider.getTransactionReceipt(transactionId);

      if (!receipt || receipt.status !== 1)
        throw new BadRequestException('Transaction not confirmed');

      let paymentEvent: LogDescription | null = null;

      for (const log of receipt.logs) {

        try {

          const parsed = this.contract.interface.parseLog(log);
console.log("parsed",parsed)
          if (parsed && parsed.name === 'PlanPurchased') {
            paymentEvent = parsed;
            break;
          }

        } catch { }

      }

      if (!paymentEvent)
        throw new BadRequestException('Payment event not found');

      const payer = paymentEvent.args[0] as string;
      const eventUserId = paymentEvent.args[1] as string;
      const eventPlanNumber = Number(paymentEvent.args[2]);

      const eventPlan = PLAN_MAP[eventPlanNumber];
      const token = paymentEvent.args[3] as string;
      const tokenAmount = paymentEvent.args[4];

      if (payer.toLowerCase() !== walletAddress.toLowerCase())
        throw new BadRequestException('Wallet mismatch');

      // if (eventUserId !== userId)
      //   throw new BadRequestException('UserId mismatch');

      if (!eventPlan)
        throw new BadRequestException('Invalid plan from contract');

      if (eventPlan !== plan)
        throw new BadRequestException('Plan mismatch');

      const amount = Number(ethers.formatUnits(tokenAmount, 18));

      req['payment'] = {
        transactionId,
        fromWallet: payer,
        token,
        amountCrypto: amount,
        plan: eventPlan,
        userId: eventUserId,
      };

      next();

    } catch (err) {
      next(err);
    }
  }
}