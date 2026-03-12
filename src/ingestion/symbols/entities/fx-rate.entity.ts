import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('fx_rates')
export class FxRateEntity {
  @PrimaryColumn()
  currency: string; // USD, BRL, etc.

  @Column('double precision')
  rateToUSD: number; // conversion to USD

  @Column({ type: 'timestamptz' })
  lastUpdated: Date;
}