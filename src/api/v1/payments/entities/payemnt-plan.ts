import { UserPlan } from "@/common/enums/payment.enum";
import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity('plans')
export class PlanEntity {
  @PrimaryGeneratedColumn()
  id: number;


  @Column({ type: 'enum', enum: UserPlan,default: UserPlan.FREE })
  name: UserPlan;


  @Column()
  planIndex: number; // matches contract enum (0,1,2)

  @Column('decimal')
  priceUsd: number;

  // --- Plan rules ---
  @Column()
  maxApiKeys: number; // how many keys user can create

  @Column() 
  maxEndpoints: number; // how many endpoints per key
 
  @Column()
  monthlyApiCalls: number; // total API calls per month

  @Column({ default: false })
  realtimeData: boolean; // basic real-time

  @Column({ default: false })
  historicalData: boolean; // historical access

  @Column({ default: false })
  marketOverview: boolean; // market overview access

  @Column({ default: false })
  onchainMetrics: boolean; // on-chain metrics access

  @Column({ default: false })
  chartData: boolean; // chat access

  @Column({ default: true })
  disabled: boolean;
  
  @Column({ default: 'community' })
  supportLevel: 'community' | 'email' | 'priority'; // support type
}