// ============================================================
// okx.ws.ts
//
// FIX: ENOTFOUND (DNS block) sets networkBlocked=true and stops
// all reconnect attempts permanently for the session.
// OKX is blocked by Cloudflare on your network/region.
// Other exchanges (Binance, MEXC) are unaffected.
// ============================================================
import WebSocket from 'ws'
import { Injectable, Logger } from '@nestjs/common'
import { Exchange } from '@/common/enums/exchanges.enums'
import { KafkaService } from '@/common-module/kafka/kafka.service'

const OKX_WS_URL = 'wss://ws.okx.com:8443/ws/v5/business'

// Errors that mean OKX is permanently unreachable on this network.
// No point retrying — they won't succeed until network changes.
const PERMANENT_ERRORS = ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN']

@Injectable()
export class OkxWebSocket {
  private readonly logger = new Logger(OkxWebSocket.name)
  private sockets: WebSocket[] = []

  // Set true on first permanent network error — stops all future reconnects
  private networkBlocked = false

  constructor(private readonly kafka: KafkaService) {}

  connect(
    symbols: string[],
    symbolMarketMap: Record<string, number>, 
    symbolMetaMap: Record<string, { base: string; quote: string }>,
    retry = 0,
  ) {
    // ✅ If permanently blocked, never try again
    if (this.networkBlocked) return

    let isAlive = true
    let pingInterval: NodeJS.Timeout

    const ws = new WebSocket(OKX_WS_URL)
    this.sockets.push(ws)

    ws.on('open', async () => {
      isAlive = true
      this.logger.log(`OKX WS connected — subscribing to ${symbols.length} symbols`)

      // Subscribe in batches of 20
      const BATCH = 20
      for (let i = 0; i < symbols.length; i += BATCH) {
        const batch = symbols.slice(i, i + BATCH)  // ✅ was: symbols (full array every iteration)
        ws.send(JSON.stringify({
          op: 'subscribe',
          args: batch.map(instId => ({ channel: 'candle1m', instId })),
        }))
        await new Promise(r => setTimeout(r, 250))
      }

      // Heartbeat — OKX closes if no ping for 30s
      pingInterval = setInterval(() => {
        if (!isAlive) {
          this.logger.warn('OKX: no pong — reconnecting')
          ws.terminate()
          return
        }
        isAlive = false
        if (ws.readyState === WebSocket.OPEN) ws.send('ping')
      }, 25_000)
    })

    ws.on('message', (data: Buffer) => {
      const raw = data.toString()
      if (raw === 'pong') { isAlive = true; return }

      try {
        const msg = JSON.parse(raw)

        if (msg.event) {
          if (msg.event === 'error') this.logger.error(`OKX subscribe error: ${msg.msg}`)
          return
        }

        if (msg.arg?.channel !== 'candle1m' || !msg.data?.length) return

        const instId   = msg.arg.instId as string
        const key      = `${Exchange.OKX}:${instId}`
        const marketId = symbolMarketMap[key]
        const meta     = symbolMetaMap[key]
        if (!marketId || !meta) return

        for (const candle of msg.data) {
          const [ts, open, high, low, close, vol, , , confirm] = candle
          this.kafka.publishCandle(marketId, Exchange.OKX, {
            exchange: Exchange.OKX,
            openTime: Number(ts),
            quote:    meta.quote,
            open:     Number(open),
            high:     Number(high),
            low:      Number(low),
            close:    Number(close),
            volume:   Number(vol),
            isFinal:  confirm === '1',
          }).catch(err => this.logger.error('OKX Kafka publish failed', err))
        }
      } catch (err) {
        this.logger.error('OKX parse error', err)
      }
    })

    ws.on('error', (err: any) => {
      const code: string = err?.code ?? ''
      const msg: string  = err?.message ?? ''

      // ✅ Permanent network errors — stop retrying forever
      if (PERMANENT_ERRORS.includes(code) || msg.includes('525') || msg.includes('SSL handshake')) {
        this.networkBlocked = true
        this.logger.warn(
          `OKX WS disabled — ${code || 'SSL block'}: ` +
          `ws.okx.com is unreachable on your network. ` +
          `Binance and MEXC data are unaffected. ` +
          `Use a VPN or hosted server to enable OKX.`
        )
        clearInterval(pingInterval)
        ws.terminate()
        return  // no reconnect
      }

      // Transient errors — log and let 'close' handle reconnect
      this.logger.error(`OKX WS error: ${msg}`)
    })

    ws.on('close', () => {
      clearInterval(pingInterval)

      // ✅ Don't reconnect if permanently blocked
      if (this.networkBlocked) return

      const delay = Math.min(30_000, 1_000 * 2 ** retry)
      this.logger.warn(`OKX WS closed — retry ${retry + 1} in ${delay / 1000}s`)
      setTimeout(() => this.connect(symbols, symbolMarketMap, symbolMetaMap, retry + 1), delay)
    })
  }
}