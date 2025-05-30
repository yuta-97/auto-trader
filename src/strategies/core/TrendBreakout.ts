import { Candle } from "../type";
import { UpbitClient } from "@/api/upbitClient";
import { BaseStrategy } from "../base/BaseStrategy";
import { STRATEGY_CONFIG } from "../../backtesting/config";
import { TechnicalIndicators } from "../indicators/TechnicalIndicators";

export interface TrendBreakoutConfig {
  rollingWindow: {
    shortPeriod: number;
    mediumPeriod: number;
    longPeriod: number;
    adaptiveWeight: boolean;
  };
  kFactor: {
    base: number;
    volatilityAdjust: boolean;
    minK: number;
    maxK: number;
    smoothing: number;
  };
  entryConditions: {
    breakoutConfirm: {
      enabled: boolean;
      consecutiveCandles: number;
      volumeThreshold: number;
    };
    momentum: {
      enabled: boolean;
      rsiPeriod: number;
      rsiRange: { min: number; max: number };
      priceAcceleration: number;
    };
    marketStructure: {
      enabled: boolean;
      emaPeriod: number;
      trendAlignment: boolean;
      supportResistance: boolean;
    };
  };
  riskManagement: {
    atr: {
      period: number;
      profitMultiplier: number;
      stopMultiplier: number;
      trailingStop: boolean;
      trailingThreshold: number;
    };
    timeDecay: {
      enabled: boolean;
      maxHoldPeriod: number;
      decayRate: number;
    };
    positionSize: {
      volatilityAdjusted: boolean;
      maxRiskPercent: number;
      minRiskReward: number;
    };
  };
  marketRegime: {
    enabled: boolean;
    trendingThreshold: number;
    rangingThreshold: number;
    volatilityPeriod: number;
    adaptiveStrategy: boolean;
  };
  tradingControl: {
    cooldownPeriod: number;
    maxDailyTrades: number;
    consecutiveLossLimit: number;
    drawdownLimit: number;
  };
  logging: {
    level: number;
    includeIndicators: boolean;
    performanceMetrics: boolean;
  };
}

interface VolatilityMetrics {
  short: number;
  medium: number;
  long: number;
  adaptive: number;
}

interface MarketState {
  regime: "trending" | "ranging" | "volatile";
  trendDirection: "up" | "down" | "sideways";
  volatilityRank: number; // 0-1 스케일
  momentum: number;
}

export class TrendBreakout extends BaseStrategy {
  name = "적응형 변동성 돌파 전략";

  private config: TrendBreakoutConfig;
  private entryPrice: number | null = null;
  private entryTime: number | null = null;
  private trailingStopPrice: number | null = null;
  private currentKFactor: number;
  private dailyTradeCount: number = 0;
  private consecutiveLosses: number = 0;
  private lastTradeTime: number = 0;

  constructor(
    client: UpbitClient,
    config?: TrendBreakoutConfig,
    isBacktest: boolean = false,
  ) {
    super(client, isBacktest);
    this.config = config || STRATEGY_CONFIG.TREND_BREAKOUT;
    this.currentKFactor = this.config.kFactor.base;
  }

  /**
   * Rolling Window 기반 변동성 계산
   */
  private calculateVolatilityMetrics(
    candles: Candle[],
    index: number,
  ): VolatilityMetrics | null {
    const { shortPeriod, mediumPeriod, longPeriod } = this.config.rollingWindow;

    if (index < longPeriod) return null;

    const calculateRangeVolatility = (period: number): number => {
      const recentCandles = candles.slice(index - period + 1, index + 1);
      const ranges = recentCandles.map(c => (c.high - c.low) / c.close);
      return ranges.reduce((sum, range) => sum + range, 0) / ranges.length;
    };

    const short = calculateRangeVolatility(shortPeriod);
    const medium = calculateRangeVolatility(mediumPeriod);
    const long = calculateRangeVolatility(longPeriod);

    // 적응형 가중치 계산
    let adaptive = medium;
    if (this.config.rollingWindow.adaptiveWeight) {
      const shortWeight = Math.min(short / medium, 2.0); // 단기 급등 가중
      const longWeight = Math.max(medium / long, 0.5); // 장기 대비 안정성
      adaptive = medium * (shortWeight * 0.3 + longWeight * 0.7);
    }

    return { short, medium, long, adaptive };
  }

  /**
   * 시장 상태 분석
   */
  private analyzeMarketState(
    candles: Candle[],
    index: number,
  ): MarketState | null {
    if (
      !this.config.marketRegime.enabled ||
      index < this.config.marketRegime.volatilityPeriod
    ) {
      return null;
    }

    const period = this.config.marketRegime.volatilityPeriod;
    const recentCandles = candles.slice(index - period + 1, index + 1);

    // 추세 강도 계산 (EMA 기울기) - BaseStrategy의 calculateEMA 활용
    const ema21 = this.calculateEMA(
      recentCandles.map(c => c.close),
      21,
    );
    const trendSlope =
      ema21.length > 10
        ? (ema21[ema21.length - 1] - ema21[ema21.length - 11]) /
          ema21[ema21.length - 11]
        : 0;

    // 변동성 순위 계산
    const currentVol = this.calculateVolatilityMetrics(candles, index);
    if (!currentVol) return null;

    const historicalVols = [];
    for (let i = Math.max(0, index - 100); i <= index; i++) {
      const vol = this.calculateVolatilityMetrics(candles, i);
      if (vol) historicalVols.push(vol.medium);
    }

    const sortedVols = [...historicalVols].sort((a, b) => a - b);
    const volatilityRank =
      sortedVols.indexOf(currentVol.medium) / sortedVols.length;

    // 시장 체제 분류
    let regime: "trending" | "ranging" | "volatile";
    if (volatilityRank > 0.8) {
      regime = "volatile";
    } else if (
      Math.abs(trendSlope) > this.config.marketRegime.trendingThreshold
    ) {
      regime = "trending";
    } else {
      regime = "ranging";
    }

    // 추세 방향
    let trendDirection: "up" | "down" | "sideways";
    if (trendSlope > 0.01) trendDirection = "up";
    else if (trendSlope < -0.01) trendDirection = "down";
    else trendDirection = "sideways";

    // 모멘텀 계산
    const momentum =
      (candles[index].close - candles[index - 5].close) /
      candles[index - 5].close;

    return { regime, trendDirection, volatilityRank, momentum };
  }

  /**
   * 동적 K 팩터 계산
   */
  private updateKFactor(
    volatility: VolatilityMetrics,
    marketState: MarketState | null,
  ): void {
    if (!this.config.kFactor.volatilityAdjust) {
      this.currentKFactor = this.config.kFactor.base;
      return;
    }

    // 변동성 기반 조정
    let adjustedK = this.config.kFactor.base;

    // 높은 변동성 → 낮은 K (더 쉬운 돌파)
    const volAdjustment = 1 - volatility.adaptive * 2; // 변동성에 반비례
    adjustedK *= Math.max(0.5, Math.min(1.5, volAdjustment));

    // 시장 상태별 조정
    if (marketState) {
      switch (marketState.regime) {
        case "trending":
          adjustedK *= 0.8; // 추세장에서는 더 쉬운 돌파
          break;
        case "volatile":
          adjustedK *= 1.2; // 고변동성에서는 더 어려운 돌파
          break;
        case "ranging":
          adjustedK *= 1.0; // 횡보장에서는 기본값
          break;
      }
    }

    // 범위 제한 및 스무딩
    adjustedK = Math.max(
      this.config.kFactor.minK,
      Math.min(this.config.kFactor.maxK, adjustedK),
    );

    // 급격한 변화 방지를 위한 스무딩
    const smoothing = this.config.kFactor.smoothing;
    this.currentKFactor =
      this.currentKFactor * (1 - smoothing) + adjustedK * smoothing;
  }

  /**
   * 돌파 목표가 계산
   */
  private calculateBreakoutTarget(
    candles: Candle[],
    index: number,
  ): number | null {
    const volatility = this.calculateVolatilityMetrics(candles, index);
    if (!volatility) return null;

    const currentCandle = candles[index];
    const referencePrice = currentCandle.open;

    // 적응형 변동폭 사용
    const adaptiveRange = volatility.adaptive * referencePrice;
    const target = referencePrice + adaptiveRange * this.currentKFactor;

    return target;
  }

  /**
   * 거래량 확인 (TechnicalIndicators 활용)
   */
  private checkVolumeConfirmation(candles: Candle[], index: number): boolean {
    if (!this.config.entryConditions.breakoutConfirm.enabled) return true;

    const period = 20; // 평균 거래량 계산 기간
    if (index < period) return false;

    // TechnicalIndicators를 활용한 평균 거래량 계산
    const recentCandles = candles.slice(index - period + 1, index + 1);
    const avgVolume = TechnicalIndicators.calculateAverageVolume(
      recentCandles,
      period,
    );
    const currentVolume = candles[index].volume;

    const isVolumeOk =
      currentVolume >=
      avgVolume * this.config.entryConditions.breakoutConfirm.volumeThreshold;

    if (this.config.logging.level >= 3) {
      console.log(
        `📊 거래량 확인 - 현재: ${currentVolume.toFixed(
          0,
        )}, 평균: ${avgVolume.toFixed(0)}, 비율: ${(
          currentVolume / avgVolume
        ).toFixed(2)}`,
      );
    }

    return isVolumeOk;
  }

  /**
   * 모멘텀 확인
   */
  private checkMomentum(candles: Candle[], index: number): boolean {
    if (!this.config.entryConditions.momentum.enabled) return true;

    const { rsiPeriod, rsiRange, priceAcceleration } =
      this.config.entryConditions.momentum;

    // RSI 확인
    const prices = candles.slice(0, index + 1).map(c => c.close);
    const rsi = this.calculateRSI(prices, rsiPeriod);
    if (rsi.length === 0) return false;

    const currentRSI = rsi[rsi.length - 1];
    const rsiInRange = currentRSI >= rsiRange.min && currentRSI <= rsiRange.max;

    // 가격 가속도 확인
    if (index < 5) return rsiInRange;

    const priceChange =
      (candles[index].close - candles[index - 5].close) /
      candles[index - 5].close;
    const accelerationOk = Math.abs(priceChange) >= priceAcceleration;

    return rsiInRange && accelerationOk;
  }

  /**
   * 시장 구조 확인
   */
  private checkMarketStructure(candles: Candle[], index: number): boolean {
    if (!this.config.entryConditions.marketStructure.enabled) return true;

    const { emaPeriod, trendAlignment } =
      this.config.entryConditions.marketStructure;

    if (index < emaPeriod) return false;

    const prices = candles.slice(0, index + 1).map(c => c.close);
    const ema = this.calculateEMA(prices, emaPeriod);
    if (ema.length === 0) return false;

    const currentPrice = candles[index].close;
    const currentEMA = ema[ema.length - 1];

    if (trendAlignment) {
      // 상승 추세에서만 매수 (가격이 EMA 위에 있어야 함)
      return currentPrice > currentEMA;
    }

    return true;
  }

  /**
   * 거래 제어 확인 (쿨다운, 일일 거래량 등)
   */
  private checkTradingControls(currentTime: number): boolean {
    // 쿨다운 확인
    if (this.lastTradeTime > 0) {
      const candlesPassed = Math.floor(
        (currentTime - this.lastTradeTime) / (3 * 60 * 1000),
      );
      if (candlesPassed < this.config.tradingControl.cooldownPeriod) {
        return false;
      }
    }

    // 일일 거래량 및 연속 손실 확인
    if (this.dailyTradeCount >= this.config.tradingControl.maxDailyTrades)
      return false;
    if (
      this.consecutiveLosses >= this.config.tradingControl.consecutiveLossLimit
    )
      return false;

    return true;
  }

  /**
   * 모든 진입 조건 확인
   */
  private checkAllEntryConditions(
    candles: Candle[],
    index: number,
  ): {
    passed: boolean;
    volumeOk: boolean;
    momentumOk: boolean;
    structureOk: boolean;
  } {
    const volumeOk = this.checkVolumeConfirmation(candles, index);
    const momentumOk = this.checkMomentum(candles, index);
    const structureOk = this.checkMarketStructure(candles, index);

    return {
      passed: volumeOk && momentumOk && structureOk,
      volumeOk,
      momentumOk,
      structureOk,
    };
  }

  async shouldEnter(candles: Candle[]): Promise<boolean> {
    const minRequired = Math.max(
      this.config.rollingWindow.longPeriod,
      this.config.entryConditions.marketStructure.emaPeriod,
      this.config.riskManagement.atr.period,
    );

    // BaseStrategy 검증 활용
    if (!this.validateCandleData(candles, minRequired + 1)) {
      if (this.config.logging.level >= 2) {
        console.log(
          `🔍 [돌파전략] 데이터 검증 실패 (필요: ${minRequired + 1}, 현재: ${
            candles.length
          })`,
        );
      }
      return false;
    }

    // 포지션 확인 (실거래 모드)
    if (!this.isBacktest && this.entryPrice !== null) return false;

    // 거래 제어 확인
    const currentTime = candles[candles.length - 1].timestamp;
    if (!this.checkTradingControls(currentTime)) return false;

    const currentIndex = candles.length - 1;
    const currentCandle = candles[currentIndex];

    // 변동성 지표 계산
    const volatility = this.calculateVolatilityMetrics(candles, currentIndex);
    if (!volatility) return false;

    // 시장 상태 분석
    const marketState = this.analyzeMarketState(candles, currentIndex);

    // 동적 K 팩터 업데이트
    this.updateKFactor(volatility, marketState);

    // 돌파 목표가 계산
    const breakoutTarget = this.calculateBreakoutTarget(candles, currentIndex);
    if (!breakoutTarget) return false;

    // 가격 돌파 확인
    const isPriceBreakout = currentCandle.high >= breakoutTarget;
    if (!isPriceBreakout) {
      if (this.config.logging.level >= 3) {
        console.log(
          `📊 [돌파전략] 목표가 미달성 - 현재고가: ${currentCandle.high.toFixed(
            2,
          )}, 목표가: ${breakoutTarget.toFixed(2)}`,
        );
      }
      return false;
    }

    // 다중 조건 확인
    const conditions = this.checkAllEntryConditions(candles, currentIndex);

    if (this.config.logging.level >= 1 && conditions.passed) {
      console.log(`🚀 [돌파전략] 진입 신호 발생!`);
      console.log(
        `   💰 돌파가: ${breakoutTarget.toFixed(
          2,
        )} → 현재고가: ${currentCandle.high.toFixed(2)}`,
      );
      console.log(
        `   📈 K팩터: ${this.currentKFactor.toFixed(3)} (변동성: ${(
          volatility.adaptive * 100
        ).toFixed(2)}%)`,
      );
      if (marketState) {
        console.log(
          `   🌐 시장상태: ${marketState.regime} (추세: ${marketState.trendDirection})`,
        );
      }
      console.log(
        `   ✅ 조건: 거래량(${conditions.volumeOk}) 모멘텀(${conditions.momentumOk}) 구조(${conditions.structureOk})`,
      );
    }

    return conditions.passed;
  }

  async execute(
    market: string,
    volume: number,
    candles: Candle[],
  ): Promise<void> {
    const currentCandle = candles[candles.length - 1];
    this.entryPrice = currentCandle.close;
    this.entryTime = currentCandle.timestamp;
    this.trailingStopPrice = null;
    this.dailyTradeCount++;

    // ATR 계산 및 목표가/손절가 설정
    const atrValues = this.calculateATR(
      candles,
      this.config.riskManagement.atr.period,
    );
    const currentATR =
      atrValues.length > 0 ? atrValues[atrValues.length - 1] : 0;

    // BaseStrategy의 calculateTargetLevels 활용
    const { targetPrice, stopLossPrice } = this.calculateTargetLevels(
      candles,
      currentATR,
      this.config.riskManagement.atr.profitMultiplier,
      this.config.riskManagement.atr.stopMultiplier,
      this.config.riskManagement.positionSize.minRiskReward,
    );

    // 거래량 강도 계산 (BaseStrategy 포지션 사이징용)
    const volumeStrength = TechnicalIndicators.analyzeVolumeStrength(
      candles,
      10,
    );
    const positionRatio = this.calculatePositionSizing(volumeStrength);

    if (!this.isBacktest) {
      await this.client.createOrder({
        market,
        side: "bid",
        volume: (volume * positionRatio).toString(),
        ord_type: "market",
      });
    }

    // BaseStrategy의 logTrade 활용
    if (this.config.logging.level >= 1) {
      this.logTrade(
        "BUY",
        market,
        this.entryPrice,
        volume * positionRatio,
        `TrendBreakout 진입 - 목표가: ${targetPrice.toFixed(
          0,
        )}, 손절가: ${stopLossPrice.toFixed(
          0,
        )}, 거래량강도: ${volumeStrength.toFixed(0)}%`,
      );
    }
  }

  /**
   * 트레일링 스탑 업데이트 및 확인
   */
  private updateTrailingStop(
    currentPrice: number,
    currentATR: number,
    entryPrice: number,
  ): boolean {
    if (!this.config.riskManagement.atr.trailingStop || !this.entryPrice)
      return false;

    const trailingThreshold =
      this.entryPrice +
      currentATR * this.config.riskManagement.atr.trailingThreshold;

    if (currentPrice >= trailingThreshold) {
      const newTrailingStop =
        currentPrice -
        currentATR * this.config.riskManagement.atr.stopMultiplier;
      if (!this.trailingStopPrice || newTrailingStop > this.trailingStopPrice) {
        this.trailingStopPrice = newTrailingStop;
        if (this.config.logging.level >= 2) {
          console.log(
            `🔄 [돌파전략] 트레일링 스탑 업데이트: ${this.trailingStopPrice.toFixed(
              2,
            )}`,
          );
        }
      }
    }

    return (
      this.trailingStopPrice !== null && currentPrice <= this.trailingStopPrice
    );
  }

  /**
   * 기본 수익/손절 확인 (BaseStrategy 활용)
   */
  private checkBasicExitConditions(
    candles: Candle[],
    currentPrice: number,
    entryPrice: number,
    currentATR: number,
  ): {
    shouldExit: boolean;
    reason: string;
    profitPercent: number;
  } {
    const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

    // BaseStrategy의 calculateTargetLevels 활용
    const { targetPrice: profitTarget, stopLossPrice: stopLoss } =
      this.calculateTargetLevels(
        candles,
        currentATR,
        this.config.riskManagement.atr.profitMultiplier,
        this.config.riskManagement.atr.stopMultiplier,
        this.config.riskManagement.positionSize.minRiskReward,
      );

    if (currentPrice >= profitTarget) {
      return {
        shouldExit: true,
        reason: `수익실현 - 목표가: ${profitTarget.toFixed(2)}`,
        profitPercent,
      };
    }

    if (currentPrice <= stopLoss) {
      this.consecutiveLosses++;
      return {
        shouldExit: true,
        reason: `손절 - 손절가: ${stopLoss.toFixed(2)}`,
        profitPercent,
      };
    }

    return { shouldExit: false, reason: "", profitPercent };
  }

  /**
   * 시간 기반 종료 확인
   */
  private checkTimeBasedExit(currentCandle: Candle): boolean {
    if (!this.config.riskManagement.timeDecay.enabled || !this.entryTime)
      return false;

    const currentTime = currentCandle.timestamp;
    const holdPeriod = Math.floor(
      (currentTime - this.entryTime) / (3 * 60 * 1000),
    ); // 3분봉 기준

    return holdPeriod >= this.config.riskManagement.timeDecay.maxHoldPeriod;
  }

  async shouldExit(candles: Candle[], entryPrice: number): Promise<boolean> {
    const currentCandle = candles[candles.length - 1];
    const currentPrice = currentCandle.close;

    // ATR 기반 동적 목표가/손절가 계산
    const atrValues = this.calculateATR(
      candles,
      this.config.riskManagement.atr.period,
    );
    if (atrValues.length === 0) return false;

    const currentATR = atrValues[atrValues.length - 1];

    // 트레일링 스탑 확인
    const isTrailingStop = this.updateTrailingStop(
      currentPrice,
      currentATR,
      entryPrice,
    );
    if (isTrailingStop) {
      const profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
      if (this.config.logging.level >= 1) {
        console.log(
          `🛑 [돌파전략] 트레일링 스탑 실행 - 수익률: ${profitPercent.toFixed(
            2,
          )}%`,
        );
      }
      this.resetPosition();
      return true;
    }

    // 기본 수익실현/손절 확인
    const exitCheck = this.checkBasicExitConditions(
      candles,
      currentPrice,
      entryPrice,
      currentATR,
    );
    if (exitCheck.shouldExit) {
      if (this.config.logging.level >= 1) {
        console.log(
          `💰 [돌파전략] ${
            exitCheck.reason
          }, 수익률: ${exitCheck.profitPercent.toFixed(2)}%`,
        );
      }
      this.resetPosition();
      return true;
    }

    // 시간 기반 종료
    if (this.checkTimeBasedExit(currentCandle)) {
      if (this.config.logging.level >= 1) {
        const holdPeriod = Math.floor(
          (currentCandle.timestamp - this.entryTime) / (3 * 60 * 1000),
        );
        console.log(
          `⏰ [돌파전략] 시간만료 종료 - 보유기간: ${holdPeriod}캔들, 수익률: ${exitCheck.profitPercent.toFixed(
            2,
          )}%`,
        );
      }
      this.resetPosition();
      return true;
    }

    // 상세 로그
    if (this.config.logging.level >= 3) {
      const profitTarget =
        entryPrice +
        currentATR * this.config.riskManagement.atr.profitMultiplier;
      const stopLoss =
        entryPrice - currentATR * this.config.riskManagement.atr.stopMultiplier;
      console.log(
        `📊 [돌파전략] 포지션 유지 - 진입: ${entryPrice.toFixed(
          2,
        )}, 현재: ${currentPrice.toFixed(
          2,
        )}, 수익률: ${exitCheck.profitPercent.toFixed(2)}%`,
      );
      console.log(
        `   🎯 목표가: ${profitTarget.toFixed(2)}, 손절가: ${stopLoss.toFixed(
          2,
        )}`,
      );
    }

    return false;
  }

  private resetPosition(): void {
    if (!this.isBacktest) {
      this.entryPrice = null;
      this.entryTime = null;
      this.trailingStopPrice = null;
    }
    this.lastTradeTime = Date.now();
  }

  async executeSell(market: string, volume: number): Promise<void> {
    if (!this.isBacktest) {
      await this.client.createOrder({
        market,
        side: "ask",
        volume: volume.toString(),
        ord_type: "market",
      });
    }

    if (this.config.logging.level >= 1) {
      console.log(`✅ [돌파전략] ${market} 매도완료`);
    }
  }
}
