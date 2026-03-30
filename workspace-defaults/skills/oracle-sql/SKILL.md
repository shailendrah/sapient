---
name: oracle-sql
description: Oracle database access via SQLcl MCP server
emoji: "🗄️"
---
# Oracle SQL via SQLcl MCP Server

Oracle database access is provided through the SQLcl MCP server. Before running queries, connect using `run-sqlcl` with `connect $ORACLE_CONN`.

## Available MCP Tools

- **`run-sql`** — Execute SQL queries. Returns CSV-formatted results. Supports async execution for long-running queries.
- **`run-sqlcl`** — Execute SQLcl CLI commands (DESC, SET, formatting, etc.).
- **`schema-information`** — Get metadata about the connected schema.

## Usage Examples

### Run a query
Use the `run-sql` tool with `sql` parameter:
```
SELECT table_name FROM user_tables ORDER BY table_name
```

### Describe a table
Use `run-sqlcl` with `sqlcl` parameter:
```
DESC my_table
```

### Discover vector columns
```sql
SELECT table_name, column_name FROM user_tab_columns WHERE data_type = 'VECTOR'
```

### Vector similarity search (any table with a VECTOR column)
```sql
SELECT id, content, VECTOR_DISTANCE(vec_col, :query_vec, COSINE) AS similarity
FROM my_table
ORDER BY VECTOR_DISTANCE(vec_col, :query_vec, COSINE)
FETCH FIRST 5 ROWS ONLY
```

## Guidelines

- Default to read-only operations
- Use `FETCH FIRST n ROWS ONLY` to limit large result sets
- Start exploration with `schema-information` tool
- For performance analysis, use `EXPLAIN PLAN FOR` followed by `SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY)`
- Never run DDL or DML unless explicitly asked
