import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';

import { UserEntity } from '@/user/entities/user.entity';
import { PlanEntity } from '../../payments/entities/payemnt-plan';
@Entity('api_keys')
export class ApiKeyEntity {

  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => UserEntity, user => user.apiKeys, { onDelete: 'CASCADE' })
  user: UserEntity;

  @Column()
  name: string; // dev key / prod key / etc.

  @Column({ unique: true })
  key: string;

  @ManyToOne(() => PlanEntity)
  plan: PlanEntity; // each key inherits the plan rules

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'int', default: 0 })
  monthlyCalls: number; // track API calls per month

  @Column({ type: 'timestamp', nullable: true })
  lastCallAt: Date; // optional, track last usage
}