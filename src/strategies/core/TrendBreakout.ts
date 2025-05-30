import { Candle } from "../type";
import { UpbitClient } from "@/api/upbitClient";
import { BaseStrategy } from "../base/BaseStrategy";

export interface TrendBreakoutConfig {
  kFactor: number; // 돌파계수 (일반적으로 0.5~1.0)
  lookbackDays: number; // 전일 기준 (몇 개 캔들 전)
  holdingPeriod: number; // 보유 기간 (몇 개 캔들 후 매도)
}

export class TrendBreakout extends BaseStrategy {
  name = "변동성 돌파 전략";

  private config: TrendBreakoutConfig;
  private entryPrice: number | null = null;
  private entryIndex: number = -1;

  constructor(
    client: UpbitClient,
    config?: Partial<TrendBreakoutConfig>,
    isBacktest: boolean = false,
  ) {
    super(client, isBacktest);

    // 기본 설정
    this.config = {
      kFactor: 0.5, // 돌파계수 (50%)
      lookbackDays: 1, // 전일(1개 캔들 전) 기준
      holdingPeriod: 1, // 다음날(1개 캔들 후) 매도
      ...config,
    };

    // 백테스트 모드에서는 verbose 활성화
    this.verbose = isBacktest;
  }

  /**
   * 전일 변동폭 계산
   */
  private calculatePreviousRange(
    candles: Candle[],
    index: number,
  ): number | null {
    const prevIndex = index - this.config.lookbackDays;
    if (prevIndex < 0) return null;

    const prevCandle = candles[prevIndex];
    return prevCandle.high - prevCandle.low;
  }

  /**
   * 매수 목표가 계산
   * 당일 시가 + 변동폭 × 돌파계수
   */
  private calculateBuyTarget(candles: Candle[], index: number): number | null {
    if (index < this.config.lookbackDays) return null;

    const currentCandle = candles[index];
    const range = this.calculatePreviousRange(candles, index);

    if (!range || range <= 0) return null;

    return currentCandle.open + range * this.config.kFactor;
  }

  async shouldEnter(candles: Candle[]): Promise<boolean> {
    if (candles.length < this.config.lookbackDays + 1) {
      if (this.verbose) {
        console.log("TrendBreakout: 충분한 데이터가 없음");
      }
      return false;
    }

    // 이미 포지션이 있으면 진입 안함
    if (this.entryPrice !== null) {
      return false;
    }

    const currentIndex = candles.length - 1;
    const currentCandle = candles[currentIndex];
    const buyTarget = this.calculateBuyTarget(candles, currentIndex);

    if (!buyTarget) {
      if (this.verbose) {
        console.log("TrendBreakout: 매수 목표가 계산 실패");
      }
      return false;
    }

    // 현재가가 매수 목표가를 돌파했는지 확인
    const isPriceBreakout = currentCandle.high >= buyTarget;

    if (this.verbose && isPriceBreakout) {
      const prevRange = this.calculatePreviousRange(candles, currentIndex);
      console.log(`TrendBreakout: 돌파 발생!`);
      console.log(
        `- 시가: ${currentCandle.open}, 현재가: ${currentCandle.close}`,
      );
      console.log(
        `- 전일 변동폭: ${prevRange?.toFixed(2)}, 목표가: ${buyTarget.toFixed(
          2,
        )}`,
      );
      console.log(`- 돌파계수: ${this.config.kFactor}`);
    } else if (this.verbose) {
      const prevRange = this.calculatePreviousRange(candles, currentIndex);
      console.log(
        `TrendBreakout: [${currentIndex}] 시가: ${currentCandle.open}, 고가: ${currentCandle.high}, 현재가: ${currentCandle.close}`,
      );
      console.log(
        `TrendBreakout: 전일 변동폭: ${prevRange?.toFixed(
          2,
        )}, 목표가: ${buyTarget.toFixed(2)}, 돌파여부: ${isPriceBreakout}`,
      );
    }

    return isPriceBreakout;
  }

  async execute(
    market: string,
    volume: number,
    candles: Candle[],
  ): Promise<void> {
    const currentIndex = candles.length - 1;
    const currentCandle = candles[currentIndex];
    const buyTarget = this.calculateBuyTarget(candles, currentIndex);

    if (!buyTarget) {
      throw new Error("매수 목표가 계산 실패");
    }

    // 진입가는 돌파가격(목표가) 또는 현재가 중 높은 값
    this.entryPrice = Math.max(buyTarget, currentCandle.close);
    this.entryIndex = currentIndex;

    // 단순한 시장가 매수 (다음날 시가 매도 전략이므로 복잡한 목표가/손절가 설정 불필요)
    if (!this.isBacktest) {
      await this.client.createOrder({
        market,
        side: "bid",
        volume: volume.toString(),
        ord_type: "market",
      });
    }

    if (this.verbose) {
      console.log(
        `TrendBreakout: ${market} 진입 - 가격: ${
          this.entryPrice
        }, 목표가: ${buyTarget.toFixed(2)}`,
      );
    }
  }

  /**
   * 종료 조건: 보유 기간 경과시 매도
   */
  async shouldExit(candles: Candle[], entryPrice: number): Promise<boolean> {
    if (this.entryPrice === null || this.entryIndex === -1) {
      return false;
    }

    const currentIndex = candles.length - 1;
    const holdingDuration = currentIndex - this.entryIndex;

    // 보유 기간이 지나면 매도
    const shouldExitByTime = holdingDuration >= this.config.holdingPeriod;

    if (this.verbose && shouldExitByTime) {
      console.log(
        `TrendBreakout: 보유 기간(${this.config.holdingPeriod}) 경과로 매도`,
      );
    }

    // 매도시 포지션 초기화
    if (shouldExitByTime) {
      this.entryPrice = null;
      this.entryIndex = -1;
    }

    return shouldExitByTime;
  }

  /**
   * 매도 실행 (시장가 매도)
   */
  async executeSell(market: string, volume: number): Promise<void> {
    if (!this.isBacktest) {
      await this.client.createOrder({
        market,
        side: "ask",
        volume: volume.toString(),
        ord_type: "market",
      });
    }

    if (this.verbose) {
      console.log(`TrendBreakout: ${market} 매도 완료`);
    }
  }
}
