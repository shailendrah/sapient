#!/usr/bin/env python3
"""
Sapient Stock Trading MCP Server

Provides real-time stock data, technical indicators, and trading signals
via MCP (stdio transport). Data sourced from Yahoo Finance.

Tools:
  stock_quote      - Current price, volume, change, day range
  stock_history    - OHLCV for any period/interval
  stock_indicators - RSI, MACD, Bollinger, VWAP, EMA, ATR, volume z-score
  stock_signal     - Buy/Sell/Hold with confidence and rationale
  stock_stats      - Descriptive stats, volatility, confidence intervals
  stock_screener   - Compare indicators across multiple tickers
"""

import json
import traceback
from datetime import datetime
from dataclasses import dataclass, asdict
from typing import Optional

import numpy as np
import pandas as pd
import yfinance as yf
from scipy import stats
from mcp.server.fastmcp import FastMCP

# ── MCP Server ─────────────────────────────────────────────────────────

mcp = FastMCP("stock-trading")


# ── Data Layer ─────────────────────────────────────────────────────────

def fetch_ohlcv(
    ticker: str,
    period: str = "5d",
    interval: str = "1m",
    prepost: bool = False,
) -> pd.DataFrame:
    """Fetch OHLCV data from Yahoo Finance."""
    t = yf.Ticker(ticker)
    df = t.history(period=period, interval=interval, prepost=prepost)
    if df.empty:
        raise ValueError(f"No data returned for {ticker} (period={period}, interval={interval})")
    # Flatten MultiIndex columns if present
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [col[0] if col[1] == "" else f"{col[0]}_{col[1]}" for col in df.columns]
    return df


def get_ticker_info(ticker: str) -> dict:
    """Get basic ticker info from Yahoo Finance."""
    t = yf.Ticker(ticker)
    info = t.info
    return {
        "symbol": info.get("symbol", ticker),
        "name": info.get("shortName", ""),
        "exchange": info.get("exchange", ""),
        "currency": info.get("currency", "USD"),
        "marketCap": info.get("marketCap"),
        "sector": info.get("sector", ""),
        "industry": info.get("industry", ""),
    }


# ── Technical Indicators ───────────────────────────────────────────────

def compute_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index."""
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0.0)).rolling(window=period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def compute_ema(series: pd.Series, span: int) -> pd.Series:
    """Exponential Moving Average."""
    return series.ewm(span=span, adjust=False).mean()


def compute_macd(
    series: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """MACD, Signal line, and Histogram."""
    ema_fast = compute_ema(series, fast)
    ema_slow = compute_ema(series, slow)
    macd = ema_fast - ema_slow
    signal_line = compute_ema(macd, signal)
    histogram = macd - signal_line
    return macd, signal_line, histogram


def compute_bollinger(
    series: pd.Series, window: int = 20, num_std: float = 2.0
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Bollinger Bands: SMA, upper, lower."""
    sma = series.rolling(window=window).mean()
    std = series.rolling(window=window).std()
    upper = sma + num_std * std
    lower = sma - num_std * std
    return sma, upper, lower


def compute_vwap(df: pd.DataFrame) -> pd.Series:
    """Volume-Weighted Average Price (session-aware)."""
    typical_price = (df["High"] + df["Low"] + df["Close"]) / 3
    cumulative_tp_vol = (typical_price * df["Volume"]).cumsum()
    cumulative_vol = df["Volume"].cumsum()
    return cumulative_tp_vol / cumulative_vol.replace(0, np.nan)


def compute_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Average True Range."""
    high_low = df["High"] - df["Low"]
    high_close = (df["High"] - df["Close"].shift(1)).abs()
    low_close = (df["Low"] - df["Close"].shift(1)).abs()
    true_range = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    return true_range.rolling(window=period).mean()


def compute_volume_zscore(df: pd.DataFrame, window: int = 60) -> pd.Series:
    """Rolling volume z-score."""
    vol_mean = df["Volume"].rolling(window=window).mean()
    vol_std = df["Volume"].rolling(window=window).std()
    return (df["Volume"] - vol_mean) / vol_std.replace(0, np.nan)


def compute_all_indicators(df: pd.DataFrame) -> dict:
    """Compute all indicators and return the latest values."""
    close = df["Close"]
    latest = df.iloc[-1]

    rsi = compute_rsi(close)
    macd, signal, histogram = compute_macd(close)
    sma20, bb_upper, bb_lower = compute_bollinger(close)
    vwap = compute_vwap(df)
    atr = compute_atr(df)
    ema9 = compute_ema(close, 9)
    ema21 = compute_ema(close, 21)
    vol_z = compute_volume_zscore(df)

    return {
        "price": round(float(latest["Close"]), 4),
        "volume": int(latest["Volume"]),
        "rsi_14": round(float(rsi.iloc[-1]), 2) if not pd.isna(rsi.iloc[-1]) else None,
        "macd": round(float(macd.iloc[-1]), 4) if not pd.isna(macd.iloc[-1]) else None,
        "macd_signal": round(float(signal.iloc[-1]), 4) if not pd.isna(signal.iloc[-1]) else None,
        "macd_histogram": round(float(histogram.iloc[-1]), 4) if not pd.isna(histogram.iloc[-1]) else None,
        "bollinger_upper": round(float(bb_upper.iloc[-1]), 4) if not pd.isna(bb_upper.iloc[-1]) else None,
        "bollinger_sma20": round(float(sma20.iloc[-1]), 4) if not pd.isna(sma20.iloc[-1]) else None,
        "bollinger_lower": round(float(bb_lower.iloc[-1]), 4) if not pd.isna(bb_lower.iloc[-1]) else None,
        "vwap": round(float(vwap.iloc[-1]), 4) if not pd.isna(vwap.iloc[-1]) else None,
        "atr_14": round(float(atr.iloc[-1]), 4) if not pd.isna(atr.iloc[-1]) else None,
        "ema_9": round(float(ema9.iloc[-1]), 4) if not pd.isna(ema9.iloc[-1]) else None,
        "ema_21": round(float(ema21.iloc[-1]), 4) if not pd.isna(ema21.iloc[-1]) else None,
        "volume_zscore": round(float(vol_z.iloc[-1]), 2) if not pd.isna(vol_z.iloc[-1]) else None,
        "daily_high": round(float(latest["High"]), 4),
        "daily_low": round(float(latest["Low"]), 4),
        "price_change": round(float(latest["Close"] - df["Close"].iloc[-2]), 4) if len(df) > 1 else 0,
        "price_change_pct": round(float((latest["Close"] / df["Close"].iloc[-2] - 1) * 100), 4) if len(df) > 1 else 0,
    }


# ── Signal Generation ──────────────────────────────────────────────────

@dataclass
class Signal:
    action: str  # "BUY", "SELL", "HOLD"
    confidence: float  # 0-100
    rationale: str
    indicators: dict


def generate_signal(df: pd.DataFrame, ticker: str) -> Signal:
    """
    Rule-based signal generation.
    Replicates logic from base_intraday_signals.py.
    """
    indicators = compute_all_indicators(df)

    price = indicators["price"]
    vwap = indicators["vwap"]
    macd = indicators["macd"]
    macd_signal = indicators["macd_signal"]
    rsi = indicators["rsi_14"]
    vol_z = indicators["volume_zscore"]

    if any(v is None for v in [vwap, macd, macd_signal, rsi, vol_z]):
        return Signal("HOLD", 0, "Insufficient data for signal generation", indicators)

    reasons = []
    bull_points = 0
    bear_points = 0

    # Price vs VWAP
    if price > vwap:
        bull_points += 1
        reasons.append(f"Price ({price:.2f}) above VWAP ({vwap:.2f})")
    else:
        bear_points += 1
        reasons.append(f"Price ({price:.2f}) below VWAP ({vwap:.2f})")

    # MACD
    if macd > macd_signal:
        bull_points += 1
        reasons.append(f"MACD ({macd:.4f}) above signal ({macd_signal:.4f})")
    else:
        bear_points += 1
        reasons.append(f"MACD ({macd:.4f}) below signal ({macd_signal:.4f})")

    # RSI
    if rsi > 70:
        bear_points += 1
        reasons.append(f"RSI overbought ({rsi:.1f})")
    elif rsi < 30:
        bull_points += 1
        reasons.append(f"RSI oversold ({rsi:.1f})")
    else:
        reasons.append(f"RSI neutral ({rsi:.1f})")

    # Volume confirmation
    high_volume = vol_z >= 0.75
    if high_volume:
        reasons.append(f"Volume confirmed (z={vol_z:.2f})")
    else:
        reasons.append(f"Low volume (z={vol_z:.2f})")

    # Decision
    if bull_points >= 2 and high_volume:
        action = "BUY"
        confidence = min(40 + bull_points * 15 + abs(macd - macd_signal) * 1000, 95)
    elif bear_points >= 2 and high_volume:
        action = "SELL"
        confidence = min(40 + bear_points * 15 + abs(macd - macd_signal) * 1000, 95)
    else:
        action = "HOLD"
        confidence = max(30, 60 - abs(bull_points - bear_points) * 10)

    return Signal(
        action=action,
        confidence=round(confidence, 1),
        rationale="; ".join(reasons),
        indicators=indicators,
    )


# ── Statistics ─────────────────────────────────────────────────────────

def compute_stats(df: pd.DataFrame) -> dict:
    """Descriptive statistics, volatility, confidence intervals."""
    close = df["Close"]
    log_returns = np.log(close / close.shift(1)).dropna()

    n = len(close)
    mean_price = float(close.mean())
    std_price = float(close.std())
    sem = std_price / np.sqrt(n)

    # 95% confidence interval
    ci_95 = stats.t.interval(0.95, df=n - 1, loc=mean_price, scale=sem)

    # Annualized volatility (assume 252 trading days)
    daily_vol = float(log_returns.std())
    annual_vol = daily_vol * np.sqrt(252)

    return {
        "count": n,
        "mean": round(mean_price, 4),
        "std": round(std_price, 4),
        "min": round(float(close.min()), 4),
        "max": round(float(close.max()), 4),
        "median": round(float(close.median()), 4),
        "latest": round(float(close.iloc[-1]), 4),
        "daily_volatility": round(daily_vol, 6),
        "annualized_volatility": round(annual_vol, 4),
        "confidence_interval_95": [round(ci_95[0], 4), round(ci_95[1], 4)],
        "sigma_1_range": [
            round(mean_price - std_price, 4),
            round(mean_price + std_price, 4),
        ],
        "sigma_2_range": [
            round(mean_price - 2 * std_price, 4),
            round(mean_price + 2 * std_price, 4),
        ],
    }


# ── MCP Tool Definitions ──────────────────────────────────────────────

@mcp.tool()
def stock_quote(ticker: str) -> str:
    """Get current stock quote: price, volume, change, day range, and basic info."""
    try:
        df = fetch_ohlcv(ticker, period="1d", interval="1m")
        info = get_ticker_info(ticker)
        latest = df.iloc[-1]
        first = df.iloc[0]

        result = {
            **info,
            "price": round(float(latest["Close"]), 4),
            "open": round(float(first["Open"]), 4),
            "high": round(float(df["High"].max()), 4),
            "low": round(float(df["Low"].min()), 4),
            "volume": int(df["Volume"].sum()),
            "change": round(float(latest["Close"] - first["Open"]), 4),
            "change_pct": round(float((latest["Close"] / first["Open"] - 1) * 100), 2),
            "timestamp": datetime.now().isoformat(),
        }
        return json.dumps(result, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e), "traceback": traceback.format_exc()})


@mcp.tool()
def stock_history(
    ticker: str,
    period: str = "1mo",
    interval: str = "1d",
    prepost: bool = False,
    last_n: Optional[int] = None,
) -> str:
    """
    Get historical OHLCV data.

    Args:
        ticker: Stock symbol (e.g., "AAPL", "SPY")
        period: Data period (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, max)
        interval: Bar interval (1m, 5m, 15m, 1h, 1d, 1wk, 1mo)
        prepost: Include pre/post market data
        last_n: Only return the last N rows
    """
    try:
        df = fetch_ohlcv(ticker, period=period, interval=interval, prepost=prepost)
        if last_n:
            df = df.tail(last_n)

        records = []
        for ts, row in df.iterrows():
            records.append({
                "timestamp": str(ts),
                "open": round(float(row["Open"]), 4),
                "high": round(float(row["High"]), 4),
                "low": round(float(row["Low"]), 4),
                "close": round(float(row["Close"]), 4),
                "volume": int(row["Volume"]),
            })

        return json.dumps({
            "ticker": ticker,
            "period": period,
            "interval": interval,
            "count": len(records),
            "data": records,
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def stock_indicators(
    ticker: str,
    period: str = "5d",
    interval: str = "5m",
) -> str:
    """
    Compute technical indicators: RSI, MACD, Bollinger Bands, VWAP, EMA, ATR, volume z-score.

    Args:
        ticker: Stock symbol
        period: Data period for calculation (5d recommended for intraday)
        interval: Bar interval (1m, 5m, 15m, 1h, 1d)
    """
    try:
        df = fetch_ohlcv(ticker, period=period, interval=interval)
        indicators = compute_all_indicators(df)
        return json.dumps({"ticker": ticker, "interval": interval, **indicators}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def stock_signal(
    ticker: str,
    period: str = "5d",
    interval: str = "5m",
) -> str:
    """
    Generate a trading signal (BUY/SELL/HOLD) with confidence score and rationale.
    Uses VWAP, MACD, RSI, and volume z-score.

    Args:
        ticker: Stock symbol
        period: Data period
        interval: Bar interval
    """
    try:
        df = fetch_ohlcv(ticker, period=period, interval=interval)
        sig = generate_signal(df, ticker)
        return json.dumps({
            "ticker": ticker,
            "signal": sig.action,
            "confidence": sig.confidence,
            "rationale": sig.rationale,
            "indicators": sig.indicators,
            "timestamp": datetime.now().isoformat(),
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def stock_stats(
    ticker: str,
    period: str = "3mo",
    interval: str = "1d",
) -> str:
    """
    Compute descriptive statistics, volatility, and confidence intervals.

    Args:
        ticker: Stock symbol
        period: Data period (3mo, 6mo, 1y recommended)
        interval: Bar interval (1d recommended for stats)
    """
    try:
        df = fetch_ohlcv(ticker, period=period, interval=interval)
        result = compute_stats(df)
        return json.dumps({"ticker": ticker, "period": period, **result}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def stock_screener(
    tickers: list[str],
    period: str = "5d",
    interval: str = "5m",
) -> str:
    """
    Compare indicators and signals across multiple tickers.

    Args:
        tickers: List of stock symbols (e.g., ["AAPL", "MSFT", "GOOGL"])
        period: Data period
        interval: Bar interval
    """
    try:
        results = []
        for ticker in tickers:
            try:
                df = fetch_ohlcv(ticker, period=period, interval=interval)
                sig = generate_signal(df, ticker)
                results.append({
                    "ticker": ticker,
                    "price": sig.indicators["price"],
                    "signal": sig.action,
                    "confidence": sig.confidence,
                    "rsi": sig.indicators.get("rsi_14"),
                    "macd_histogram": sig.indicators.get("macd_histogram"),
                    "volume_zscore": sig.indicators.get("volume_zscore"),
                    "price_change_pct": sig.indicators.get("price_change_pct"),
                })
            except Exception as e:
                results.append({"ticker": ticker, "error": str(e)})

        return json.dumps({"screener": results, "count": len(results)}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


# ── Entry Point ────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run(transport="stdio")
