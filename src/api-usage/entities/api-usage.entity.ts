import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('api_usage')
export class ApiUsageEntity {

  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  apiKeyId: number;

  @Column()
  userId: number;

  @Column()
  endpoint: string;

  @Column()
  method: string;

  @Column()
  statusCode: number;

  @Column()
  responseTime: number;

  @CreateDateColumn()
  createdAt: Date;
}