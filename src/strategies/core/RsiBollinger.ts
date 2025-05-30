import { RSI, BollingerBands, ATR } from "trading-signals";
import { Candle } from "../type";
import { UpbitClient } from "@/api/upbitClient";
import { BaseStrategy } from "../base/BaseStrategy";
import { STRATEGY_CONFIG } from "../../backtesting/config";

export interface RsiBollingerConfig {
  rsiPeriod: number;
  rsiOversold: number;
  bbPeriod: number;
  bbStdDev: number;
  profitFactorMin: number;
  atrMultiplierProfit: number;
  atrMultiplierStop: number;
}

export class RsiBollinger extends BaseStrategy {
  name = "RSI·볼린저 역추세 (단순화)";

  private config: RsiBollingerConfig;

  // 지표 인스턴스
  private rsi: RSI;
  private bb: BollingerBands;
  private atr: ATR;

  constructor(
    client: UpbitClient,
    config?: Partial<RsiBollingerConfig>,
    isBacktest: boolean = false,
  ) {
    super(client, isBacktest);

    // 백테스트 config에서 기본값 가져오기
    const defaultConfig = STRATEGY_CONFIG.RSI_BOLLINGER;

    this.config = {
      rsiPeriod: 14,
      rsiOversold: defaultConfig.rsiOversold, // config에서 가져오기 (45)
      bbPeriod: 20,
      bbStdDev: defaultConfig.bbStdDev, // config에서 가져오기 (2.0)
      profitFactorMin: defaultConfig.profitFactorMin, // config에서 가져오기 (1.01)
      atrMultiplierProfit: defaultConfig.atrMultiplierProfit, // config에서 가져오기 (1.0)
      atrMultiplierStop: defaultConfig.atrMultiplierStop, // config에서 가져오기 (0.5)
      ...config, // 사용자 커스텀 설정으로 오버라이드
    };

    // 지표 초기화
    this.rsi = new RSI(this.config.rsiPeriod);
    this.bb = new BollingerBands(this.config.bbPeriod, this.config.bbStdDev);
    this.atr = new ATR(14);
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
      this.rsi.update(candle.close, false);
      this.bb.update(candle.close, false);
      this.atr.update(
        {
          high: candle.high,
          low: candle.low,
          close: candle.close,
        },
        false,
      );
    }
  }

  /**
   * RSI 조건 체크
   */
  private checkRsiCondition(rsiValue: number): boolean {
    if (!rsiValue) {
      if (this.verbose) {
        console.log("RsiBollinger: RSI 데이터 부족");
      }
      return false;
    }

    if (rsiValue > this.config.rsiOversold) {
      if (this.verbose) {
        console.log(
          `RsiBollinger: RSI(${rsiValue}) > ${this.config.rsiOversold} (과매도 아님)`,
        );
      }
      return false;
    }

    return true;
  }

  /**
   * 볼린저밴드 조건 체크
   */
  private checkBollingerCondition(currentPrice: number): boolean {
    const bbResult = this.bb.getResult();

    if (!bbResult) {
      if (this.verbose) {
        console.log("RsiBollinger: 볼린저밴드 데이터 부족");
      }
      return false;
    }

    const lowerBand = Number(bbResult.lower);
    const lowerBandThreshold = lowerBand * 1.05;

    if (currentPrice > lowerBandThreshold) {
      if (this.verbose) {
        console.log(
          `RsiBollinger: 가격(${currentPrice})이 하단밴드 임계점(${lowerBandThreshold.toFixed(
            0,
          )}) 위에 있음`,
        );
      }
      return false;
    }

    return true;
  }

  /**
   * 추세 조건 체크
   */
  private checkTrendCondition(candles: Candle[]): boolean {
    if (candles.length < 5) return true;

    const recentCandles = candles.slice(-5);
    const trendDown = recentCandles[4].close < recentCandles[0].close;

    if (!trendDown) {
      if (this.verbose) {
        console.log("RsiBollinger: 최근 하락 추세가 아님");
      }
      return false;
    }

    return true;
  }

  async shouldEnter(candles: Candle[]): Promise<boolean> {
    if (
      !this.validateCandleData(
        candles,
        Math.max(this.config.rsiPeriod, this.config.bbPeriod) + 5,
      )
    ) {
      return false;
    }

    // 지표 업데이트
    this.updateIndicatorsOptimized(candles, (fromIndex, toIndex) => {
      this.updateIndicators(fromIndex, toIndex, candles);
    });

    const currentPrice = candles.at(-1).close;
    const rsiValue = Number(this.rsi.getResult() || 0);

    // 각 조건들을 순차적으로 체크
    if (!this.checkRsiCondition(rsiValue)) return false;
    if (!this.checkBollingerCondition(currentPrice)) return false;
    if (!this.checkTrendCondition(candles)) return false;

    if (this.verbose) {
      const bbResult = this.bb.getResult();
      const lowerBand = bbResult ? Number(bbResult.lower) : 0;
      console.log(
        `RsiBollinger: 진입 조건 만족 - RSI: ${rsiValue.toFixed(
          1,
        )}, 가격: ${currentPrice}, 하단밴드: ${lowerBand.toFixed(0)}`,
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

    // ATR 기반 목표가/손절가 계산 with null 체크
    const atrValue = this.atr.getResult();
    if (!atrValue) {
      if (this.verbose) {
        console.log("RsiBollinger: ATR 데이터 부족으로 기본값 사용");
      }
    }

    const { targetPrice, stopLossPrice } = this.calculateTargetLevels(
      candles,
      atrValue,
      this.config.atrMultiplierProfit,
      this.config.atrMultiplierStop,
      this.config.profitFactorMin,
    );

    // 리스크 검증: 손실이 5% 이상이면 거래 취소
    const riskPercent = ((entryPrice - stopLossPrice) / entryPrice) * 100;
    if (riskPercent > 5) {
      if (this.verbose) {
        console.log(
          `RsiBollinger: 리스크(${riskPercent.toFixed(
            1,
          )}%)가 너무 높아 거래 취소`,
        );
      }
      return;
    }

    // 주문 실행
    try {
      await this.executeOrders(market, volume, {
        entryPrice,
        targetPrice,
        stopLossPrice,
        volumeRatio: 1.0,
      });

      if (this.verbose) {
        console.log(
          `RsiBollinger: ${market} 진입 완료 - 진입가: ${entryPrice}, 목표: ${targetPrice.toFixed(
            0,
          )}, 손절: ${stopLossPrice.toFixed(0)}`,
        );
      }
    } catch (error) {
      console.error(`RsiBollinger: ${market} 주문 실행 실패:`, error);
    }
  }

  async shouldExit(candles: Candle[], entryPrice: number): Promise<boolean> {
    // 지표 업데이트 (최신 상태 유지)
    this.updateIndicatorsOptimized(candles, (fromIndex, toIndex) => {
      this.updateIndicators(fromIndex, toIndex, candles);
    });

    const currentPrice = candles.at(-1).close;

    // ATR 기반 동적 목표가/손절가 - BaseStrategy 활용
    const atrValue = this.atr.getResult();
    const { targetPrice, stopLossPrice } = this.calculateTargetLevels(
      candles,
      atrValue,
      this.config.atrMultiplierProfit,
      this.config.atrMultiplierStop,
      this.config.profitFactorMin,
    );

    // 기본 목표가/손절가 체크
    if (currentPrice >= targetPrice) {
      if (this.verbose) {
        console.log(
          `RsiBollinger: 목표가(${targetPrice.toFixed(0)}) 도달로 종료`,
        );
      }
      return true;
    }

    if (currentPrice <= stopLossPrice) {
      if (this.verbose) {
        console.log(
          `RsiBollinger: 손절가(${stopLossPrice.toFixed(0)}) 도달로 종료`,
        );
      }
      return true;
    }

    // RSI 과매수 조건 (70 이상)
    const rsiValue = Number(this.rsi.getResult() || 0);
    if (rsiValue >= 70) {
      if (this.verbose) {
        console.log(
          `RsiBollinger: RSI 과매수(${rsiValue.toFixed(1)}) 영역 도달로 종료`,
        );
      }
      return true;
    }

    // 추가 안전 장치: 볼린저밴드 상단 돌파시 종료
    const bbResult = this.bb.getResult();
    if (bbResult) {
      const upperBand = Number(bbResult.upper);
      if (currentPrice >= upperBand) {
        if (this.verbose) {
          console.log(
            `RsiBollinger: 볼린저밴드 상단(${upperBand.toFixed(
              0,
            )}) 돌파로 종료`,
          );
        }
        return true;
      }
    }

    return false;
  }
}
