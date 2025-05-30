/**
 * 전략 백테스트
 */
import { UpbitClient } from "../api/upbitClient";
import { BacktestDataProvider } from "./BacktestDataProvider";
import { Backtester } from "./Backtester";
import {
  TrendBreakout,
  // RsiBollinger,
  // GridTrading,
  // MomentumBreak,
  // MeanReversion,
  // VolumeSpike,
} from "../strategies/core";
import path from "path";
import fs from "fs";
import { BACKTEST_CONFIG, STRATEGY_CONFIG } from "./config";

/**
 * 데이터 수집만 실행
 */
async function collectData(force: boolean = false) {
  console.log("=== 데이터 수집 시작 ===");

  const client = new UpbitClient(""); // 데이터 수집용 (키 불필요)
  const dataDir = path.join(__dirname, "../../data");
  const dataProvider = new BacktestDataProvider(dataDir);

  // 파일 존재 확인 및 강제 갱신 체크
  const fileName = `${BACKTEST_CONFIG.MARKET.replace("-", "_")}_${
    BACKTEST_CONFIG.INTERVAL
  }min.csv`;
  const filePath = path.join(dataDir, fileName);

  if (fs.existsSync(filePath) && !force) {
    console.log(`📂 기존 데이터 파일이 있습니다: ${fileName}`);
    console.log("강제 갱신하려면 --force 옵션을 사용하세요.");
    return;
  }

  if (force && fs.existsSync(filePath)) {
    console.log(`🔄 기존 데이터 파일을 삭제합니다: ${fileName}`);
    fs.unlinkSync(filePath);
  }

  try {
    await dataProvider.collectHistoricalData(
      client,
      BACKTEST_CONFIG.MARKET,
      BACKTEST_CONFIG.INTERVAL,
      BACKTEST_CONFIG.DAYS,
    );
    console.log("✅ 데이터 수집 완료!");
  } catch (error) {
    console.error("❌ 데이터 수집 실패:", error);
    throw error;
  }
}

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

  // 데이터 파일 존재 여부 확인 및 자동 수집
  const dataDir = path.join(__dirname, "../../data");
  const fileName = `${BACKTEST_CONFIG.MARKET.replace("-", "_")}_${
    BACKTEST_CONFIG.INTERVAL
  }min.csv`;
  const filePath = path.join(dataDir, fileName);

  if (!fs.existsSync(filePath)) {
    console.log(`📂 데이터 파일이 없습니다: ${fileName}`);
    console.log("🔄 자동으로 데이터를 수집합니다...\n");
    await collectData(false);
    console.log("✅ 데이터 수집 완료! 백테스트를 계속합니다...\n");
  }

  // 더미 클라이언트 (백테스트에서는 실제 API 호출 안함)
  const client = {} as UpbitClient;

  // 전략들 초기화 (백테스트 모드로)
  const strategies = [
    new TrendBreakout(client, STRATEGY_CONFIG.TREND_BREAKOUT, true),
    // new RsiBollinger(client, STRATEGY_CONFIG.RSI_BOLLINGER, true),
    // new GridTrading(client, STRATEGY_CONFIG.GRID_TRADING, true),
    // new MomentumBreak(client, STRATEGY_CONFIG.MOMENTUM_BREAK, true),
    // new MeanReversion(client, STRATEGY_CONFIG.MEAN_REVERSION, true),
    // new VolumeSpike(client, STRATEGY_CONFIG.VOLUME_SPIKE, true),
  ];

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
  const command = args[0];
  const verbose = args.includes("--verbose") || args.includes("-v");
  const force = args.includes("--force");

  async function main() {
    try {
      switch (command) {
        case "collect":
          await collectData(force);
          break;

        case "backtest":
          if (verbose) {
            console.log("상세 모드로 백테스트를 실행합니다...\n");
          }
          await runBacktestStrategies(verbose);
          break;

        case "full":
          console.log("데이터 수집 후 백테스트를 실행합니다...\n");
          await collectData(false); // 기존 파일 있어도 수집
          await runBacktestStrategies(verbose);
          break;

        default:
          // 기본값: 백테스트 실행 (데이터 없으면 자동 수집)
          await runBacktestStrategies(verbose);
          break;
      }
    } catch (error) {
      console.error("실행 중 오류 발생:", error);
      process.exit(1);
    }
  }

  main();
}

export { runBacktestStrategies, collectData };
