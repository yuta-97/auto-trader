import { Candle, Strategy } from "./type";
import { UpbitClient } from "@/api/upbitClient";

export interface RiskManagementConfig {
  maxRiskPerTrade: number; // 거래당 최대 리스크 (계좌 대비 %)
  maxTotalRisk: number; // 전체 포지션 최대 리스크 (계좌 대비 %)
  minTradeAmount: number; // 최소 거래 금액
  maxTradeAmount: number; // 최대 거래 금액
}

export class StrategyManager {
  #strategies: Strategy[] = [];
  #client: UpbitClient;
  #markets: string[];
  #candleInterval: number;
  #candleCount: number;
  #riskConfig: RiskManagementConfig;

  constructor(
    client: UpbitClient,
    markets: string[],
    riskConfig: RiskManagementConfig = {
      maxRiskPerTrade: 0.02, // 거래당 최대 2% 리스크
      maxTotalRisk: 0.1, // 전체 포지션 최대 10% 리스크
      minTradeAmount: 10000, // 최소 1만원
      maxTradeAmount: 1000000, // 최대 100만원
    },
    candleInterval: number = 1,
    candleCount: number = 120,
  ) {
    if (!markets || markets.length === 0) {
      throw new Error("트레이딩 대상 마켓을 지정해야 합니다.");
    }

    this.#client = client;
    this.#markets = markets;
    this.#riskConfig = riskConfig;
    this.#candleInterval = candleInterval;
    this.#candleCount = candleCount;
  }

  register(s: Strategy) {
    this.#strategies.push(s);
  }

  /**
   * 계좌 잔고 기반 거래량 계산 (백테스트/실트레이딩 호환)
   */
  private async calculateTradeVolume(
    market: string,
    currentPrice?: number,
    candles?: Candle[],
  ): Promise<number> {
    try {
      // 현재는 고정 금액 기반으로 처리 (향후 실제 계좌 API 연동 예정)
      const baseTradeAmount = 5000; // 5천원 기본 거래 금액

      let price = currentPrice;

      // 현재 가격이 제공되지 않았으면 가격 조회
      if (!price) {
        if (candles && candles.length > 0) {
          // 백테스트: 제공된 캔들 데이터에서 최신 가격 사용
          const latestCandle = candles[candles.length - 1];
          price = latestCandle.close ?? latestCandle.low;
        } else {
          // 실제 트레이딩: API에서 최신 데이터 조회
          const recentCandles = await this.#client.fetchCandles(
            market,
            this.#candleInterval,
            1,
          );
          if (!recentCandles || recentCandles.length === 0) {
            console.warn(`${market}: 시장 데이터 조회 실패`);
            return 0;
          }
          price = recentCandles[0].trade_price;
        }
      }

      // 유효한 가격이 없으면 0 반환
      if (!price || price <= 0) {
        console.warn(`${market}: 유효하지 않은 가격 (${price})`);
        return 0;
      }

      // 리스크 기반 거래 금액 조정
      const adjustedAmount = Math.min(
        baseTradeAmount,
        this.#riskConfig.maxTradeAmount,
      );

      // 거래량 계산 (KRW 금액 / 현재 가격)
      const volume = adjustedAmount / price;

      console.log(
        `${market} 거래량 계산: ${adjustedAmount.toLocaleString()}원 (${volume.toFixed(
          8,
        )} ${market.split("-")[1]})`,
      );

      return volume;
    } catch (error) {
      console.error(`${market} 거래량 계산 실패:`, error);
      return 0;
    }
  }

  async loop() {
    for (const market of this.#markets) {
      console.log(`전략 실행 중: ${market}`);
      const candles = await this.#client.fetchCandles(
        market,
        this.#candleInterval,
        this.#candleCount,
      );

      // 동적 거래량 계산 (캔들 데이터 전달)
      const volume = await this.calculateTradeVolume(
        market,
        undefined,
        candles,
      );

      if (volume <= 0) {
        console.warn(`${market}에 대한 유효한 거래량을 계산할 수 없습니다.`);
        continue;
      }

      for (const strategy of this.#strategies) {
        try {
          const shouldEnter = await strategy.shouldEnter(candles);
          if (shouldEnter) {
            console.log(`${market} - 전략 실행: ${strategy.name}`);
            await strategy.execute(market, volume, candles);
          }
        } catch (error) {
          console.error(`전략 실행 실패 (${strategy.name}, ${market}):`, error);
        }
      }
    }
    setTimeout(() => this.loop(), 1000 * 60); // 1 분 간격
  }
}
