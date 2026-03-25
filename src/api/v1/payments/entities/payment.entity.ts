import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    OneToMany,
  } from 'typeorm';
  
  import { UserEntity } from '@/user/entities/user.entity';
import { UserPlan,PaymentStatus } from '@/common/enums/payment.enum';
  
  @Entity('payments')
  export class PaymentEntity {
  
    @PrimaryGeneratedColumn()
    id: number;
  
    @ManyToOne(() => UserEntity, user => user.payments)
    user: UserEntity;
  
    @Column({ type: 'enum', enum: UserPlan })
    plan: UserPlan;


    @Column('decimal', { precision: 18, scale: 8 })
    amountCurrency: number;

    @OneToMany(() => PaymentEntity, payment => payment.user)
  payments: PaymentEntity[];
  
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


