import { ATR, SMA, EMA } from "trading-signals";
import { Candle } from "../type";
import { UpbitClient } from "@/api/upbitClient";
import { BaseStrategy } from "../base/BaseStrategy";
import {
  VolumeAnalyzer,
  VolumeAnalysisConfig,
} from "../indicators/VolumeAnalyzer";
import { TechnicalIndicators } from "../indicators/TechnicalIndicators";

export interface TrendBreakoutConfig {
  lookbackPeriod: number;
  stopFactor: number;
  profitFactor: number;
  consecutiveCandlesUp: number;
  maPeriod: number;
  volumeEmaPeriod: number;
  vwapPeriod: number;
  useMaFilter: boolean;
  useVwapFilter: boolean;
  useVolumeBreakout: boolean;
  volumeConfig: VolumeAnalysisConfig;
}

export class TrendBreakout extends BaseStrategy {
  name = "추세 돌파 (개선)";

  private config: TrendBreakoutConfig;
  private volumeAnalyzer: VolumeAnalyzer;

  // 지표 인스턴스
  private atr: ATR;
  private sma: SMA;
  private volumeEma: EMA;

  constructor(client: UpbitClient, config?: Partial<TrendBreakoutConfig>) {
    super(client);

    // 기본 설정
    this.config = {
      lookbackPeriod: 20,
      stopFactor: 2,
      profitFactor: 3,
      consecutiveCandlesUp: 2,
      maPeriod: 20,
      volumeEmaPeriod: 20,
      vwapPeriod: 20,
      useMaFilter: true,
      useVwapFilter: true,
      useVolumeBreakout: true,
      volumeConfig: {
        volumeThreshold: 1.5,
        volumeRatio: 1.5,
        adlConfirmation: false,
        obvConfirmation: true,
      },
      ...config,
    };

    this.volumeAnalyzer = new VolumeAnalyzer(this.config.volumeConfig);

    // 지표 초기화
    this.atr = new ATR(14);
    this.sma = new SMA(this.config.maPeriod);
    this.volumeEma = new EMA(this.config.volumeEmaPeriod);
  }

  /**
   * 지표 업데이트 (성능 최적화 적용)
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
      this.volumeEma.update(candle.volume || 0, false);
    }
  }

  /**
   * 추세 강도 검증
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

    // 이동평균 필터
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

  /**
   * VWAP 필터
   */
  private checkVWAPFilter(candles: Candle[]): boolean {
    if (!this.config.useVwapFilter) return true;

    const vwap = TechnicalIndicators.calculateVWAP(
      candles,
      this.config.vwapPeriod,
    );
    if (vwap === 0) return true;

    const currentPrice = candles.at(-1).close;
    return currentPrice > vwap;
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

    // 성능 최적화: 증분 지표 업데이트
    this.updateIndicatorsOptimized(candles, (fromIndex, toIndex) => {
      this.updateIndicators(fromIndex, toIndex, candles);
    });

    // 1. 추세 강도 검증
    const trendStrengthOk = this.checkTrendStrength(candles);
    if (!trendStrengthOk) return false;

    // 2. 거래량 분석
    const volumeEmaValue = Number(this.volumeEma.getResult() || 0);
    const volumeAnalysis = this.volumeAnalyzer.analyzeVolumeSignals(
      candles,
      volumeEmaValue,
    );

    // 거래량 돌파 확인
    if (this.config.useVolumeBreakout && !volumeAnalysis.hasVolumeBreakout) {
      return false;
    }

    // OBV 확인
    if (!volumeAnalysis.obvConfirmed) {
      return false;
    }

    // 3. VWAP 필터
    const vwapFilterOk = this.checkVWAPFilter(candles);
    if (!vwapFilterOk) return false;

    // 4. 거래량 강도 확인 (60% 이상)
    if (volumeAnalysis.volumeStrength < 60) {
      return false;
    }

    if (this.verbose) {
      console.log("TrendBreakout: 모든 조건 만족 - 진입 신호 발생!");
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

    // 거래량 강도에 따른 포지션 사이징
    const volumeStrength = TechnicalIndicators.analyzeVolumeStrength(candles);
    const volumeRatio = this.calculatePositionSizing(volumeStrength);

    // 주문 실행
    await this.executeOrders(market, volume, {
      entryPrice,
      targetPrice,
      stopLossPrice,
      volumeRatio,
    });

    // 로그 출력
    if (this.verbose) {
      this.logTrade(
        market,
        entryPrice,
        targetPrice,
        stopLossPrice,
        volumeStrength,
        volumeRatio,
      );
    }
  }
}
