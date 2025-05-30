import { Strategy, Candle } from "../strategies/type";
import { BacktestDataProvider } from "./BacktestDataProvider";

export interface BacktestResult {
  market: string;
  strategyName: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  netProfit: number;
  maxDrawdown: number;
  trades: BacktestTrade[];
}

export interface BacktestTrade {
  entryTime: number;
  exitTime?: number;
  entryPrice: number;
  exitPrice?: number;
  side: "long" | "short"; // 일단 long(매수) 포지션만 구현
  profit?: number;
  profitPercent?: number;
}

export class Backtester {
  private dataProvider: BacktestDataProvider;
  private verbose: boolean;

  constructor(dataProvider: BacktestDataProvider, verbose: boolean = false) {
    this.dataProvider = dataProvider;
    this.verbose = verbose; // 상세 로그 출력 여부
  }

  /**
   * 캔들 데이터 로드
   */
  private loadCandleData(market: string, interval: number): Candle[] {
    try {
      const candles = this.dataProvider.loadCandles(market, interval);
      if (!candles.length) {
        throw new Error("캔들 데이터가 없습니다.");
      }
      return candles;
    } catch (error) {
      console.error("데이터 로드 실패:", error);
      throw new Error(
        `백테스트 데이터가 없습니다. 먼저 데이터를 수집해주세요.`,
      );
    }
  }

  /**
   * 매수 진입 처리
   */
  private handleEntry(candle: Candle): BacktestTrade {
    const trade: BacktestTrade = {
      entryTime: candle.timestamp,
      entryPrice: candle.close,
      side: "long",
    };

    if (this.verbose) {
      console.log(
        `[${new Date(candle.timestamp).toISOString()}] 진입: ${candle.close}`,
      );
    }

    return trade;
  }

  /**
   * 매도 종료 처리
   */
  private handleExit(
    trade: BacktestTrade,
    candle: Candle,
    capital: number,
    commission: number,
  ): BacktestTrade {
    const exitPrice = candle.close;
    trade.exitTime = candle.timestamp;
    trade.exitPrice = exitPrice;

    // 수익률 계산 (수수료 고려)
    const grossProfit =
      trade.side === "long"
        ? (exitPrice - trade.entryPrice) / trade.entryPrice
        : (trade.entryPrice - exitPrice) / trade.entryPrice;

    const netProfit = grossProfit - commission * 2;
    trade.profitPercent = netProfit;
    trade.profit = capital * netProfit;

    if (this.verbose) {
      console.log(
        `[${new Date(candle.timestamp).toISOString()}] 종료: ${exitPrice} (${(
          netProfit * 100
        ).toFixed(2)}%)`,
      );
    }

    return trade;
  }

  /**
   * 백테스트 결과 계산
   */
  private calculateResults(
    trades: BacktestTrade[],
    market: string,
    strategyName: string,
    maxDrawdown: number,
  ): BacktestResult {
    const winningTrades = trades.filter(t => (t.profitPercent || 0) > 0).length;
    const totalProfit = trades.reduce((sum, t) => sum + (t.profit || 0), 0);
    const grossProfit = trades
      .filter(t => (t.profitPercent || 0) > 0)
      .reduce((sum, t) => sum + (t.profit || 0), 0);
    const grossLoss = Math.abs(
      trades
        .filter(t => (t.profitPercent || 0) <= 0)
        .reduce((sum, t) => sum + (t.profit || 0), 0),
    );

    const result: BacktestResult = {
      market,
      strategyName,
      totalTrades: trades.length,
      winningTrades,
      losingTrades: trades.length - winningTrades,
      winRate: trades.length > 0 ? winningTrades / trades.length : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 0,
      netProfit: totalProfit,
      maxDrawdown,
      trades,
    };

    return result;
  }

  /**
   * 특정 전략을 특정 기간 동안 백테스트
   */
  async runBacktest(
    strategy: Strategy,
    market: string,
    interval: number,
    capital: number = 1000000, // 초기 자본
    commission: number = 0.0005, // 수수료 (0.05%)
  ): Promise<BacktestResult> {
    // 데이터 로드
    const candles = this.loadCandleData(market, interval);

    console.log(
      `백테스트 시작: ${strategy.name} - ${market} (${candles.length}개 캔들)`,
    );

    const trades: BacktestTrade[] = [];
    let currentTrade: BacktestTrade | null = null;
    let equity = capital;
    let highWaterMark = capital;
    let drawdown = 0;

    // 캔들 하나씩 순회하면서 전략 실행
    const lookbackPeriod = 100; // 전략에 제공할 과거 캔들 수

    for (let i = lookbackPeriod; i < candles.length; i++) {
      const currentCandle = candles[i];
      const lookbackCandles = candles.slice(i - lookbackPeriod, i + 1);

      // 포지션이 없는 경우 - 진입 조건 확인
      if (!currentTrade) {
        const shouldEnter = await strategy.shouldEnter(lookbackCandles);
        if (shouldEnter) {
          // 전략의 execute 메서드도 호출
          await strategy.execute(market, currentCandle.volume, lookbackCandles);
          currentTrade = this.handleEntry(currentCandle);
        }
      }
      // 포지션이 있는 경우 - 종료 조건 확인
      else if (currentTrade && !currentTrade.exitTime) {
        const shouldExit = await strategy.shouldExit(
          lookbackCandles,
          currentTrade.entryPrice,
        );

        if (shouldExit) {
          const completedTrade = this.handleExit(
            currentTrade,
            currentCandle,
            capital,
            commission,
          );

          // 자본 업데이트
          equity += completedTrade.profit || 0;

          // 최대 낙폭 계산
          if (equity > highWaterMark) {
            highWaterMark = equity;
          } else if ((highWaterMark - equity) / highWaterMark > drawdown) {
            drawdown = (highWaterMark - equity) / highWaterMark;
          }

          trades.push({ ...completedTrade });
          currentTrade = null;
        }
      }
    }

    // 결과 계산 및 반환
    return this.calculateResults(trades, market, strategy.name, drawdown);
  }
}
