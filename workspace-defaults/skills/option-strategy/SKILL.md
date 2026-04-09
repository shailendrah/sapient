---
name: option-strategy
description: Options strategy design, analysis, and management. Use when users discuss options positions, ask for strategy construction, need adjustment advice, or want P&L and break-even analysis. Covers iron condors, credit spreads, butterflies, diagonals, and conversions. Uses sigma-based strike selection and active management principles.
metadata:
  openclaw:
    emoji: "🎯"
---
# Options Strategy

Design, analyze, adjust, and manage options strategies. This skill covers multi-leg options positions with a focus on premium selling, sigma-based strike selection, and active management.

## When to Use

- User asks to design an options strategy on a ticker
- User has an existing position and wants adjustment advice
- User wants P&L, break-even, or risk analysis
- User asks about rolling, converting, or hedging positions
- User wants to decompose a multi-leg position into net exposure

## When NOT to Use

- Pure stock (non-options) questions → use stock-trading tools
- Options data feeds or chains → not available, work with user-provided strikes/premiums
- Backtesting options strategies → out of scope

## Data Sources

- **Underlying price and volatility:** use `stock_quote` and `stock_indicators` MCP tools
- **Options chain (live):** use `options_chain` to get real bid/ask/IV for any expiration
- **Sigma strikes:** use `options_sigma_strikes` to calculate strike levels for any DTE
- **Expirations:** use `options_expirations` to list available expiry dates
- **Strategy P&L:** use `options_strategy_analyzer` to compute P&L curve, break-evens, max profit/loss
- **User-provided data:** premiums and positions from the user's prompt supplement the live data

## Trading Style (Default Approach)

This skill follows a neutral/premium-selling methodology:

### Core Principles
- **Sell premium, don't buy it** — theta is your edge
- **Sigma-based strike selection** — use standard deviations from current price to set strikes
  - Conservative: 2σ out (high probability, lower premium)
  - Standard: 1.5σ out (balanced)
  - Aggressive: 1σ out (higher premium, more risk)
- **Active management** — roll early, don't wait for max pain or expiry
- **Assignment is a tool** — being assigned is part of the strategy, not a failure
- **Decompose everything** — always understand net exposure of the full position

### Sigma Calculation

To calculate strike distances:

```
σ_daily = annualized_volatility / √252
σ_period = σ_daily × √(days_to_expiry)

Upper strike = current_price × (1 + n × σ_period)
Lower strike = current_price × (1 - n × σ_period)
```

Use `stock_stats` tool to get annualized volatility, then compute σ for the expiry period.

**Example:** SPY at $550, annualized vol 18%, 7 DTE
```
σ_daily = 0.18 / √252 = 0.01134
σ_7d = 0.01134 × √7 = 0.03
1σ range: 550 × (1 ± 0.03) = 533.50 – 566.50
2σ range: 550 × (1 ± 0.06) = 517.00 – 583.00
```

## Strategy Catalog

### 1. Iron Condor (Neutral)

**Structure:** Short OTM put spread + Short OTM call spread
```
Long  lower put  (wing)
Short upper put  (body)    ← collect premium
Short lower call (body)    ← collect premium
Long  upper call (wing)
```

**When to use:** Range-bound expectation, high IV environment
**Max profit:** Net credit received
**Max loss:** Width of wider spread − net credit
**Break-even:** Short put − credit / Short call + credit

**Strike selection:**
- Body strikes: 1–2σ from current price
- Wing width: $5–$10 on SPY/QQQ, adjust for stock price

### 2. Credit Spread — Put (Bullish)

**Structure:** Short put + Long put (lower strike)
```
Short higher put  ← collect premium
Long  lower put   ← define risk
```

**Max profit:** Credit received
**Max loss:** Spread width − credit
**Break-even:** Short strike − credit

### 3. Credit Spread — Call (Bearish)

**Structure:** Short call + Long call (higher strike)
```
Short lower call  ← collect premium
Long  higher call ← define risk
```

**Max profit:** Credit received
**Max loss:** Spread width − credit
**Break-even:** Short strike + credit

### 4. Iron Butterfly (Neutral, Aggressive)

**Structure:** ATM short straddle + OTM long strangle
```
Long  OTM put
Short ATM put   ← same strike
Short ATM call  ← same strike
Long  OTM call
```

**When to use:** Very high IV, expect pin at strike
**Max profit:** Net credit (larger than condor)
**Max loss:** Wing width − credit

### 5. Diagonal Spread

**Structure:** Different strikes AND different expirations
```
Short near-term option (higher theta)
Long  further-term option (less decay)
```

**When to use:** Harvesting theta while maintaining directional exposure
**Key:** Short leg decays faster than long leg

### 6. Double Diagonal

**Structure:** Put diagonal + Call diagonal
```
Short near-expiry OTM put  + Long later-expiry OTM put
Short near-expiry OTM call + Long later-expiry OTM call
```

**When to use:** Range-bound with calendar spread benefit
**Advantage:** If shorts expire worthless, longs retain value for next cycle

## Position Decomposition

Always decompose multi-leg positions to understand true exposure:

| Combined Position | Net Equivalent |
|------------------|----------------|
| Short put spread, close long leg | Naked short put + disaster hedge if needed |
| Short call spread, close long leg | Naked short call (very risky without hedge) |
| Iron condor, one side tested | Becomes directional spread on tested side |
| Short put + long stock | Covered call equivalent |
| Long call + short stock | Synthetic long put |
| Short put assigned + sell call | Covered call (wheel strategy) |

### Decomposition Process

For any position:
1. List all legs with their deltas
2. Sum the deltas → net directional exposure
3. Identify the net theta (are you earning or paying time decay?)
4. Identify the net vega (are you long or short volatility?)
5. State the synthetic equivalent in plain terms

## Adjustment Playbook

### When to Roll

| Condition | Action |
|-----------|--------|
| Short strike tested (price within 0.5σ) | Roll out in time for credit |
| 50%+ profit captured with >7 DTE left | Close for profit, redeploy |
| IV crush after event (earnings) | Close — theta edge gone |
| One side of condor is worthless | Close the winner, manage the loser |

### How to Roll

1. **Roll out (time):** Same strikes, later expiration → collect additional credit
2. **Roll out and down/up:** Later expiration + move strikes with the trend → adjust for directional shift
3. **Roll to wider spread:** If more credit needed for the roll to be worth it

**Roll rules:**
- Only roll for a net credit (or very small debit if defensive)
- Don't roll more than 2x — if you've rolled twice and it's still losing, take the loss
- Rolling is NOT free — each roll extends your time at risk

### When to Convert

| From | To | When |
|------|-----|------|
| Iron condor | Credit spread | One side clearly winning, take off the dead side |
| Put credit spread | Naked short put | You want more credit and accept assignment risk |
| Naked short put (assigned) | Covered call | Wheel strategy continuation |
| Iron condor | Iron butterfly | Want to collect more premium, tighten range |

### When to Hedge

- Add a disaster hedge (far OTM long) when going naked
- Cost: small premium, buys sleep at night
- Typical: 5–10σ out, costs pennies, protects against black swans

## P&L Analysis

### Break-Even Calculations

**Credit spread:**
```
Break-even = Short strike ∓ credit received
  Put spread: short strike − credit
  Call spread: short strike + credit
```

**Iron condor:**
```
Lower break-even = Short put strike − total credit
Upper break-even = Short call strike + total credit
```

**After rolling:**
```
New break-even = Original strike ∓ (original credit + roll credit)
```
Each roll moves the break-even in your favor by the additional credit collected.

### Risk Envelope

For any position, calculate:
```
Max profit = Total credit received
Max loss = Max(spread widths) − total credit
Risk/reward ratio = Max loss / Max profit
Probability of profit ≈ 1 − (credit / spread width)

Capital at risk = Max loss × number of contracts × multiplier (usually 100)
```

### P&L at Expiration

For each leg, compute intrinsic value at a given underlying price:
```
Call intrinsic = max(0, underlying − strike)
Put intrinsic = max(0, strike − underlying)

For short legs: you pay the intrinsic
For long legs: you receive the intrinsic

Net P&L = Total credit received − net intrinsic paid
```

Scan a range of underlying prices (e.g., ±3σ) to build the P&L curve.

## Greeks Quick Reference

| Greek | Premium Seller Wants | Meaning |
|-------|---------------------|---------|
| Delta | Near zero (neutral) | Directional exposure |
| Theta | Positive (high) | Time decay earnings per day |
| Vega | Negative | Short volatility — profit when IV drops |
| Gamma | Near zero | Stable delta — don't want big swings |

**Position-level Greeks:**
- Sum deltas across all legs for net direction
- Net theta tells you daily earning/cost
- Net vega tells you IV exposure
- Watch gamma as expiry approaches — it explodes near ATM

## Example Workflow

When a user says "Design me a weekly iron condor on SPY":

1. Get sigma strikes and available expirations:
   ```
   options_sigma_strikes(ticker="SPY", dte=7, sigma_levels=[1.0, 1.5, 2.0])
   options_expirations(ticker="SPY")
   ```

2. Pick the nearest weekly expiration and 1.5σ strikes from the result.

3. Get live premiums for the chosen strikes:
   ```
   options_chain(ticker="SPY", expiration="2026-04-17", option_type="both", near_money=30)
   ```

4. Build the strategy with actual bid/ask prices and analyze:
   ```
   options_strategy_analyzer(
     ticker="SPY",
     expiration="2026-04-17",
     legs=[
       {"type": "put", "strike": 653, "action": "sell"},
       {"type": "put", "strike": 648, "action": "buy"},
       {"type": "call", "strike": 705, "action": "sell"},
       {"type": "call", "strike": 710, "action": "buy"}
     ]
   )
   ```

5. Present the complete analysis:
   - All four legs with live premiums
   - Total credit, max profit, max loss
   - Break-even levels and profitable range
   - Risk/reward ratio
   - P&L curve at key price points
   - Adjustment plan: when to roll, when to close

## Disclaimer

Options trading involves substantial risk. Strategy suggestions are analytical tools, not financial advice. Always verify with your broker and consider your risk tolerance before trading.
