import { STABLES } from '@/ingestion/onchain/common/common-tokens';
import { Injectable } from '@nestjs/common';

@Injectable()
export class PriceCacheService {
    private cryptoRates = new Map<string, number>();
    private fiatRates = new Map<string, number>();

  private static STABLES = new Set(STABLES);
 

    updateFiatRates(rates: Record<string, number>) {
        for (const [currency, rate] of Object.entries(rates)) {
          if (!rate || rate <= 0) continue;
          this.fiatRates.set(currency, 1 / Number(rate)); // invert
        }
    }


    updateCryptoPrice(symbol: string, priceUSD: number) {
        if (!priceUSD || priceUSD <= 0) return;
        this.cryptoRates.set(symbol, priceUSD);
      }

      convertToUSD(price: number, quote: string): number | null {
        if (!price || price <= 0) return null;
      
        // USD direct
        if (quote === 'USD') return price;
      
        // Stablecoins
        if (PriceCacheService.STABLES.has(quote)) return price;

      
        // Fiat
        const fiat = this.fiatRates.get(quote);
        if (fiat) return price * fiat;
      
        // Crypto
        const crypto = this.cryptoRates.get(quote);
        if (crypto) return price * crypto;
      
        return null;
      }

      getPrice( symbol: string): number | null {
        if (!symbol) return null;


        if (PriceCacheService.STABLES.has(symbol)) return 1;
        return this.cryptoRates.get(symbol) ?? null;  //Do when redis
        // return this.cryptoRates.get(symbol) ?? 1; 


      }
      hasPrice(symbol: string): boolean {
        return PriceCacheService.STABLES.has(symbol) || this.cryptoRates.has(symbol);
      }
    
      
  

}
