/**
 * 새로운 전략들을 위한 백테스트 (데모)
 */
import { UpbitClient } from "../api/upbitClient";
import { BacktestDataProvider } from "./BacktestDataProvider";
import { Backtester } from "./Backtester";
import { TrendBreakout, RsiBollinger, GridTrading } from "../strategies/core";
import path from "path";
import { MARKETS, CANDLE_INTERVAL } from "../strategies/constants";

async function testNewStrategies() {
  console.log("=== 새로운 전략 백테스트 시작 ===\n");

  // 더미 클라이언트 (백테스트에서는 실제 API 호출 안함)
  const client = {} as UpbitClient;

  // 새로운 전략들 초기화
  const strategies = [
    new TrendBreakout(client, {
      profitFactor: 2.5,
      stopFactor: 1.5,
      volumeConfig: {
        volumeThreshold: 1.3,
        volumeRatio: 1.4,
        obvConfirmation: true,
        adlConfirmation: false,
      },
    }),
    new RsiBollinger(client, {
      rsiOversold: 25,
      minVolumeSignals: 3,
      volumeConfig: {
        volumeThreshold: 1.2,
        volumeRatio: 1.3,
        adlConfirmation: true,
        obvConfirmation: false,
      },
    }),
    new GridTrading(client, {
      gridCount: 7,
      volatilityThreshold: 0.12,
      volumeEfficiencyThreshold: 0.7,
    }),
  ];

  const dataDir = path.join(__dirname, "../../data");
  const markets = [MARKETS.BTC, MARKETS.ETH];

  for (const market of markets) {
    console.log(`\n📊 ${market} 백테스트 결과:`);
    console.log("=".repeat(50));

    try {
      const dataProvider = new BacktestDataProvider(dataDir);
      const backtester = new Backtester(dataProvider, true, true);

      for (const strategy of strategies) {
        console.log(`\n🔧 전략: ${strategy.name}`);

        const result = await backtester.runBacktest(
          strategy,
          market,
          CANDLE_INTERVAL.MIN_15,
          1000000, // 100만원 시뮬레이션
        );

        // 간단한 결과 출력
        console.log(`총 거래수: ${result.totalTrades}`);
        console.log(`승률: ${result.winRate.toFixed(1)}%`);
        console.log(`순손익: ${result.netProfit.toLocaleString()}원`);
        console.log(
          `수익률: ${((result.netProfit / 1000000) * 100).toFixed(2)}%`,
        );

        if (result.totalTrades > 0) {
          console.log(`수익비: ${result.profitFactor.toFixed(2)}`);
          console.log(`최대 낙폭: ${result.maxDrawdown.toFixed(2)}%`);
        }
      }
    } catch (error) {
      console.error(`${market} 백테스트 실패:`, error);
    }
  }

  console.log("\n=== 새로운 전략 백테스트 완료 ===");
}

// 직접 실행시에만 테스트 실행
if (require.main === module) {
  testNewStrategies().catch(console.error);
}

export { testNewStrategies };
