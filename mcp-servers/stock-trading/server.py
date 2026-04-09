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


# ── Options Tools ──────────────────────────────────────────────────────

@mcp.tool()
def options_expirations(ticker: str) -> str:
    """
    Get available options expiration dates for a ticker.

    Args:
        ticker: Stock symbol (e.g., "SPY", "AAPL")
    """
    try:
        t = yf.Ticker(ticker)
        expirations = list(t.options)
        return json.dumps({
            "ticker": ticker,
            "expirations": expirations,
            "count": len(expirations),
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


def _format_chain(df: pd.DataFrame) -> list[dict]:
    """Format an options chain DataFrame into clean records."""
    records = []
    for _, row in df.iterrows():
        rec = {
            "strike": float(row["strike"]),
            "lastPrice": float(row["lastPrice"]),
            "bid": float(row["bid"]),
            "ask": float(row["ask"]),
            "volume": int(row["volume"]) if pd.notna(row["volume"]) else 0,
            "openInterest": int(row["openInterest"]) if pd.notna(row["openInterest"]) else 0,
            "impliedVolatility": round(float(row["impliedVolatility"]), 4) if pd.notna(row["impliedVolatility"]) else None,
            "inTheMoney": bool(row["inTheMoney"]),
        }
        if "change" in row and pd.notna(row["change"]):
            rec["change"] = round(float(row["change"]), 4)
        if "percentChange" in row and pd.notna(row["percentChange"]):
            rec["percentChange"] = round(float(row["percentChange"]), 4)
        records.append(rec)
    return records


@mcp.tool()
def options_chain(
    ticker: str,
    expiration: Optional[str] = None,
    option_type: str = "both",
    min_volume: int = 0,
    near_money: Optional[int] = None,
) -> str:
    """
    Get options chain (calls and/or puts) for a ticker and expiration.

    Args:
        ticker: Stock symbol
        expiration: Expiration date (YYYY-MM-DD). If omitted, uses the nearest expiration.
        option_type: "calls", "puts", or "both"
        min_volume: Filter out options with volume below this threshold
        near_money: If set, only return N strikes above and below current price
    """
    try:
        t = yf.Ticker(ticker)
        expirations = t.options
        if not expirations:
            return json.dumps({"error": f"No options available for {ticker}"})

        exp = expiration if expiration and expiration in expirations else expirations[0]
        chain = t.option_chain(exp)
        current_price = float(t.history(period="1d")["Close"].iloc[-1])

        result = {
            "ticker": ticker,
            "expiration": exp,
            "underlyingPrice": round(current_price, 4),
        }

        if option_type in ("calls", "both"):
            calls = chain.calls
            if min_volume > 0:
                calls = calls[calls["volume"] >= min_volume]
            if near_money:
                calls = calls[
                    (calls["strike"] >= current_price - near_money)
                    & (calls["strike"] <= current_price + near_money)
                ]
            result["calls"] = _format_chain(calls)
            result["callCount"] = len(result["calls"])

        if option_type in ("puts", "both"):
            puts = chain.puts
            if min_volume > 0:
                puts = puts[puts["volume"] >= min_volume]
            if near_money:
                puts = puts[
                    (puts["strike"] >= current_price - near_money)
                    & (puts["strike"] <= current_price + near_money)
                ]
            result["puts"] = _format_chain(puts)
            result["putCount"] = len(result["puts"])

        return json.dumps(result, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@mcp.tool()
def options_strategy_analyzer(
    ticker: str,
    expiration: str,
    legs: list[dict],
) -> str:
    """
    Analyze a multi-leg options strategy. Calculates P&L at expiration,
    break-even points, max profit, max loss, and Greeks summary.

    Args:
        ticker: Stock symbol
        expiration: Expiration date (YYYY-MM-DD)
        legs: List of leg definitions, each with:
            - type: "call" or "put"
            - strike: Strike price
            - action: "buy" or "sell"
            - quantity: Number of contracts (default 1)
            - premium: Premium per share (if known, otherwise fetched)

    Example legs:
        [
            {"type": "put", "strike": 540, "action": "sell", "premium": 2.50},
            {"type": "put", "strike": 535, "action": "buy", "premium": 1.30},
            {"type": "call", "strike": 570, "action": "sell", "premium": 2.10},
            {"type": "call", "strike": 575, "action": "buy", "premium": 0.90}
        ]
    """
    try:
        t = yf.Ticker(ticker)
        current_price = float(t.history(period="1d")["Close"].iloc[-1])

        # Fetch chain for premium lookup if needed
        chain = None
        try:
            chain = t.option_chain(expiration)
        except Exception:
            pass

        # Process legs
        processed_legs = []
        total_credit = 0.0

        for leg in legs:
            strike = float(leg["strike"])
            opt_type = leg["type"].lower()
            action = leg["action"].lower()
            qty = int(leg.get("quantity", 1))
            premium = leg.get("premium")

            # Try to fetch premium from chain if not provided
            if premium is None and chain is not None:
                chain_df = chain.calls if opt_type == "call" else chain.puts
                match = chain_df[chain_df["strike"] == strike]
                if not match.empty:
                    mid = (float(match.iloc[0]["bid"]) + float(match.iloc[0]["ask"])) / 2
                    premium = round(mid, 2)
                else:
                    premium = 0.0

            multiplier = 1 if action == "sell" else -1
            total_credit += premium * multiplier * qty

            processed_legs.append({
                "type": opt_type,
                "strike": strike,
                "action": action,
                "quantity": qty,
                "premium": premium,
            })

        # Calculate P&L across a range of prices
        all_strikes = [leg["strike"] for leg in processed_legs]
        price_min = min(all_strikes) - 20
        price_max = max(all_strikes) + 20
        prices = np.arange(price_min, price_max + 0.5, 0.50)

        pnl_curve = []
        break_evens = []
        prev_pnl = None

        for px in prices:
            pnl = total_credit
            for leg in processed_legs:
                if leg["type"] == "call":
                    intrinsic = max(0, px - leg["strike"])
                else:
                    intrinsic = max(0, leg["strike"] - px)

                if leg["action"] == "sell":
                    pnl -= intrinsic * leg["quantity"]
                else:
                    pnl += intrinsic * leg["quantity"]

            pnl_curve.append({"price": round(float(px), 2), "pnl": round(float(pnl), 4)})

            # Detect break-even crossings
            if prev_pnl is not None and prev_pnl * pnl < 0:
                break_evens.append(round(float(px), 2))
            prev_pnl = pnl

        pnl_values = [p["pnl"] for p in pnl_curve]
        max_profit = max(pnl_values)
        max_loss = min(pnl_values)

        # Net delta estimate (simple: sum of directional exposure)
        net_delta = 0.0
        for leg in processed_legs:
            d = 0.5  # rough ATM delta
            if leg["type"] == "call":
                if leg["strike"] > current_price:
                    d = max(0.1, 0.5 - (leg["strike"] - current_price) / current_price * 5)
                else:
                    d = min(0.9, 0.5 + (current_price - leg["strike"]) / current_price * 5)
            else:
                if leg["strike"] < current_price:
                    d = -max(0.1, 0.5 - (current_price - leg["strike"]) / current_price * 5)
                else:
                    d = -min(0.9, 0.5 + (leg["strike"] - current_price) / current_price * 5)

            if leg["action"] == "sell":
                d = -d
            net_delta += d * leg["quantity"]

        result = {
            "ticker": ticker,
            "underlyingPrice": round(current_price, 4),
            "expiration": expiration,
            "legs": processed_legs,
            "totalCredit": round(total_credit, 4),
            "maxProfit": round(max_profit, 4),
            "maxLoss": round(max_loss, 4),
            "breakEvens": break_evens,
            "riskRewardRatio": round(abs(max_loss / max_profit), 2) if max_profit != 0 else None,
            "netDeltaEstimate": round(net_delta, 3),
            "profitableRange": {
                "low": min([p["price"] for p in pnl_curve if p["pnl"] > 0], default=None),
                "high": max([p["price"] for p in pnl_curve if p["pnl"] > 0], default=None),
            },
            "pnlAtCurrentPrice": round(float(total_credit), 4),
            "pnlCurveSample": [p for p in pnl_curve if p["price"] % 5 < 0.5],
        }

        return json.dumps(result, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e), "traceback": traceback.format_exc()})


@mcp.tool()
def options_sigma_strikes(
    ticker: str,
    dte: int = 7,
    sigma_levels: list[float] = [1.0, 1.5, 2.0],
) -> str:
    """
    Calculate strike prices at various sigma levels for a given ticker and DTE.
    Uses historical volatility to compute expected move.

    Args:
        ticker: Stock symbol
        dte: Days to expiration
        sigma_levels: List of sigma multipliers (e.g., [1.0, 1.5, 2.0])
    """
    try:
        df = fetch_ohlcv(ticker, period="3mo", interval="1d")
        close = df["Close"]
        current_price = float(close.iloc[-1])

        # Annualized volatility from log returns
        log_returns = np.log(close / close.shift(1)).dropna()
        daily_vol = float(log_returns.std())
        annual_vol = daily_vol * np.sqrt(252)
        period_vol = daily_vol * np.sqrt(dte)

        strikes = {}
        for sigma in sigma_levels:
            move = current_price * period_vol * sigma
            strikes[f"{sigma}σ"] = {
                "callStrike": round(current_price + move, 2),
                "putStrike": round(current_price - move, 2),
                "expectedMove": round(move, 2),
                "expectedMovePct": round(move / current_price * 100, 2),
            }

        return json.dumps({
            "ticker": ticker,
            "currentPrice": round(current_price, 4),
            "dte": dte,
            "annualizedVolatility": round(annual_vol, 4),
            "dailyVolatility": round(daily_vol, 6),
            "periodVolatility": round(period_vol, 6),
            "strikes": strikes,
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


# ── Entry Point ────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run(transport="stdio")
