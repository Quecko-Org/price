import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';

import { ApiKeyEntity } from '@/api/v1/api-keys/entities/api-key.entity';
import { PaymentEntity } from '@/api/v1/payments/entities/payment.entity';
import { UserPlan } from '@/common/enums/payment.enum';
import { ApiUsageEntity } from '@/api-usage/entities/api-usage.entity';

@Entity('users')
export class UserEntity {

  @PrimaryGeneratedColumn()
  id: number;

  // -------------------------
  // Basic Info
  // -------------------------
  @Column({ unique: true })
  email: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  companyName?: string;

  @Column()
  password: string; // hashed

  // -------------------------
  // Plan Management
  // -------------------------
  @Column({
    type: 'enum',
    enum: UserPlan,
    default: UserPlan.FREE,
  })
  currentPlan: UserPlan;

  // Optional: when plan expires (useful for subscriptions)
  @Column({ type: 'timestamptz', nullable: true })
  planExpiresAt: Date | null;

  // -------------------------
  // Preferences
  // -------------------------
  @Column({ default: false })
  newsletter: boolean;

  @Column({ default: false })
  agreeToTerms: boolean;

  // -------------------------
  // Security
  // -------------------------
  @Column({ type: 'varchar', nullable: true })
  resetPasswordToken: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resetPasswordExpires: Date | null;

  // -------------------------
  // Relations
  // -------------------------
  @OneToMany(() => ApiKeyEntity, apiKey => apiKey.user)
  apiKeys: ApiKeyEntity[];

  @OneToMany(() => PaymentEntity, payment => payment.user)
  payments: PaymentEntity[];

  @OneToMany(() => ApiUsageEntity, usage => usage.user)
  apiUsage: ApiUsageEntity[];

  // -------------------------
  // Timestamps
  // -------------------------
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}