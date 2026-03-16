
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaymentEntity } from './entities/payment.entity';
import { UserEntity } from '@/user/entities/user.entity';
import { PaymentStatus } from '@/common/enums/payment.enum';
import { MailService } from '@/common/mail/mail.service';


@Injectable()
export class PaymentsService {

  constructor(
    @InjectRepository(PaymentEntity)
    private paymentRepo: Repository<PaymentEntity>,

    @InjectRepository(UserEntity)
    private userRepo: Repository<UserEntity>,

    private mailService: MailService,

  ) {}
  async storePayment(user, payment,dto) {
console.log("ggg",payment)
    const entity = this.paymentRepo.create({
      user,
    transactionId: payment.transactionId,
      currency: payment.currency,
      amountCurrency: payment.amountCrypto,
      amountUsdt: payment.amountUsdt,
      walletAddress: payment.fromWallet,
      status: PaymentStatus.CONFIRMED,
    });
  
    await this.paymentRepo.save(entity);
  
    user.plan = dto.plan;
  
    await this.userRepo.save(user);
    await this.mailService.sendMail({
      to: user.email,
      templateId : process.env.SENDGRID_PAYMENT_CONFIRMATION || "",
      dynamicTemplateData: {
        name: user.name,
        plan: user.plan,
        amount: payment.amountUsdt,
        walletAddress:payment.fromWallet,
        transactionId: payment.transactionId,
        date: new Date().toLocaleDateString(),
      },
    });
    return entity;
  }
 




  async verifyUpgradePayment(user, payment,dto) {


    if (user.plan === dto.plan) {
      throw new BadRequestException('You already have this plan');
    }
    const entity = this.paymentRepo.create({
      user,
    transactionId: payment.transactionId,
      currency: payment.currency,
      amountCurrency: payment.amountCrypto,
      amountUsdt: payment.amountUsdt,
      walletAddress: payment.fromWallet,
      status: PaymentStatus.CONFIRMED,
    });
  
    await this.paymentRepo.save(entity);
  
    user.plan = dto.plan;
  
    await this.userRepo.save(user);


      await this.mailService.sendMail({
        to: user.email,
        templateId : process.env.SENDGRID_PAYMENT_CONFIRMATION || "",
        dynamicTemplateData: {
          name: user.name,
          plan: user.plan,
          amount: payment.amountUsdt,
          walletAddress:payment.fromWallet,
          transactionId: payment.transactionId,
          date: new Date().toLocaleDateString(),
        },
      });
    return entity;
  }

  async getUserPayments(userId: number) {
    try{
    return this.paymentRepo.find({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
    });}catch(error){
      console.log(error)
    }
  }


  async getCurrentPlan(userId: number) {

    const user = await this.userRepo.findOne({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
  
    return {
      plan: user.plan ,
    };
  }
}