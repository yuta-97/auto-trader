// TrendBreakout strategy fully migrated to trading-signals library
import { ATR, SMA, EMA } from "trading-signals";
import { Strategy, Candle } from "./type";
import { UpbitClient } from "@/api/upbitClient";

/** 추세 돌파 + ATR 트레일링 스탑 */
export class TrendBreakout implements Strategy {
  name = "추세 돌파";
  #client: UpbitClient;
  verbose: boolean = false; // 자세한 로그 출력 활성화 여부

  // 전략 파라미터
  #lookbackPeriod: number = 20; // 추세 판단 기간
  #stopFactor: number = 2; // 손절 ATR 배수
  #profitFactor: number = 3; // 목표 ATR 배수
  #volumeRatio: number = 1.5; // 거래량 증가 요구 비율
  #obvConfirmation: boolean = true; // OBV(On Balance Volume) 확인
  #consecutiveCandlesUp: number = 2; // 연속 상승 캔들 수
  #useVolumeBreakout: boolean = true; // 거래량 돌파 확인 사용

  // 이동평균 지표 파라미터
  #useMaFilter: boolean = true; // 이동평균 필터 사용
  #maPeriod: number = 20; // 이동평균 기간
  #volumeEmaPeriod: number = 20; // 거래량 지수이동평균 기간

  // VWAP(Volume Weighted Average Price) 파라미터
  #useVwapFilter: boolean = true; // VWAP 필터 사용
  #vwapPeriod: number = 20; // VWAP 계산 기간

  // 성능 최적화를 위한 지표 인스턴스 재사용
  #atr: ATR;
  #sma: SMA;
  #volumeEma: EMA;
  #lastProcessedIndex: number = -1;

  constructor(client: UpbitClient) {
    this.#client = client;
    this.#atr = new ATR(14);
    this.#sma = new SMA(this.#maPeriod);
    this.#volumeEma = new EMA(this.#volumeEmaPeriod);
  }

  /**
   * 거래량 가중 평균 가격(VWAP) 계산
   * trading-signals에는 VWAP이 없으므로 수동으로 계산
   */
  private calculateVWAP(candles: Candle[], period: number = 20): number {
    if (candles.length < period) return 0;

    const recentCandles = candles.slice(-period);

    let totalVolume = 0;
    let totalVolumePrice = 0;

    for (const candle of recentCandles) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 0;

      totalVolumePrice += typicalPrice * volume;
      totalVolume += volume;
    }

    return totalVolume > 0 ? totalVolumePrice / totalVolume : 0;
  }

  /**
   * OBV(On Balance Volume) 계산
   * trading-signals에는 OBV가 없으므로 수동으로 계산
   */
  private calculateOBV(candles: Candle[]): number[] {
    if (candles.length < 2) return [];

    const obvValues: number[] = [];
    let obv = 0;

    for (let i = 1; i < candles.length; i++) {
      const currentClose = candles[i].close;
      const previousClose = candles[i - 1].close;
      const volume = candles[i].volume || 0;

      if (currentClose > previousClose) {
        obv += volume; // 가격 상승시 거래량 추가
      } else if (currentClose < previousClose) {
        obv -= volume; // 가격 하락시 거래량 차감
      }
      // 가격 변화 없으면 OBV 변화 없음

      obvValues.push(obv);
    }

    return obvValues;
  }

  /**
   * 거래량 돌파 확인
   * 현재 거래량이 이전 거래량의 이동평균보다 크게 증가했는지 확인
   */
  private checkVolumeBreakout(candles: Candle[]): boolean {
    if (candles.length < this.#volumeEmaPeriod + 5) return false;

    // 이미 계산된 거래량 EMA 값 사용
    const lastVolumeEma = this.#volumeEma.getResult();
    if (!lastVolumeEma) return false;

    const lastVolumeEmaNumber = Number(lastVolumeEma);
    const currentVolume = candles.at(-1).volume || 0;

    // 현재 거래량이 EMA의 1.5배 이상인지 확인
    const isVolumeBreakout =
      currentVolume > lastVolumeEmaNumber * this.#volumeRatio;

    // 가격 상승과 함께 거래량 돌파가 발생했는지 확인
    const isPriceUp = candles.at(-1).close > candles.at(-2).close;

    return isVolumeBreakout && isPriceUp;
  }

  /**
   * 추세 강도 검증 (연속 상승, 이동평균 대비 위치)
   */
  private checkTrendStrength(candles: Candle[]): boolean {
    if (candles.length < this.#maPeriod) return false;

    const recentCandles = candles.slice(-this.#consecutiveCandlesUp - 1);
    let isConsecutiveUp = true;

    // 설정된 연속 캔들 상승 확인
    for (let i = 1; i <= this.#consecutiveCandlesUp; i++) {
      if (
        recentCandles[recentCandles.length - i].close <=
        recentCandles[recentCandles.length - i - 1].close
      ) {
        isConsecutiveUp = false;
        break;
      }
    }

    if (!isConsecutiveUp) return false;

    // 이동평균 대비 위치 확인 - 이미 계산된 SMA 값 사용
    if (this.#useMaFilter) {
      const smaResult = this.#sma.getResult();

      if (smaResult) {
        const currentPrice = candles.at(-1).close;
        const smaValue = Number(smaResult);

        // 현재 가격이 이동평균 위에 있어야 함
        if (currentPrice <= smaValue) return false;
      }
    }

    return true;
  }

  /**
   * OBV 확인 - 거래량 추세와 가격 추세의 일치성 검증
   */
  private checkOBVConfirmation(candles: Candle[]): boolean {
    if (!this.#obvConfirmation || candles.length < 10) return true;

    const obvValues = this.calculateOBV(candles);
    if (obvValues.length < 3) return true;

    // 최근 3일간 OBV 상승 추세인지 확인
    const recent3 = obvValues.slice(-3);
    const isOBVRising = recent3[2] > recent3[1] && recent3[1] > recent3[0];

    // 가격도 상승 추세인지 확인
    const recent3Prices = candles.slice(-3).map(c => c.close);
    const isPriceRising =
      recent3Prices[2] > recent3Prices[1] &&
      recent3Prices[1] > recent3Prices[0];

    // OBV와 가격이 모두 상승 중이어야 함 (확인 신호)
    return isOBVRising && isPriceRising;
  }

  /**
   * VWAP 필터링 - 현재 가격이 VWAP 위에 있는지 확인
   */
  private checkVWAPFilter(candles: Candle[]): boolean {
    if (!this.#useVwapFilter) return true;

    const vwap = this.calculateVWAP(candles, this.#vwapPeriod);
    if (vwap === 0) return true; // VWAP 계산 실패시 통과

    const currentPrice = candles.at(-1).close;
    return currentPrice > vwap; // 현재 가격이 VWAP 위에 있어야 함
  }

  /**
   * 거래량 강도 분석 - 상승 캔들의 거래량 vs 하락 캔들의 거래량
   */
  private analyzeVolumeStrength(candles: Candle[]): number {
    if (candles.length < 10) return 50; // 기본값

    const recent10 = candles.slice(-10);

    let upVolumeSum = 0;
    let downVolumeSum = 0;

    for (const candle of recent10) {
      const volume = candle.volume || 0;
      if (candle.close > candle.open) {
        upVolumeSum += volume;
      } else if (candle.close < candle.open) {
        downVolumeSum += volume;
      }
    }

    const totalVolume = upVolumeSum + downVolumeSum;
    if (totalVolume === 0) return 50;

    // 상승 거래량 비율 (0-100)
    return (upVolumeSum / totalVolume) * 100;
  }

  async shouldEnter(candles: Candle[]): Promise<boolean> {
    if (candles.length < Math.max(this.#lookbackPeriod, this.#maPeriod) + 5) {
      if (this.verbose) {
        console.log("TrendBreakout: 충분한 데이터가 없음");
      }
      return false;
    }

    // 성능 최적화: 새로운 캔들만 처리
    const currentIndex = candles.length - 1;

    // 처음 실행이거나 새로운 캔들이 추가된 경우에만 업데이트
    if (this.#lastProcessedIndex < currentIndex) {
      // 처음 실행인 경우 모든 데이터 처리
      if (this.#lastProcessedIndex === -1) {
        for (const candle of candles) {
          this.#atr.update(
            {
              high: candle.high,
              low: candle.low,
              close: candle.close,
            },
            false,
          );
          this.#sma.update(candle.close, false);
          this.#volumeEma.update(candle.volume || 0, false);
        }
      } else {
        // 새로운 캔들만 처리
        for (let i = this.#lastProcessedIndex + 1; i <= currentIndex; i++) {
          const candle = candles[i];
          this.#atr.update(
            {
              high: candle.high,
              low: candle.low,
              close: candle.close,
            },
            false,
          );
          this.#sma.update(candle.close, false);
          this.#volumeEma.update(candle.volume || 0, false);
        }
      }
      this.#lastProcessedIndex = currentIndex;
    }

    // 1. 추세 강도 검증 (연속 상승, 이동평균 확인)
    const trendStrengthOk = this.checkTrendStrength(candles);
    if (this.verbose) {
      console.log(`TrendBreakout: 추세 강도 검증 = ${trendStrengthOk}`);
    }
    if (!trendStrengthOk) return false;

    // 2. 거래량 돌파 확인
    const volumeBreakoutOk = this.#useVolumeBreakout
      ? this.checkVolumeBreakout(candles)
      : true;
    if (this.verbose) {
      console.log(`TrendBreakout: 거래량 돌파 확인 = ${volumeBreakoutOk}`);
    }
    if (!volumeBreakoutOk) return false;

    // 3. OBV 확인 (거래량 추세와 가격 추세 일치성)
    const obvConfirmationOk = this.checkOBVConfirmation(candles);
    if (this.verbose) {
      console.log(`TrendBreakout: OBV 확인 = ${obvConfirmationOk}`);
    }
    if (!obvConfirmationOk) return false;

    // 4. VWAP 필터
    const vwapFilterOk = this.checkVWAPFilter(candles);
    if (this.verbose) {
      console.log(`TrendBreakout: VWAP 필터 = ${vwapFilterOk}`);
    }
    if (!vwapFilterOk) return false;

    // 5. 거래량 강도 분석
    const volumeStrength = this.analyzeVolumeStrength(candles);
    const volumeStrengthOk = volumeStrength >= 60; // 60% 이상 상승 거래량
    if (this.verbose) {
      console.log(
        `TrendBreakout: 거래량 강도 = ${volumeStrength.toFixed(
          1,
        )}%, 통과 = ${volumeStrengthOk}`,
      );
    }
    if (!volumeStrengthOk) return false;

    if (this.verbose) {
      console.log("TrendBreakout: 모든 조건 만족 - 진입 신호 발생!");
    }

    return true;
  }

  private calculateStopAndTarget(candles: Candle[]): {
    stopLoss: number;
    target: number;
  } {
    const entryPrice = candles.at(-1).close;

    // 이미 계산된 ATR 값 사용
    const atrValue = this.#atr.getResult();
    const atrNumber = atrValue ? Number(atrValue) : entryPrice * 0.02; // 기본값 2%

    const stopLoss = entryPrice - this.#stopFactor * atrNumber;
    const target = entryPrice + this.#profitFactor * atrNumber;

    return { stopLoss, target };
  }

  async execute(
    market: string,
    volume: number,
    candles: Candle[],
  ): Promise<void> {
    const entryPrice = candles.at(-1).close;
    const { stopLoss, target } = this.calculateStopAndTarget(candles);

    // 거래량 강도에 따른 포지션 크기 조정
    const volumeStrength = this.analyzeVolumeStrength(candles);
    let positionRatio: number;

    if (volumeStrength >= 80) {
      positionRatio = 1.0; // 매우 강한 신호 - 100%
    } else if (volumeStrength >= 70) {
      positionRatio = 0.8; // 강한 신호 - 80%
    } else if (volumeStrength >= 60) {
      positionRatio = 0.6; // 적정 신호 - 60%
    } else {
      positionRatio = 0.4; // 약한 신호 - 40%
    }

    const adjustedVolume = volume * positionRatio;

    // 매수 주문 실행
    await this.#client.createOrder({
      market,
      side: "bid",
      volume: adjustedVolume.toString(),
      ord_type: "market",
    });

    if (this.verbose) {
      console.log(
        `${market} 추세 돌파 전략 진입 - 진입가: ${entryPrice}`,
        `목표가: ${target.toFixed(0)}, 손절가: ${stopLoss.toFixed(0)}`,
        `(이익: ${((target / entryPrice - 1) * 100).toFixed(2)}%, 손실: ${(
          (stopLoss / entryPrice - 1) *
          100
        ).toFixed(2)}%)`,
        `- 거래량 강도: ${volumeStrength.toFixed(0)}%, 포지션 비율: ${(
          positionRatio * 100
        ).toFixed(0)}%`,
      );
    }

    // 목표가 매도 주문 (지정가)
    await this.#client.createOrder({
      market,
      side: "ask",
      price: target.toFixed(0),
      volume: adjustedVolume.toString(),
      ord_type: "limit",
    });

    // 손절 매도 주문 (지정가)
    await this.#client.createOrder({
      market,
      side: "ask",
      price: stopLoss.toFixed(0),
      volume: adjustedVolume.toString(),
      ord_type: "limit",
    });
  }
}
