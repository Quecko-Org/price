import { ExchangeCandle, LiveBufferEntry } from "@/common/types/candle.type";

export class LiveCandleBuffer {
  private buffer = new Map<string, ExchangeCandle[] | any>();

  private key(symbolId: number, openTime: number) {
    return `${symbolId}:${openTime}`;
  }

  add(symbolId: number, candle: LiveBufferEntry) {
    const k = this.key(symbolId, candle.openTime);
    this.buffer.set(k, candle);
  }

  get(symbolId: number, openTime: number) {
    return this.buffer.get(this.key(symbolId, openTime)) || [];
  }

  clear(symbolId: number, openTime: number) {
    this.buffer.delete(this.key(symbolId, openTime));
  }
}
