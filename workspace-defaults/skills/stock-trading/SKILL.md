---
name: stock-trading
description: Real-time stock data, technical indicators, and trading signals via MCP tools. Use when users ask about stock prices, market analysis, trading signals, or want to compare multiple stocks.
metadata:
  openclaw:
    emoji: "📈"
---
# Stock Trading

Access real-time stock market data, technical analysis, and trading signals.

## Available MCP Tools

### `stock_quote`
Current price, volume, change, day range, and basic company info.
```
stock_quote(ticker="AAPL")
```

### `stock_history`
Historical OHLCV data for any period and interval.
```
stock_history(ticker="SPY", period="3mo", interval="1d")
stock_history(ticker="TSLA", period="5d", interval="5m", last_n=20)
```
Periods: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, max
Intervals: 1m, 5m, 15m, 1h, 1d, 1wk, 1mo

### `stock_indicators`
Technical indicators: RSI, MACD, Bollinger Bands, VWAP, EMA, ATR, volume z-score.
```
stock_indicators(ticker="AAPL", period="5d", interval="5m")
```

### `stock_signal`
Trading signal (BUY/SELL/HOLD) with confidence score and rationale.
Uses VWAP, MACD, RSI, and volume confirmation.
```
stock_signal(ticker="MSFT", period="5d", interval="5m")
```

### `stock_stats`
Descriptive statistics, volatility, confidence intervals, sigma ranges.
```
stock_stats(ticker="SPY", period="3mo", interval="1d")
```

### `stock_screener`
Compare indicators and signals across multiple tickers at once.
```
stock_screener(tickers=["AAPL", "MSFT", "GOOGL", "AMZN", "META"])
```

## Signal Logic

The signal generator uses a rule-based system:

| Factor | BUY | SELL |
|--------|-----|------|
| Price vs VWAP | Above | Below |
| MACD vs Signal | Above | Below |
| RSI | < 30 (oversold) | > 70 (overbought) |
| Volume z-score | >= 0.75 | >= 0.75 |

- BUY: 2+ bullish factors + volume confirmation
- SELL: 2+ bearish factors + volume confirmation
- HOLD: mixed signals or low volume

Confidence scales with MACD spread magnitude and volume strength.

## Interpretation Guide

### RSI (Relative Strength Index)
- < 30: Oversold (potential bounce)
- 30-70: Neutral
- > 70: Overbought (potential pullback)

### MACD
- MACD > Signal: Bullish momentum
- MACD < Signal: Bearish momentum
- Histogram widening: Strengthening trend
- Histogram narrowing: Weakening trend

### Bollinger Bands
- Price near upper band: Potentially overbought
- Price near lower band: Potentially oversold
- Band squeeze (narrow): Low volatility, breakout likely

### VWAP
- Price > VWAP: Institutional buying pressure
- Price < VWAP: Institutional selling pressure
- Key intraday support/resistance level

### Volume Z-Score
- > 1.0: Unusually high volume (strong conviction)
- 0.5-1.0: Above average
- < 0.5: Below average (weak conviction)

## Example Prompts

- "What's the current price and signal for AAPL?"
- "Compare the tech stocks — AAPL, MSFT, GOOGL, AMZN, META"
- "Show me TSLA's technical indicators on the 15-minute chart"
- "What's the 3-month volatility and stats for SPY?"
- "Get me the last 5 days of hourly data for NVDA"

## Disclaimer

Trading signals are algorithmic indicators, not financial advice. Always consider broader market context, news, and risk management before making trading decisions.
