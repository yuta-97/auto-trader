/**
 * 전략 백테스트
 */
import { UpbitClient } from "../api/upbitClient";
import { BacktestDataProvider } from "./BacktestDataProvider";
import { Backtester } from "./Backtester";
import { TrendBreakout, RsiBollinger, GridTrading } from "../strategies/core";
import path from "path";
import { MARKETS, CANDLE_INTERVAL } from "../strategies/constants";

// ===== 백테스트 설정 (직접 수정해서 사용) =====
const BACKTEST_CONFIG = {
  // 테스트할 마켓 (MARKETS.BTC, MARKETS.ETH 등)
  MARKET: MARKETS.ETH,

  // 캔들 간격 (CANDLE_INTERVAL.MIN_3, MIN_5, MIN_15, MIN_30, HOUR_1 등)
  INTERVAL: CANDLE_INTERVAL.MIN_3,

  // 초기 자본 (원)
  INITIAL_CAPITAL: 1000000, // 100만원

  // 백테스트 기간 (일)
  DAYS: 30,
};

async function runBacktestStrategies(verbose: boolean = false) {
  console.log("=== 전략 백테스트 시작 ===");
  console.log(`마켓: ${BACKTEST_CONFIG.MARKET}`);
  console.log(`간격: ${BACKTEST_CONFIG.INTERVAL}분`);
  console.log(
    `초기 자본: ${BACKTEST_CONFIG.INITIAL_CAPITAL.toLocaleString()}원`,
  );
  console.log(`기간: ${BACKTEST_CONFIG.DAYS}일`);
  console.log("=".repeat(50));
  console.log();

  // 더미 클라이언트 (백테스트에서는 실제 API 호출 안함)
  const client = {} as UpbitClient;

  // 전략들 초기화 (극단적으로 완화된 조건)
  const strategies = [
    new TrendBreakout(client, {
      profitFactor: 1.5, // 2.0 → 1.5로 더 완화
      stopFactor: 1.0, // 1.2 → 1.0으로 완화
      useMaFilter: false,
      consecutiveCandlesUp: 1,
      lookbackPeriod: 5, // 10 → 5로 단축
    }),
    new RsiBollinger(client, {
      rsiOversold: 60, // 55 → 60으로 더 완화
      bbStdDev: 0.8, // 1.0 → 0.8로 더 완화
      profitFactorMin: 1.05, // 1.1 → 1.05로 완화
    }),
    new GridTrading(client, {
      gridCount: 7,
      volatilityThreshold: 0.12,
      volumeEfficiencyThreshold: 0.7,
    }),
  ];

  const dataDir = path.join(__dirname, "../../data");

  console.log(`\n📊 ${BACKTEST_CONFIG.MARKET} 백테스트 결과:`);
  console.log("=".repeat(50));

  try {
    const dataProvider = new BacktestDataProvider(dataDir);
    const backtester = new Backtester(dataProvider, verbose);

    for (const strategy of strategies) {
      if (verbose) console.log(`\n🔧 전략: ${strategy.name}`);

      const result = await backtester.runBacktest(
        strategy,
        BACKTEST_CONFIG.MARKET,
        BACKTEST_CONFIG.INTERVAL,
        BACKTEST_CONFIG.INITIAL_CAPITAL,
      );

      // 기본 결과 출력
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

      // verbose 모드에서만 추가 정보 출력
      if (verbose && result.trades.length > 0) {
        const profits = result.trades.map(t => (t.profitPercent || 0) * 100);
        const avgProfit =
          profits.reduce((sum, p) => sum + p, 0) / profits.length;
        const maxProfit = Math.max(...profits);
        const minProfit = Math.min(...profits);

        console.log(`평균 수익률: ${avgProfit.toFixed(2)}%`);
        console.log(`최대 수익: +${maxProfit.toFixed(2)}%`);
        console.log(`최대 손실: ${minProfit.toFixed(2)}%`);
      }
    }
  } catch (error) {
    console.error(`${BACKTEST_CONFIG.MARKET} 백테스트 실패:`, error);
  }

  console.log("\n=== 전략 백테스트 완료 ===");
}

// 직접 실행시에만 테스트 실행
if (require.main === module) {
  // 명령행 인자 처리
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose") || args.includes("-v");

  if (verbose) {
    console.log("상세 모드로 백테스트를 실행합니다...\n");
  }

  runBacktestStrategies(verbose).catch(console.error);
}

export { runBacktestStrategies };
