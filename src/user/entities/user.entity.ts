import { UserPlan } from '@/common/enums/payment.enum';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  email: string;

  @Column()
  name: string;

  @Column({type: 'varchar', nullable: true })
  companyName?:  string | null;

  @Column()
  password: string; // hashed password

  @Column({ type: 'enum', enum: UserPlan, default: UserPlan.BASIC })
  plan: UserPlan;

  @Column({ default: false })
  newsletter: boolean; // receive updates from Pro API

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;


  @Column({ default: false })
  agreeToTerms: boolean;

  @Column({ type: 'varchar', nullable: true })
  resetPasswordToken: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resetPasswordExpires: Date | null;
}