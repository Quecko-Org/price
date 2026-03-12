import { LiveBufferEntry } from "@/common/types/candle.type";

export class LiveCandleBuffer {
  private buffer = new Map<string, LiveBufferEntry>();

  private key(marketId: number, openTime: number) {
    return `${marketId}:${openTime}`;
  }

  get(marketId: number, openTime: number) {
    return this.buffer.get(this.key(marketId, openTime));
  }

  add(marketId: number, entry: LiveBufferEntry) {
    this.buffer.set(this.key(marketId, entry.openTime), entry);
  }

  clear(marketId: number, openTime: number) {
    this.buffer.delete(this.key(marketId, openTime));
  }

  entries() {
    const result: {
      symbolId: number;
      openTime: number;
      candle: LiveBufferEntry;
    }[] = [];

    for (const [key, candle] of this.buffer.entries()) {
      const [symbolId, openTime] = key.split(':').map(Number);
      result.push({ symbolId, openTime, candle });
    }

    return result;
  }
}