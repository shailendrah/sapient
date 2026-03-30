---
name: analytic-sql
description: Oracle analytic SQL patterns — window functions, pivots, time-series, statistical analysis
emoji: "📊"
---
# Oracle Analytic SQL

Advanced analytical query patterns for Oracle via the SQLcl MCP server.

## Window Functions

```sql
-- Ranking
SELECT department, employee, salary,
  RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS rank,
  DENSE_RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dense_rank
FROM employees

-- Running totals
SELECT order_date, amount,
  SUM(amount) OVER (ORDER BY order_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total
FROM orders

-- Period comparison (LAG/LEAD)
SELECT month, revenue,
  LAG(revenue, 1) OVER (ORDER BY month) AS prev_month,
  revenue - LAG(revenue, 1) OVER (ORDER BY month) AS month_over_month
FROM monthly_revenue
```

## Moving Averages

```sql
SELECT trade_date, close_price,
  AVG(close_price) OVER (ORDER BY trade_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS ma_7,
  AVG(close_price) OVER (ORDER BY trade_date ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) AS ma_30
FROM stock_prices
```

## Pivoting

```sql
-- Rows to columns
SELECT * FROM (
  SELECT department, quarter, revenue FROM quarterly_revenue
)
PIVOT (
  SUM(revenue) FOR quarter IN ('Q1' AS q1, 'Q2' AS q2, 'Q3' AS q3, 'Q4' AS q4)
)
```

## Grouping Sets

```sql
-- Multi-dimensional aggregation
SELECT region, product, SUM(sales) AS total_sales
FROM sales_data
GROUP BY GROUPING SETS (
  (region, product),  -- by region and product
  (region),           -- subtotal by region
  (product),          -- subtotal by product
  ()                  -- grand total
)
```

## Statistical Functions

```sql
-- Percentiles
SELECT department,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY salary) AS median_salary,
  PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY salary) AS p90_salary
FROM employees
GROUP BY department

-- Correlation
SELECT CORR(advertising_spend, revenue) AS correlation
FROM marketing_data
```

## Vector Similarity with Analytics

```sql
-- Top-K similar documents with ranking
SELECT content, source_name,
  VECTOR_DISTANCE(embedding, TO_VECTOR(:qvec), COSINE) AS distance,
  ROW_NUMBER() OVER (PARTITION BY source_name ORDER BY VECTOR_DISTANCE(embedding, TO_VECTOR(:qvec), COSINE)) AS rank_in_source
FROM documents
ORDER BY distance
FETCH FIRST 10 ROWS ONLY
```

## Guidelines

- Use CTEs (WITH clause) to keep complex queries readable
- Always explain what the analytic query does before showing results
- Use TO_CHAR for formatted numeric output (currency, percentages, dates)
- For large aggregations, check the query plan first
- Combine vector similarity with analytics when searching and aggregating results
