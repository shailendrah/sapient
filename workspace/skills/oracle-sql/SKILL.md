---
name: oracle-sql
description: Oracle database access via SQLcl
emoji: "🗄️"
requires:
  bins: ["sql"]
---
# Oracle SQL via SQLcl

Use `sql` (SQLcl) to interact with Oracle databases.

## Connection

Connect using environment variables or secrets:
```bash
sql -s $ORACLE_USER/$ORACLE_PASSWORD@$ORACLE_DSN
```

Or with a connect string:
```bash
sql -s user/pass@host:port/service_name
```

## Running Queries

Always use `-s` (silent) mode and `SET` formatting for clean output:
```bash
sql -s user/pass@dsn <<'SQL'
SET PAGESIZE 50000
SET LINESIZE 200
SET FEEDBACK OFF
SET HEADING ON
SET COLSEP '|'

SELECT table_name FROM user_tables ORDER BY table_name;
SQL
```

## Guidelines

- Always use `SET FEEDBACK OFF` to suppress row count noise
- Use `SET PAGESIZE 50000` to avoid page breaks in output
- Use `SET LINESIZE 200` or wider for wide result sets
- For large result sets, use `FETCH FIRST n ROWS ONLY` or `ROWNUM`
- Use `EXPLAIN PLAN FOR` then `SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY)` for execution plans
- Never run DDL (CREATE, ALTER, DROP) or DML (INSERT, UPDATE, DELETE) unless explicitly asked
- Prefer read-only operations by default
- Use bind variables or literals safely — never interpolate untrusted input into SQL
