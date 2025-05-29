/**
 * 거래량 분석 모듈
 * 거래량 기반 신호 탐지 및 확인 로직
 */
import { Candle } from "../type";
import { TechnicalIndicators } from "./TechnicalIndicators";

export interface VolumeAnalysisConfig {
  volumeThreshold: number; // 거래량 증가 임계값 (배수)
  volumeRatio: number; // 거래량 돌파 임계값 (배수)
  adlConfirmation: boolean; // ADL 확인 사용 여부
  obvConfirmation: boolean; // OBV 확인 사용 여부
}

export class VolumeAnalyzer {
  private config: VolumeAnalysisConfig;

  constructor(config: VolumeAnalysisConfig) {
    this.config = config;
  }

  /**
   * 거래량 증가 패턴 확인
   */
  checkVolumePattern(candles: Candle[]): boolean {
    if (candles.length < 5) return false;

    const recentVolumes = candles.slice(-4).map(c => c.volume || 0);
    const isIncreasing = recentVolumes[3] > recentVolumes[2];

    const avgVolume = TechnicalIndicators.calculateAverageVolume(candles);
    const volumeRatio = recentVolumes[3] / avgVolume;

    const isPriceIncreasing = candles.at(-1)!.close > candles.at(-2)!.close;

    return (
      isIncreasing &&
      volumeRatio > this.config.volumeThreshold &&
      isPriceIncreasing
    );
  }

  /**
   * ADL 확인 - 누적 분배선이 상승 추세인지 확인
   */
  checkADLConfirmation(candles: Candle[]): boolean {
    if (!this.config.adlConfirmation || candles.length < 10) return true;

    const adlValues = TechnicalIndicators.calculateADL(candles);
    if (adlValues.length < 3) return false;

    return (
      adlValues.at(-1)! > adlValues.at(-2)! &&
      adlValues.at(-2)! > adlValues.at(-3)!
    );
  }

  /**
   * OBV 확인 - 거래량 추세와 가격 추세의 일치성 검증
   */
  checkOBVConfirmation(candles: Candle[]): boolean {
    if (!this.config.obvConfirmation || candles.length < 10) return true;

    const obvValues = TechnicalIndicators.calculateOBV(candles);
    if (obvValues.length < 3) return true;

    const recent3 = obvValues.slice(-3);
    const isOBVRising = recent3[2] > recent3[1] && recent3[1] > recent3[0];

    const recent3Prices = candles.slice(-3).map(c => c.close);
    const isPriceRising =
      recent3Prices[2] > recent3Prices[1] &&
      recent3Prices[1] > recent3Prices[0];

    return isOBVRising && isPriceRising;
  }

  /**
   * 거래량 돌파 확인 (EMA 기반)
   */
  checkVolumeBreakout(candles: Candle[], volumeEmaValue: number): boolean {
    if (candles.length < 5) return false;

    const currentVolume = candles.at(-1)!.volume || 0;
    const isVolumeBreakout =
      currentVolume > volumeEmaValue * this.config.volumeRatio;
    const isPriceUp = candles.at(-1)!.close > candles.at(-2)!.close;

    return isVolumeBreakout && isPriceUp;
  }

  /**
   * 종합 거래량 신호 분석
   */
  analyzeVolumeSignals(
    candles: Candle[],
    volumeEmaValue?: number,
  ): {
    hasVolumePattern: boolean;
    adlConfirmed: boolean;
    obvConfirmed: boolean;
    hasVolumeBreakout: boolean;
    volumeStrength: number;
    hasGoodVolume: boolean;
    signalCount: number;
  } {
    const hasVolumePattern = this.checkVolumePattern(candles);
    const adlConfirmed = this.checkADLConfirmation(candles);
    const obvConfirmed = this.checkOBVConfirmation(candles);
    const hasVolumeBreakout = volumeEmaValue
      ? this.checkVolumeBreakout(candles, volumeEmaValue)
      : false;

    const volumeStrength =
      TechnicalIndicators.calculateBuyingSellingSPressure(candles);
    const hasStrongBuying = volumeStrength >= 60;

    const avgVolume = TechnicalIndicators.calculateAverageVolume(candles);
    const latestVolume = candles.at(-1)!.volume ?? 0;
    const hasGoodVolume =
      latestVolume > avgVolume * this.config.volumeThreshold;

    const signals = [
      hasVolumePattern,
      adlConfirmed,
      obvConfirmed,
      hasStrongBuying,
      hasGoodVolume,
    ];
    if (hasVolumeBreakout) signals.push(hasVolumeBreakout);

    const signalCount = signals.filter(signal => signal).length;

    return {
      hasVolumePattern,
      adlConfirmed,
      obvConfirmed,
      hasVolumeBreakout,
      volumeStrength,
      hasGoodVolume,
      signalCount,
    };
  }
}
