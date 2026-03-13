import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SymbolsModule } from './ingestion/symbols/symbols.module';
import { SyncModule } from './ingestion/sync/sync.module';
import { ExchangesModule } from './ingestion/exchanges/exchanges.module';
import { MarketDataModule } from './market-data/market-data.module';
import { OnchainModule } from './ingestion/onchain/onchain.module';
import { AuthModule } from './auth/auth.module';
import { ApiModule } from './api/api.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({isGlobal:true}), 
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: +process.env.DB_PORT!,
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      autoLoadEntities: true,
      synchronize: true, // dev only
    }),
    ExchangesModule,
    SymbolsModule,
    SyncModule,
    MarketDataModule,
    OnchainModule,
    AuthModule,
    ApiModule,
    UserModule
    
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
