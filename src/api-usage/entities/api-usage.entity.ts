import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { UserEntity } from '@/user/entities/user.entity';
import { ApiKeyEntity } from '@/api/v1/api-keys/entities/api-key.entity';

@Entity('api_usage')
export class ApiUsageEntity {

  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ApiKeyEntity)
  @JoinColumn({ name: 'apiKeyId' })
  apiKey: ApiKeyEntity;

  @Column()
  apiKeyId: number;

  @ManyToOne(() => UserEntity)
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @Column()
  userId: number;

  @Column()
  endpoint: string;

  @Column()
  method: string;

  @Column()
  statusCode: number;

  @Column()
  responseTime: number; // in ms

  @CreateDateColumn()
  createdAt: Date;
}