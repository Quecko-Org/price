import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';

import { UserEntity } from '@/user/entities/user.entity';

@Entity('api_keys')
export class ApiKeyEntity {

  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => UserEntity)
  user: UserEntity;

  @Column()
  name: string;

  @Column({ unique: true })
  key: string;

  @CreateDateColumn()
  createdAt: Date;
}