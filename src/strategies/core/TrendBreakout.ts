import { ATR, SMA } from "trading-signals";
import { Candle } from "../type";
import { UpbitClient } from "@/api/upbitClient";
import { BaseStrategy } from "../base/BaseStrategy";

export interface TrendBreakoutConfig {
  lookbackPeriod: number;
  stopFactor: number;
  profitFactor: number;
  consecutiveCandlesUp: number;
  maPeriod: number;
  useMaFilter: boolean;
}

export class TrendBreakout extends BaseStrategy {
  name = "추세 돌파 (단순화)";

  private config: TrendBreakoutConfig;

  // 지표 인스턴스
  private atr: ATR;
  private sma: SMA;

  constructor(client: UpbitClient, config?: Partial<TrendBreakoutConfig>) {
    super(client);

    // 기본 설정 (단순화된 버전)
    this.config = {
      lookbackPeriod: 10,
      stopFactor: 2,
      profitFactor: 3,
      consecutiveCandlesUp: 1,
      maPeriod: 10,
      useMaFilter: false, // 거래량/복잡한 필터 제거
      ...config,
    };

    // 지표 초기화
    this.atr = new ATR(14);
    this.sma = new SMA(this.config.maPeriod);
  }

  /**
   * 지표 업데이트
   */
  private updateIndicators(
    fromIndex: number,
    toIndex: number,
    candles: Candle[],
  ): void {
    for (let i = fromIndex; i <= toIndex; i++) {
      const candle = candles[i];
      this.atr.update(
        {
          high: candle.high,
          low: candle.low,
          close: candle.close,
        },
        false,
      );
      this.sma.update(candle.close, false);
    }
  }

  /**
   * 추세 강도 검증 (단순화)
   */
  private checkTrendStrength(candles: Candle[]): boolean {
    if (candles.length < this.config.maPeriod) return false;

    // 연속 상승 캔들 확인
    const recentCandles = candles.slice(-this.config.consecutiveCandlesUp - 1);
    for (let i = 1; i <= this.config.consecutiveCandlesUp; i++) {
      if (
        recentCandles[recentCandles.length - i].close <=
        recentCandles[recentCandles.length - i - 1].close
      ) {
        return false;
      }
    }

    // 이동평균 필터 (옵션)
    if (this.config.useMaFilter) {
      const smaResult = this.sma.getResult();
      if (smaResult) {
        const currentPrice = candles.at(-1).close;
        const smaValue = Number(smaResult);
        if (currentPrice <= smaValue) return false;
      }
    }

    return true;
  }

  async shouldEnter(candles: Candle[]): Promise<boolean> {
    if (
      candles.length <
      Math.max(this.config.lookbackPeriod, this.config.maPeriod) + 5
    ) {
      if (this.verbose) {
        console.log("TrendBreakout: 충분한 데이터가 없음");
      }
      return false;
    }

    // 지표 업데이트
    this.updateIndicatorsOptimized(candles, (fromIndex, toIndex) => {
      this.updateIndicators(fromIndex, toIndex, candles);
    });

    // 1. 단순한 상승 확인만 (모든 복잡한 조건 제거)
    const recentCandles = candles.slice(-this.config.consecutiveCandlesUp - 1);
    for (let i = 1; i <= this.config.consecutiveCandlesUp; i++) {
      if (
        recentCandles[recentCandles.length - i].close <=
        recentCandles[recentCandles.length - i - 1].close
      ) {
        if (this.verbose) {
          console.log("TrendBreakout: 연속 상승 조건 불만족");
        }
        return false;
      }
    }

    // 2. 추가 조건: 최근 거래량이 있는지만 확인 (단순한 필터)
    const currentCandle = candles.at(-1);
    if (!currentCandle.volume || currentCandle.volume <= 0) {
      if (this.verbose) {
        console.log("TrendBreakout: 거래량 없음");
      }
      return false;
    }

    if (this.verbose) {
      console.log(
        `TrendBreakout: 진입 조건 만족 - 가격: ${currentCandle.close}`,
      );
    }

    return true;
  }

  async execute(
    market: string,
    volume: number,
    candles: Candle[],
  ): Promise<void> {
    const entryPrice = candles.at(-1).close;

    // ATR 기반 목표가/손절가 계산
    const atrValue = this.atr.getResult();
    const { targetPrice, stopLossPrice } = this.calculateTargetLevels(
      candles,
      atrValue,
      this.config.profitFactor,
      this.config.stopFactor,
    );

    // 주문 실행 (단순화된 버전)
    await this.executeOrders(market, volume, {
      entryPrice,
      targetPrice,
      stopLossPrice,
      volumeRatio: 1.0, // 고정 비율
    });

    // 로그 출력
    if (this.verbose) {
      console.log(
        `TrendBreakout: ${market} 진입 - 가격: ${entryPrice}, 목표: ${targetPrice}, 손절: ${stopLossPrice}`,
      );
    }
  }

  /**
   * 종료 조건 판단
   */
  async shouldExit(candles: Candle[], entryPrice: number): Promise<boolean> {
    const currentPrice = candles.at(-1).close;

    // ATR 기반 동적 스톱로스/목표가 계산
    const atrValue = this.atr.getResult();
    const { targetPrice, stopLossPrice } = this.calculateTargetLevels(
      candles,
      atrValue,
      this.config.profitFactor,
      this.config.stopFactor,
    );

    // 목표가 달성 또는 손절가 터치
    return currentPrice >= targetPrice || currentPrice <= stopLossPrice;
  }
}
