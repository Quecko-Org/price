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
  
    private RECEIVER_WALLET = process.env.PAYMENT_WALLET || "0x";
  
    constructor(
      @InjectRepository(PaymentEntity)
      private paymentRepo: Repository<PaymentEntity>,
    ) {}
  
    async use(req: Request, res: Response, next: NextFunction) {
  
      const { transactionId, amountUsdt, currency } = req.body || {};
  
      if (!transactionId)
        throw new BadRequestException('Transaction hash required');
  
      // 1️⃣ prevent duplicate transaction
      const exists = await this.paymentRepo.findOne({
        where: { transactionId },
      });
  
      if (exists)
        throw new BadRequestException('Transaction already used');
  
      // 2️⃣ fetch blockchain transaction
      const tx = await this.provider.getTransaction(transactionId);
  
      if (!tx)
        throw new BadRequestException('Transaction not found');
  
      // 3️⃣ check receiver wallet
      if (tx.to?.toLowerCase() !== this.RECEIVER_WALLET.toLowerCase() ) {
        throw new BadRequestException('Invalid receiver wallet');
      }
  
      // 4️⃣ wait for confirmation
      const receipt = await this.provider.getTransactionReceipt(transactionId);
  
      if (!receipt || receipt.status !== 1)
        throw new BadRequestException('Transaction not confirmed');
  
      // 5️⃣ extract value
      const value = ethers.formatEther(tx.value);
  
      if (!value)
        throw new BadRequestException('Invalid transaction value');
  
      // 6️⃣ validate amountUsdt
      if (Number(value) < Number(amountUsdt)) {
        throw new BadRequestException('Insufficient payment');
      }
  
      // attach verified payment info
      req['payment'] = {
        transactionId,
        amountCrypto: value,
        currency,
        fromWallet: tx.from,
        toWallet: tx.to,
      };
  
      next();
    }
  }