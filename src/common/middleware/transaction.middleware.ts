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

  private USDT_ADDRESS =
    (process.env.USDT_ADDRESS || '').toLowerCase();

  private USDC_ADDRESS =
    (process.env.USDC_ADDRESS || '').toLowerCase();

  private contract = new ethers.Contract(
    this.CONTRACT_ADDRESS,
    PAYMENT_ABI,
    this.provider
  );

  constructor(
    @InjectRepository(PaymentEntity)
    private paymentRepo: Repository<PaymentEntity>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {

    try {

      const { transactionId, walletAddress, userId, plan } = req.body;

      if (!transactionId)
        throw new BadRequestException('Transaction hash required');

      if (!walletAddress)
        throw new BadRequestException('Wallet address required');

      if (!plan)
        throw new BadRequestException('Plan required');

      /*
      -----------------------------------------
      1️⃣ Prevent duplicate transactions
      -----------------------------------------
      */

      const exists = await this.paymentRepo.findOne({
        where: { transactionId },
      });

      if (exists)
        throw new BadRequestException('Transaction already used');


      /*
      -----------------------------------------
      2️⃣ Fetch transaction
      -----------------------------------------
      */

      const tx = await this.provider.getTransaction(transactionId);

      if (!tx)
        throw new BadRequestException('Transaction not found');

console.log("tx",tx)
      /*
      -----------------------------------------
      3️⃣ Ensure transaction sent to contract
      -----------------------------------------
      */

      if (!tx.to || tx.to.toLowerCase() !== this.CONTRACT_ADDRESS)
        throw new BadRequestException('Invalid contract address');


      /*
      -----------------------------------------
      4️⃣ Verify function called
      -----------------------------------------
      */

      const parsedTx = this.contract.interface.parseTransaction({
        data: tx.data,
        value: tx.value,
      });
console.log("parsed",parsedTx)
      if (
        parsedTx?.name !== 'purchasePlanWithToken' &&
        parsedTx?.name !== 'purchasePlanWithETH'
      ) {
        throw new BadRequestException('Invalid contract function');
      }


      /*
      -----------------------------------------
      5️⃣ Get transaction receipt
      -----------------------------------------
      */

      const receipt = await this.provider.getTransactionReceipt(transactionId);

      if (!receipt || receipt.status !== 1)
        throw new BadRequestException('Transaction not confirmed');


      /*
      -----------------------------------------
      6️⃣ Find PlanPurchased event
      -----------------------------------------
      */

      let paymentEvent: LogDescription | null = null;

      for (const log of receipt.logs) {

        try {

          const parsed = this.contract.interface.parseLog(log);

          if (parsed && parsed.name === 'PlanPurchased') {
            paymentEvent = parsed;
            break;
          }

        } catch {}

      }

      if (!paymentEvent)
        throw new BadRequestException('Payment event not found');


      /*
      -----------------------------------------
      7️⃣ Extract event data
      -----------------------------------------
      */

      const payer = paymentEvent.args[0] as string;
      const eventUserId = paymentEvent.args[1] as string;
      const eventPlanNumber = Number(paymentEvent.args[2]);
      const tokenAddress = (paymentEvent.args[3] as string).toLowerCase();
      const tokenAmount = paymentEvent.args[4];


      /*
      -----------------------------------------
      8️⃣ Map plan number → enum
      -----------------------------------------
      */

      const eventPlan = PLAN_MAP[eventPlanNumber];
console.log("plannnnn",eventPlanNumber,eventPlan,plan)
      if (!eventPlan)
        throw new BadRequestException('Invalid plan from contract');


      /*
      -----------------------------------------
      9️⃣ Validate wallet
      -----------------------------------------
      */

      if (payer.toLowerCase() !== walletAddress.toLowerCase())
        throw new BadRequestException('Wallet mismatch');


      /*
      -----------------------------------------
      🔟 Validate userId
      -----------------------------------------
      */

      // if (eventUserId !== userId)
      //   throw new BadRequestException('UserId mismatch');


      /*
      -----------------------------------------
      11️⃣ Validate plan
      -----------------------------------------
      */
     console.log("eventPlan",eventPlan,plan)

      if (eventPlan !== plan)
        throw new BadRequestException('Plan mismatch');


      /*
      -----------------------------------------
      12️⃣ Detect currency
      -----------------------------------------
      */

      let currency = 'ETH';
      let decimals = 18;

      if (tokenAddress === this.USDT_ADDRESS) {
        currency = 'USDT';
        decimals = 6;
      }

      if (tokenAddress === this.USDC_ADDRESS) {
        currency = 'USDC';
        decimals = 6;
      }


      /*
      -----------------------------------------
      13️⃣ Format token amount
      -----------------------------------------
      */

      const amount = Number(
        ethers.formatUnits(tokenAmount, decimals)
      );


      /*
      -----------------------------------------
      14️⃣ Attach verified payment
      -----------------------------------------
      */

      req['payment'] = {
        transactionId,
        fromWallet: payer,
        tokenAddress,
        currency,
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