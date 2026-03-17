
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

  ) {}
  async storePayment(user, payment,dto) {
    console.log("ggg",user,payment)

    const existingUser = await this.userRepo.findOne({
      where: { id: user.id },
    });
    
    if (!existingUser) throw new Error('User not found');
    
console.log("ggg",user,payment)
    const entity = this.paymentRepo.create({
      user: { id: existingUser.id }, 
      transactionId: payment.transactionId,
    plan:payment.plan,
      currency: payment.currency,
      amountCurrency: payment.amountCrypto,
      walletAddress: payment.fromWallet,
      status: PaymentStatus.CONFIRMED,
    });
  
   const savedPayment = await this.paymentRepo.save(entity);
    if (savedPayment.status === PaymentStatus.CONFIRMED) {
          existingUser.plan = dto.plan; // or dto.plan
      existingUser.currentPlan = savedPayment.plan;
      await this.userRepo.save(existingUser);
    }
    

    await this.mailService.sendMail({
      to: user.email,
      templateId : process.env.SENDGRID_PAYMENT_CONFIRMATION || "",
      dynamicTemplateData: {
        name: existingUser.name,
        plan: dto.plan,
        currency:payment.currency,
        amount: payment.amountCrypto,
        walletAddress:payment.fromWallet,
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

  async verifyUpgradePayment(user, payment,dto) {
console.log("user",user)

const existingUser = await this.userRepo.findOne({
  where: { id: user.id },
});

if (!existingUser) throw new Error('User not found');


//     if (userData && userData.plan === payment.plan) {
//       throw new BadRequestException('You already have this plan');
//     } 
//     console.log("userData",userData) 
    const entity = this.paymentRepo.create({
      user: { id: existingUser.id }, 
    transactionId: payment.transactionId,
    plan:payment.plan,
      currency: payment.currency,
      amountCurrency: payment.amountCrypto,
      walletAddress: payment.fromWallet,
      status: PaymentStatus.CONFIRMED,
    });
  
    
  
    const savedPayment = await this.paymentRepo.save(entity);
    if (savedPayment.status === PaymentStatus.CONFIRMED) {
          existingUser.plan = dto.plan; // or dto.plan
      existingUser.currentPlan = savedPayment.plan;
      await this.userRepo.save(existingUser);
    }


    await this.mailService.sendMail({
      to: user.email,
      templateId : process.env.SENDGRID_PAYMENT_CONFIRMATION || "",
      dynamicTemplateData: {
        name: existingUser.name,
        plan: dto.plan,
        currency:payment.currency, 
        amount: payment.amountCrypto,
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
      throw new NotFoundException('payment  not found');
    } 
  
    return {
      currentPlan: user.currentPlan ,
    };
  }
}