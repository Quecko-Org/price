import {
  Injectable, 
  NestMiddleware,
  BadRequestException,
} from '@nestjs/common';

import { Request, Response, NextFunction } from 'express';
import { ethers } from 'ethers';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaymentEntity } from '@/api/v1/payments/entities/payment.entity';

@Injectable()
export class BlockchainPaymentMiddleware implements NestMiddleware {

  private provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

  private RECEIVER_WALLET =
    (process.env.PAYMENT_WALLET || '').toLowerCase();

  constructor(
    @InjectRepository(PaymentEntity)
    private paymentRepo: Repository<PaymentEntity>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {

    try {

      const {
        transactionId,
        walletAddress,
        currency,
        amountUsdt,
        amountCurrency,
        plan
      } = req.body || {};

      if (!transactionId)
        throw new BadRequestException('Transaction hash required');

      if (!walletAddress)
        throw new BadRequestException('Wallet address required');

      if (!amountUsdt)
        throw new BadRequestException('USDT amount required');

      if (!amountCurrency)
        throw new BadRequestException('Currency amount required');

      // PLAN PRICE CHECK
      const PLAN_PRICES = {
        basic: 49,
        growth: 99,
        pro: 199,
      };

      const requiredAmount = PLAN_PRICES[plan];

      if (!requiredAmount)
        throw new BadRequestException('Invalid plan');

      if (Number(amountUsdt) < requiredAmount)
        throw new BadRequestException('Plan amount mismatch');

      // 1️⃣ Prevent duplicate transaction
      const exists = await this.paymentRepo.findOne({
        where: { transactionId },
      });

      if (exists)
        throw new BadRequestException('Transaction already used');

      // 2️⃣ Fetch blockchain transaction
      const tx = await this.provider.getTransaction(transactionId);

      if (!tx)
        throw new BadRequestException('Transaction not found');

      // 3️⃣ Validate receiver wallet
      if (!tx.to || tx.to.toLowerCase() !== this.RECEIVER_WALLET)
        throw new BadRequestException('Invalid receiver wallet');

      // 4️⃣ Validate sender wallet
      if (tx.from.toLowerCase() !== walletAddress.toLowerCase())
        throw new BadRequestException('Sender wallet mismatch');

      // 5️⃣ Wait for confirmation
      const receipt = await this.provider.getTransactionReceipt(transactionId);

      if (!receipt || receipt.status !== 1)
        throw new BadRequestException('Transaction not confirmed');

      // 6️⃣ Extract actual crypto amount from blockchain
      const valueCrypto = Number(ethers.formatEther(tx.value));

      if (!valueCrypto)
        throw new BadRequestException('Invalid blockchain value');

      // 7️⃣ Validate crypto amount
      if (valueCrypto < Number(amountCurrency))
        throw new BadRequestException('Crypto amount mismatch');

      // 8️⃣ Convert crypto → USDT
      let valueUsdt = valueCrypto;

      if (currency === 'ETH') {
        const ETH_PRICE = 3000; // replace with real price API
        valueUsdt = valueCrypto * ETH_PRICE;
      }

      if (currency === 'USDT') {
        valueUsdt = valueCrypto;
      }

      if (valueUsdt < requiredAmount)
        throw new BadRequestException('Payment value too low');

      // attach verified data
      req['payment'] = {
        transactionId,
        currency,
        plan,
        amountCrypto: valueCrypto,
        amountUsdt: valueUsdt,
        fromWallet: tx.from,
        toWallet: tx.to,
      };

      next();

    } catch (err) {
      next(err);
    }
  }
}






// import {
//     Injectable,
//     NestMiddleware,
//     BadRequestException,
//   } from '@nestjs/common';
  
//   import { Request, Response, NextFunction } from 'express';
//   import { ethers } from 'ethers';
//   import { InjectRepository } from '@nestjs/typeorm';
//   import { Repository } from 'typeorm';
  
//   import { PaymentEntity } from '@/api/v1/payments/entities/payment.entity';
  
//   @Injectable()
//   export class BlockchainPaymentMiddleware implements NestMiddleware {
  
//     private provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  
//     private RECEIVER_WALLET = process.env.PAYMENT_WALLET || "0x";
  
//     constructor(
//       @InjectRepository(PaymentEntity)
//       private paymentRepo: Repository<PaymentEntity>,
//     ) {}
  
//     async use(req: Request, res: Response, next: NextFunction) {
  
//       const { transactionId, amountUsdt, currency,amountCurrency,walletAddress } = req.body || {};
  
//       if (!transactionId)
//         throw new BadRequestException('Transaction hash required');
  
//       // 1️⃣ prevent duplicate transaction
//       const exists = await this.paymentRepo.findOne({
//         where: { transactionId },
//       });
  
//       if (exists)
//         throw new BadRequestException('Transaction already used');
  
//       // 2️⃣ fetch blockchain transaction
//       const tx = await this.provider.getTransaction(transactionId);
  
//       if (!tx)
//         throw new BadRequestException('Transaction not found');
  
//       // 3️⃣ check receiver wallet
//       if (tx.to?.toLowerCase() !== this.RECEIVER_WALLET.toLowerCase() ) {
//         throw new BadRequestException('Invalid receiver wallet');
//       }
  
//       // 4️⃣ wait for confirmation
//       const receipt = await this.provider.getTransactionReceipt(transactionId);
  
//       if (!receipt || receipt.status !== 1)
//         throw new BadRequestException('Transaction not confirmed');
  
//       // 5️⃣ extract value
//       const value = ethers.formatEther(tx.value);
  
//       if (!value)
//         throw new BadRequestException('Invalid transaction value');
  
//       // 6️⃣ validate amountUsdt
//       if (Number(value) < Number(amountUsdt)) {
//         throw new BadRequestException('Insufficient payment');
//       }
  
//       // attach verified payment info
//       req['payment'] = {
//         transactionId,
//         amountCrypto: value,
//         currency,
//         fromWallet: tx.from,
//         toWallet: tx.to,
//       };
  
//       next();
//     }
//   }