## raw 요구사항
- 개인적으로 사용할거기때문에 사용자 관리는 필요없음
- api 키 등은 env에서 읽어오도록 함
- 작은 서버에 올려서 24시간 돌아가게 할거임
- 거래소는 upbit 기준으로만 작업
- 매매 현황 등을 확인 할 수 있도록 telegram bot을 활용
- 수동 매매 및 시세 확인 등의 기능도 bot을 활용

### 생각나는 괜찮을거같은 기능들
- 거래량 상위코인 리스트

### 실행 방법
#### 환경설정
test.env 파일을 참고하여 prod.env 파일을 새로 만들고 필요한 값들을 채워 넣는다

```
UPBIT_ACCESS_KEY
UPBIT_SECRET_KEY
UPBIT_SERVER_URL
```

### 백 테스팅
#### 데이터만 수집 (이미 있으면 무시)
yarn backtest:collect

#### 기존 데이터로 백테스트 실행 (없으면 자동 수집)
yarn backtest:run

#### 항상 새 데이터 수집 후 백테스트 실행
yarn backtest:full

#### 데이터 강제로 갱신 후 백테스트 실행
yarn backtest:force