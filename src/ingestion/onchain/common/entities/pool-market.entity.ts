import { MarketEntity } from '@/market-data/market.entity';
import { Entity, ManyToOne, JoinColumn, PrimaryColumn } from 'typeorm';
import { DexPool } from './pool.entityt';

@Entity('dex_market_map')
export class DexMarketMap {

  @PrimaryColumn({ name: 'pool_id' })
  poolId: number;

  @PrimaryColumn({ name: 'market_id' })
  marketId: number;

  @ManyToOne(() => DexPool, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pool_id' })
  pool: DexPool;

  @ManyToOne(() => MarketEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'market_id' })
  market: MarketEntity;
}