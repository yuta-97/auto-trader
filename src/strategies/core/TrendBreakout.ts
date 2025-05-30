import { Candle } from "../type";
import { UpbitClient } from "@/api/upbitClient";
import { BaseStrategy } from "../base/BaseStrategy";

export interface TrendBreakoutConfig {
  kFactor: number; // 돌파계수 (일반적으로 0.5~1.0)
  windowHours: number; // 변동폭 계산 시간 (시간) - 예: 24 = 최근 24시간
  profitTarget: number; // 수익 실현 비율 (%) - 예: 3 = 3% 상승시 매도
  stopLoss: number; // 손절 비율 (%) - 예: 2 = 2% 하락시 매도
}

export class TrendBreakout extends BaseStrategy {
  name = "변동성 돌파 전략";

  private config: TrendBreakoutConfig;
  private entryPrice: number | null = null;

  constructor(
    client: UpbitClient,
    config?: TrendBreakoutConfig,
    isBacktest: boolean = false,
  ) {
    super(client, isBacktest);

    // 기본 설정
    this.config = config;
  }

  /**
   * 최근 N시간 변동폭 계산
   * @param candles 캔들 데이터
   * @param index 현재 인덱스
   * @returns 최근 windowHours 시간동안의 변동폭 (high - low)
   */
  private calculateRecentRange(
    candles: Candle[],
    index: number,
  ): number | null {
    if (index < 1) return null;

    const currentCandle = candles[index];
    const windowMs = this.config.windowHours * 60 * 60 * 1000; // windowHours를 밀리초로 변환
    const startTime = currentCandle.timestamp - windowMs;

    if (this.verbose) {
      console.log(
        `TrendBreakout: 변동폭 계산 - 현재: ${new Date(
          currentCandle.timestamp,
        ).toISOString()}, 시작: ${new Date(startTime).toISOString()}`,
      );
    }

    // 최근 windowHours 시간 범위의 캔들들 찾기
    const recentCandles = candles.slice(0, index + 1).filter(candle => {
      return candle.timestamp >= startTime;
    });

    if (recentCandles.length === 0) {
      if (this.verbose) {
        console.log(
          `TrendBreakout: 최근 ${this.config.windowHours}시간 데이터 없음`,
        );
      }
      return null;
    }

    // 해당 기간의 최고가와 최저가 찾기
    const periodHigh = Math.max(...recentCandles.map(c => c.high));
    const periodLow = Math.min(...recentCandles.map(c => c.low));
    const range = periodHigh - periodLow;

    if (this.verbose) {
      console.log(
        `TrendBreakout: 최근 ${
          this.config.windowHours
        }시간 변동폭 - 고가: ${periodHigh}, 저가: ${periodLow}, 변동폭: ${range.toFixed(
          2,
        )} (캔들수: ${recentCandles.length})`,
      );
    }

    return range;
  }

  /**
   * 매수 목표가 계산 (시간 단위 기반)
   * 이전 캔들들의 변동폭을 기반으로 현재 캔들에서의 돌파 목표가 계산
   */
  private calculateBuyTarget(candles: Candle[], index: number): number | null {
    if (index < 1) return null;

    const currentCandle = candles[index];

    // 이전 인덱스를 기준으로 최근 변동폭 계산 (현재 캔들 제외)
    const range = this.calculateRecentRange(candles, index - 1);

    if (!range || range <= 0) return null;

    // 현재 캔들의 시가를 기준점으로 사용
    const referencePrice = currentCandle.open;
    const target = referencePrice + range * this.config.kFactor;

    if (this.verbose) {
      console.log(
        `TrendBreakout: 목표가 계산 - 기준가(시가): ${referencePrice}, 최근변동폭: ${range.toFixed(
          2,
        )}, 돌파계수: ${this.config.kFactor}, 목표가: ${target.toFixed(2)}`,
      );
    }

    return target;
  }

  async shouldEnter(candles: Candle[]): Promise<boolean> {
    if (candles.length < 2) {
      // 최소 2개 캔들 필요 (전일, 당일)
      if (this.verbose) {
        console.log("TrendBreakout: 충분한 데이터가 없음 (최소 2개 캔들 필요)");
      }
      return false;
    }

    // 실거래 모드에서만 포지션 체크 (백테스트는 백테스터가 관리)
    if (!this.isBacktest && this.entryPrice !== null) {
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
      const recentRange = this.calculateRecentRange(candles, currentIndex - 1);
      console.log(`TrendBreakout: 돌파 발생!`);
      console.log(
        `- 시가: ${currentCandle.open}, 현재가: ${currentCandle.close}, 고가: ${currentCandle.high}`,
      );
      console.log(
        `- 최근 ${this.config.windowHours}시간 변동폭: ${recentRange?.toFixed(
          2,
        )}, 목표가: ${buyTarget.toFixed(2)}`,
      );
      console.log(`- 돌파계수: ${this.config.kFactor}`);
    } else if (this.verbose) {
      const recentRange = this.calculateRecentRange(candles, currentIndex - 1);
      console.log(
        `TrendBreakout: [${currentIndex}] 시가: ${currentCandle.open}, 고가: ${currentCandle.high}, 현재가: ${currentCandle.close}`,
      );
      console.log(
        `TrendBreakout: 최근 ${
          this.config.windowHours
        }시간 변동폭: ${recentRange?.toFixed(2)}, 목표가: ${buyTarget.toFixed(
          2,
        )}, 돌파여부: ${isPriceBreakout}`,
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

    // 실제 진입은 현재 캔들의 종가로 설정 (실제 거래에서는 돌파 확인 후 즉시 매수)
    this.entryPrice = currentCandle.close;

    // 단순한 시장가 매수 (가격 기반 매도 전략이므로 복잡한 목표가/손절가 설정 불필요)
    if (!this.isBacktest) {
      await this.client.createOrder({
        market,
        side: "bid",
        volume: volume.toString(),
        ord_type: "market",
      });
    }

    if (this.verbose) {
      const buyTarget = this.calculateBuyTarget(candles, currentIndex);
      console.log(
        `TrendBreakout: ${market} 진입 - 실제진입가: ${
          this.entryPrice
        }, 목표가: ${buyTarget?.toFixed(2)}`,
      );
    }
  }

  /**
   * 종료 조건: 수익 실현 또는 손절
   */
  async shouldExit(candles: Candle[], entryPrice: number): Promise<boolean> {
    const currentCandle = candles[candles.length - 1];
    const currentPrice = currentCandle.close;

    // 수익률 계산
    const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

    // 수익 실현 조건
    if (profitPercent >= this.config.profitTarget) {
      if (this.verbose) {
        console.log(
          `TrendBreakout: 수익 목표(${
            this.config.profitTarget
          }%) 달성! 현재 수익률: ${profitPercent.toFixed(2)}%`,
        );
      }

      // 실거래 모드에서만 내부 상태 초기화 (백테스트는 백테스터가 관리)
      if (!this.isBacktest) {
        this.entryPrice = null;
      }

      return true;
    }

    // 손절 조건
    if (profitPercent <= -this.config.stopLoss) {
      if (this.verbose) {
        console.log(
          `TrendBreakout: 손절 기준(${
            this.config.stopLoss
          }%) 도달! 현재 수익률: ${profitPercent.toFixed(2)}%`,
        );
      }

      // 실거래 모드에서만 내부 상태 초기화 (백테스트는 백테스터가 관리)
      if (!this.isBacktest) {
        this.entryPrice = null;
      }

      return true;
    }

    // 백테스트 모드에서만 상세 로그 출력
    if (this.verbose && this.isBacktest) {
      console.log(
        `TrendBreakout: 진입가: ${entryPrice}, 현재가: ${currentPrice}, 수익률: ${profitPercent.toFixed(
          2,
        )}% (목표: +${this.config.profitTarget}%, 손절: -${
          this.config.stopLoss
        }%)`,
      );
    }

    return false;
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
