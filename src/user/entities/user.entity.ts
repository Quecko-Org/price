import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { ApiKeyEntity } from '@/api/v1/api-keys/entities/api-key.entity';
import { PaymentEntity } from '@/api/v1/payments/entities/payment.entity';
import { UserPlan, UserRole, UserStatus } from '@/common/enums/payment.enum';
import { ApiUsageEntity } from '@/api-usage/entities/api-usage.entity';
import { PlanEntity } from '@/api/v1/payments/entities/payemnt-plan';

@Entity('users')
export class UserEntity {

  @PrimaryGeneratedColumn()
  id: number;

  // -------------------------
  // Basic Info
  // -------------------------
  @Index() // 🔥 faster lookup
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

  // Plan expiry (subscription-based)
  @Column({ type: 'timestamptz', nullable: true })
  planExpiresAt: Date | null;

  // 🔥 Shared usage across ALL API keys
  @Column({ type: 'int', default: 0 })
  monthlyUsage: number;

  // 🔥 Track when usage was last reset (important for accuracy)
  @Column({ type: 'timestamptz', nullable: true })
  usageResetAt: Date | null;


// user role//
@Column({
  type: 'enum',
  enum: UserRole,
  default: UserRole.USER,
})
role: UserRole;

@Column({
  type: 'enum',
  enum: UserStatus,
  default: UserStatus.ACTIVE,
})
status: UserStatus;


@Column({ type: 'varchar', nullable: true })
lastIp: string | null;

@Column({ type: 'varchar', nullable: true })
lastLocation: string | null; 

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

  @ManyToOne(() => PlanEntity)
  @JoinColumn({ name: 'planId' })
  plan: PlanEntity;

  // -------------------------
  // Timestamps
  // -------------------------
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}