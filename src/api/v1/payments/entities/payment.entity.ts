import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
  } from 'typeorm';
  
  import { UserEntity } from '@/user/entities/user.entity';
import { UserPlan,PaymentStatus } from '@/common/enums/payment.enum';
  
  @Entity('payments')
  export class PaymentEntity {
  
    @PrimaryGeneratedColumn()
    id: number;
  
    @ManyToOne(() => UserEntity)
    user: UserEntity;
  
    @Column({ type: 'enum', enum: UserPlan })
    plan: UserPlan;
  
    @Column('decimal', { precision: 18, scale: 8 })
    amountUsdt: number;

    @Column('decimal', { precision: 18, scale: 8 })
    amountCurrency: number;
  
    @Column()
    currency: string;

    @Column()
    walletAddress: string;
  
    @Column({ nullable: true })
    transactionId: string;
  
    @Column({
      type: 'enum',
      enum: PaymentStatus,
      default: PaymentStatus.CONFIRMED,
    })
    status: PaymentStatus;
  
    @CreateDateColumn()
    createdAt: Date;
  
  }