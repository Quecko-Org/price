import { Injectable } from '@nestjs/common';

@Injectable()
export class PriceCacheService {

  // symbol → price
  private prices = new Map<string, number>();

  // symbol → last update timestamp
  private updatedAt = new Map<string, number>();

  setPrice(symbol: string, price: number) {
    this.prices.set(symbol, price);
    this.updatedAt.set(symbol, Date.now());
  }

  getPrice(symbol: string): number | null {
    return this.prices.get(symbol) ?? null;
  }

  getPriceSafe(symbol: string, maxAgeMs = 30_000): number | null {
    const price = this.prices.get(symbol);
    const ts = this.updatedAt.get(symbol);

    if (!price || !ts) return null;

    if (Date.now() - ts > maxAgeMs) return null;

    return price;
  }

  getAll() {
    return Object.fromEntries(this.prices);
  }
}