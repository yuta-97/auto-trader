/**
 * PRE-requisite function.
 *
 * check env files and set module import method.
 */

import { configDotenv } from "dotenv";
import moduleAlias from "module-alias";
moduleAlias.addAlias("@", __dirname);
configDotenv();

import { config } from "@/config";
import express from "express";
import { expressLoader } from "./loader";
import { StrategyManager } from "./strategies/Manager";
import { TrendBreakout, RsiBollinger, GridTrading } from "./strategies/core";
import { UpbitClient } from "./api/upbitClient";
import { MARKETS, CANDLE_INTERVAL } from "./strategies/constants";

const main = async () => {
  const app = express();

  expressLoader({ app });

  // UpbitClient 초기화 및 전략 매니저 설정
  const client = new UpbitClient(config.accessKey);

  // 거래할 마켓 목록 설정
  const tradingMarkets = [MARKETS.BTC, MARKETS.ETH];

  // 리스크 관리 설정
  const riskConfig = {
    maxRiskPerTrade: 0.02, // 거래당 최대 2% 리스크
    maxTotalRisk: 0.1, // 전체 포지션 최대 10% 리스크
    minTradeAmount: 10000, // 최소 1만원
    maxTradeAmount: 100000, // 최대 10만원 (보수적 설정)
  };

  // 전략 관리자 초기화
  const manager = new StrategyManager(
    client,
    tradingMarkets,
    riskConfig,
    CANDLE_INTERVAL.MIN_15, // 15분봉 기준으로 전략 실행
  );

  // 사용할 전략 등록
  manager.register(new TrendBreakout(client));
  manager.register(new RsiBollinger(client));
  manager.register(new GridTrading(client));

  // 봇 시작
  manager.loop();

  app.listen(config.portNumber, () => {
    console.log(`server is running on port ${config.portNumber}`);
  });
};

main();
