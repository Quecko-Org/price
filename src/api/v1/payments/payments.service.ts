
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaymentEntity } from './entities/payment.entity';
import { UserEntity } from '@/user/entities/user.entity';
import { PaymentStatus } from '@/common/enums/payment.enum';
import { MailService } from '@/common/mail/mail.service';
import { PlanEntity } from './entities/payemnt-plan';


@Injectable()
export class PaymentsService {

  constructor(
    @InjectRepository(PaymentEntity)
    private paymentRepo: Repository<PaymentEntity>,

    @InjectRepository(PlanEntity)
    private planRepo: Repository<PlanEntity>,

    @InjectRepository(UserEntity)
    private userRepo: Repository<UserEntity>,

    private mailService: MailService,

  ) { }
  async storePayment(user, payment, dto) {
    console.log("ggg", user, payment)

    const existingUser = await this.userRepo.findOne({
      where: { id: user.id },
    });

    if (!existingUser) throw new Error('User not found');

    console.log("ggg", user, payment)
    const entity = this.paymentRepo.create({
      user: { id: existingUser.id },
      transactionId: payment.transactionId,
      plan: payment.plan,
      currency: payment.currency,
      amountCurrency: payment.amountCrypto,
      walletAddress: payment.fromWallet,
      status: PaymentStatus.CONFIRMED,
    });

    const savedPayment = await this.paymentRepo.save(entity);
    if (savedPayment.status === PaymentStatus.CONFIRMED) {
      existingUser.currentPlan = savedPayment.plan;
      await this.userRepo.save(existingUser);
    }


    await this.mailService.sendMail({
      to: user.email,
      templateId: process.env.SENDGRID_PAYMENT_CONFIRMATION || "",
      dynamicTemplateData: {
        name: existingUser.name,
        plan: dto.plan,
        currency: payment.currency,
        amount: payment.amountCrypto,
        walletAddress: payment.fromWallet,
        transactionId: payment.transactionId,
        date: new Date().toLocaleDateString(),
      },
    });
    return entity;
  }



  async findAll() {

    return await this.planRepo.find({
      order: { planIndex: 'ASC' },
    });
  }

  async verifyUpgradePayment(user, payment, dto) {
    console.log("user", user)

    const existingUser = await this.userRepo.findOne({
      where: { id: user.id },
    });

    if (!existingUser) throw new Error('User not found');


    if (existingUser && existingUser.currentPlan == dto.plan) {
      throw new BadRequestException('You already have this plan');
    }
    const entity = this.paymentRepo.create({
      user: { id: existingUser.id },
      transactionId: payment.transactionId,
      plan: payment.plan,
      currency: payment.currency,
      amountCurrency: payment.amountCrypto,
      walletAddress: payment.fromWallet,
      status: PaymentStatus.CONFIRMED,
    });



    const savedPayment = await this.paymentRepo.save(entity);
    if (savedPayment.status === PaymentStatus.CONFIRMED) {
      existingUser.currentPlan = savedPayment.plan;
      await this.userRepo.save(existingUser);
    }


    await this.mailService.sendMail({
      to: user.email,
      templateId: process.env.SENDGRID_PAYMENT_CONFIRMATION || "",
      dynamicTemplateData: {
        name: existingUser.name,
        plan: dto.plan,
        currency: payment.currency,
        amount: payment.amountCrypto,
        walletAddress: payment.fromWallet,
        transactionId: payment.transactionId,
        date: new Date().toLocaleDateString(),
      },
    });
    return entity;
  }

  async getUserPayments(userId: number) {
    try {
      return this.paymentRepo.find({
        where: { user: { id: userId } },
        order: { createdAt: 'DESC' },
      });
    } catch (error) {
      console.log(error)
    }
  }


  async getCurrentPlan(userId: number) {

    const user = await this.userRepo.findOne({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('payment  not found');
    }

    return {
      currentPlan: user.currentPlan,
    };
  }


  // async getPlansWithUsage(userId?: number) {
  //   const plans = await this.planRepo.find({ order: { planIndex: 'ASC' } });

  //   if (!userId) return plans;

  //   // Compute usage per plan
  //   const startOfMonth = new Date();
  //   startOfMonth.setDate(1);
  //   startOfMonth.setHours(0, 0, 0, 0);

  //   // Fetch user's API keys
  //   const keys = await this.apiKeyRepo.find({ where: { user: { id: userId } } });

  //   // Map plan usage
  //   const usageMap = {};
  //   for (const key of keys) {
  //     const count = await this.usageRepo.count({
  //       where: {
  //         apiKeyId: key.id,
  //         createdAt: MoreThan(startOfMonth),
  //       },
  //     });
  //     usageMap[key.plan.name] = (usageMap[key.plan.name] || 0) + count;
  //   }

  //   return plans.map(plan => ({
  //     ...plan,
  //     userMonthlyUsage: usageMap[plan.name] || 0,
  //     usagePercentage: plan.monthlyApiCalls
  //       ? Number(((usageMap[plan.name] || 0) / plan.monthlyApiCalls * 100).toFixed(2))
  //       : 0,
  //   }));
  // }
}