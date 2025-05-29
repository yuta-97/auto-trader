#!/bin/bash

# 실행 명령어에 따라 다른 백테스트 옵션 실행

# 상세 로그 출력 옵션 확인
VERBOSE_FLAG=""
if [[ "$*" == *"--verbose"* || "$*" == *"-v"* ]]; then
  VERBOSE_FLAG="--verbose"
fi

case "$1" in
  "collect")
    echo "📊 KRW-ETH 15분봉 데이터 수집 중..."
    npx ts-node src/backtesting/backtest.ts collect $2
    ;;
  
  "backtest")
    echo "🧪 백테스트 실행 중... (기존 데이터 사용)"
    npx ts-node src/backtesting/backtest.ts backtest $VERBOSE_FLAG
    ;;
    
  "full")
    echo "📊 데이터 수집 후 백테스트 실행 중..."
    npx ts-node src/backtesting/backtest.ts full $VERBOSE_FLAG
    ;;
    
  "force")
    echo "📊 데이터 강제 갱신 후 백테스트 실행 중..."
    npx ts-node src/backtesting/backtest.ts backtest --force $VERBOSE_FLAG
    ;;

  "verbose")
    echo "🔍 상세 로그와 함께 백테스트 실행 중..."
    npx ts-node src/backtesting/backtest.ts backtest --verbose
    ;;
    
  *)
    echo "사용법: ./scripts/run-backtest.sh [collect|backtest|full|force|verbose] [옵션]"
    echo "  collect: 데이터만 수집 (--force 옵션 가능)"
    echo "  backtest: 기존 데이터로 백테스트 실행"
    echo "  full: 새 데이터 수집 + 백테스트"
    echo "  force: 데이터 강제 갱신 + 백테스트"
    echo "  verbose: 상세 로그와 함께 백테스트 실행"
    echo "옵션:"
    echo "  --verbose, -v: 모든 거래 로그 상세 출력"
    ;;
esac
