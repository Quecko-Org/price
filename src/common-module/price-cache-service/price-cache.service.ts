import { Injectable } from '@nestjs/common';

@Injectable()
export class PriceCacheService {
    private cryptoRates = new Map<string, number>();
    private fiatRates = new Map<string, number>();


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
        if (['USDT', 'USDC', 'FDUSD', 'TUSD'].includes(quote)) {
          return price;
        }
      
        // Fiat
        const fiat = this.fiatRates.get(quote);
        if (fiat) return price * fiat;
      
        // Crypto
        const crypto = this.cryptoRates.get(quote);
        if (crypto) return price * crypto;
      
        return null;
      }

      getPrice( quote: string): number | null {
 
        // Crypto
        const crypto = this.cryptoRates.get(quote);
        // console.log("crypto",crypto)
        if (crypto) return  crypto;
      
        return 1;
      }
      
  

}
