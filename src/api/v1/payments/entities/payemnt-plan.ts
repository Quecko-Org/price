import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('plans')
export class PlanEntity {

  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  name: string; // basic | growth | pro

  @Column()
  planIndex: number; // matches contract enum (0,1,2)

  @Column('decimal')
  priceUsd: number;
}