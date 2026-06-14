import crypto from 'node:crypto'
import type { Pool } from 'pg'

type TransactionRow = {
  id: string
  symbol: string
  side: 'BUY' | 'SELL'
  quantity: string
  price: string
  traded_at: string
  metadata: Record<string, unknown>
}

export class PortfolioService {
  constructor(private readonly pool: Pool) {}

  async listTransactions(userId: string) {
    const result = await this.pool.query<TransactionRow>(
      `
        select id, symbol, side, quantity::text, price::text, traded_at::text, metadata
        from portfolio_transactions
        where user_id = $1
        order by traded_at desc, created_at desc
      `,
      [userId],
    )

    return result.rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      quantity: Number(row.quantity),
      price: Number(row.price),
      tradedAt: row.traded_at,
      metadata: row.metadata ?? {},
    }))
  }

  async createTransaction(userId: string, input: { symbol: string; side: 'BUY' | 'SELL'; quantity: number; price: number; tradedAt?: string }) {
    const id = crypto.randomUUID()
    await this.pool.query(
      `
        insert into portfolio_transactions (id, user_id, symbol, side, quantity, price, traded_at)
        values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [id, userId, input.symbol, input.side, input.quantity, input.price, input.tradedAt ?? new Date().toISOString()],
    )
    return id
  }

  async updateTransaction(userId: string, id: string, input: { quantity: number; price: number; tradedAt: string }) {
    await this.pool.query(
      `
        update portfolio_transactions
        set quantity = $3, price = $4, traded_at = $5
        where id = $1 and user_id = $2
      `,
      [id, userId, input.quantity, input.price, input.tradedAt],
    )
  }

  async deleteTransaction(userId: string, id: string) {
    await this.pool.query('delete from portfolio_transactions where id = $1 and user_id = $2', [id, userId])
  }

  async getSummary(userId: string, latestPrices: Record<string, number>) {
    const transactions = await this.listTransactions(userId)
    const holdingsMap = this.buildHoldingsMap(transactions, latestPrices)
    const holdings = Object.values(holdingsMap).filter((row) => row.quantity > 0)

    const invested = holdings.reduce((sum, row) => sum + row.avgPrice * row.quantity, 0)
    const current = holdings.reduce((sum, row) => sum + row.currentValue, 0)
    const realized = Object.values(holdingsMap).reduce((sum, row) => sum + row.realizedPnl, 0)
    const unrealized = holdings.reduce((sum, row) => sum + row.unrealizedPnl, 0)

    return {
      cards: [
        { id: 'invested', label: 'Total Invested', value: invested, change: null },
        { id: 'current', label: 'Current Value', value: current, change: invested ? (current / invested - 1) * 100 : 0 },
        { id: 'total_pl', label: 'Total P&L', value: realized + unrealized, change: invested ? ((realized + unrealized) / invested) * 100 : 0 },
        { id: 'unrealized', label: 'Unrealized', value: unrealized, change: invested ? (unrealized / invested) * 100 : 0 },
        { id: 'realized', label: 'Realized', value: realized, change: null },
      ],
      totals: {
        invested,
        current,
        realized,
        unrealized,
        totalPnl: realized + unrealized,
      },
    }
  }

  async getHoldings(userId: string, latestPrices: Record<string, number>) {
    const transactions = await this.listTransactions(userId)
    const holdingsMap = this.buildHoldingsMap(transactions, latestPrices)
    const rows = Object.values(holdingsMap)
      .filter((row) => row.quantity > 0)
      .map((row) => ({
        symbol: row.symbol,
        quantity: row.quantity,
        avgPrice: row.avgPrice,
        currentPrice: row.currentPrice,
        currentValue: row.currentValue,
        pnl: row.unrealizedPnl,
        pnlPct: row.avgPrice ? ((row.currentPrice - row.avgPrice) / row.avgPrice) * 100 : 0,
        realizedPnl: row.realizedPnl,
        allocationPct: 0,
      }))

    const totalCurrent = rows.reduce((sum, row) => sum + row.currentValue, 0)
    return rows.map((row) => ({
      ...row,
      allocationPct: totalCurrent ? (row.currentValue / totalCurrent) * 100 : 0,
    }))
  }

  private buildHoldingsMap(transactions: Awaited<ReturnType<PortfolioService['listTransactions']>>, latestPrices: Record<string, number>) {
    const ascending = [...transactions].sort((left, right) => new Date(left.tradedAt).getTime() - new Date(right.tradedAt).getTime())
    const holdings: Record<
      string,
      {
        symbol: string
        quantity: number
        avgPrice: number
        currentPrice: number
        currentValue: number
        realizedPnl: number
        unrealizedPnl: number
        totalCost: number
      }
    > = {}

    for (const txn of ascending) {
      const current = holdings[txn.symbol] ?? {
        symbol: txn.symbol,
        quantity: 0,
        avgPrice: 0,
        currentPrice: latestPrices[txn.symbol] ?? txn.price,
        currentValue: 0,
        realizedPnl: 0,
        unrealizedPnl: 0,
        totalCost: 0,
      }

      if (txn.side === 'BUY') {
        current.quantity += txn.quantity
        current.totalCost += txn.quantity * txn.price
      } else {
        const avgCost = current.quantity > 0 ? current.totalCost / current.quantity : 0
        current.realizedPnl += txn.quantity * (txn.price - avgCost)
        current.quantity = Math.max(0, current.quantity - txn.quantity)
        current.totalCost = Math.max(0, current.totalCost - avgCost * txn.quantity)
      }

      current.avgPrice = current.quantity > 0 ? current.totalCost / current.quantity : 0
      current.currentPrice = latestPrices[txn.symbol] ?? current.currentPrice
      current.currentValue = current.quantity * current.currentPrice
      current.unrealizedPnl = current.quantity * (current.currentPrice - current.avgPrice)
      holdings[txn.symbol] = current
    }

    return holdings
  }
}
