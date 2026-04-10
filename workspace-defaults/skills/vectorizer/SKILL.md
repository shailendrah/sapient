---
name: vectorizer
description: Vectorize database tables for similarity search. Inspects table schema and sample data, selects optimal columns, adds a VECTOR column, generates embeddings, and registers the table in KNOWLEDGE.md. Use when users want to enable vector/semantic search on a database table.
metadata:
  openclaw:
    emoji: "🧬"
---
# Vectorizer

Automatically vectorize database tables for similarity search. The agent inspects the table, decides which columns to embed, generates vectors, and registers the result for future RAG queries.

## When to Use

- User says "vectorize this table" or "I want to do similarity search on TABLE"
- User wants to add a table to the knowledge base for RAG
- User wants to enable semantic search on their data

## Prerequisites

- Oracle MCP server configured and connected (`run-sql`, `run-sqlcl`)
- Embed MCP server configured (`embed`)
- The target table must exist with text-containing columns

## Workflow

### Step 1: Inspect the Table

Get the schema and sample data:

```sql
-- Schema
SELECT column_name, data_type, data_length
FROM user_tab_columns
WHERE table_name = 'MY_TABLE'
ORDER BY column_id;

-- Sample data
SELECT * FROM MY_TABLE FETCH FIRST 5 ROWS ONLY;

-- Row count
SELECT COUNT(*) FROM MY_TABLE;
```

### Step 2: Select Columns to Vectorize

Analyze the columns and decide which to embed based on the user's intent:

**Good candidates for vectorization:**
- Text columns (VARCHAR2, CLOB, NVARCHAR2) with meaningful content
- Descriptions, notes, comments, titles, names
- Content that varies across rows (not status codes or flags)

**Skip these:**
- Numeric IDs, primary keys, foreign keys
- Dates, timestamps
- Short codes, enums, flags (e.g., 'Y'/'N', status codes)
- Columns with mostly NULL values
- Columns with very low cardinality (< 10 distinct values)

**Decision criteria:**
- What kind of queries will the user run?
- Which columns contain the information that answers those queries?
- Prefer columns with rich, descriptive text
- If multiple columns are relevant, combine them

### Step 3: Present the Plan

Before executing, tell the user:
```
I'll vectorize the MY_TABLE table for similarity search.

Selected columns: name, description, category
Combination format: JSON document
Embedding model: all-MiniLM-L6-v2 (384 dimensions)
Row count: 1,234 rows
Estimated time: ~2 minutes

The following changes will be made:
1. ADD column: embedding VECTOR(384, FLOAT32)
2. Generate embeddings for all rows
3. Register in KNOWLEDGE.md

Proceed?
```

Wait for user confirmation before modifying the table.

### Step 4: Add the Vector Column

```sql
ALTER TABLE MY_TABLE ADD (embedding VECTOR(384, FLOAT32));
```

If the column already exists, skip this step.

### Step 5: Generate Embeddings in Batches

Process rows in batches of 100. For each batch:

**5a. Fetch rows that need embedding:**
```sql
SELECT id, col_a, col_b, col_c
FROM MY_TABLE
WHERE embedding IS NULL
FETCH FIRST 100 ROWS ONLY;
```

**5b. For each row, create the JSON document:**
```json
{"col_a": "value of col_a", "col_b": "value of col_b", "col_c": "value of col_c"}
```

Rules for JSON document construction:
- Use column names as JSON keys
- Include all selected columns
- Trim whitespace from values
- Skip NULL values (omit the key entirely)
- For CLOB columns, truncate to first 2000 characters

**5c. Generate the embedding:**
```
embed({ text: '{"col_a": "...", "col_b": "...", "col_c": "..."}', format: "oracle" })
```

**5d. Update the row:**
```sql
UPDATE MY_TABLE
SET embedding = TO_VECTOR(:vec)
WHERE id = :row_id;
```

**5e. Commit every 100 rows:**
```sql
COMMIT;
```

**5f. Report progress:**
After each batch, tell the user:
```
Vectorized 100/1234 rows (8%)...
```

### Step 6: Verify

```sql
-- Check for any missed rows
SELECT COUNT(*) AS total,
       COUNT(embedding) AS vectorized,
       COUNT(*) - COUNT(embedding) AS remaining
FROM MY_TABLE;

-- Test a similarity search
SELECT id, col_a,
       VECTOR_DISTANCE(embedding, TO_VECTOR(:test_vec), COSINE) AS distance
FROM MY_TABLE
ORDER BY VECTOR_DISTANCE(embedding, TO_VECTOR(:test_vec), COSINE)
FETCH FIRST 3 ROWS ONLY;
```

### Step 7: Update KNOWLEDGE.md

Use the `workspace.write` RPC to append the new collection to KNOWLEDGE.md:

```markdown
### Collection: [Descriptive Name]
- **Table:** `MY_TABLE`
- **Vector column:** `embedding` (384 dims, FLOAT32)
- **Content columns:** `col_a`, `col_b`, `col_c`
- **Combination format:** JSON document: {"col_a": "...", "col_b": "...", "col_c": "..."}
- **Metadata columns:** `id`, [other useful columns]
- **Description:** [What this data represents and what queries it supports]
- **Embedding model:** all-MiniLM-L6-v2
- **Row count:** ~N documents
```

## Single Column Mode

If the user specifies a single column:
```
"Vectorize PRODUCTS on the description column"
```

Skip the column selection step. Use the specified column directly — no JSON wrapping needed, embed the raw text.

## Incremental Vectorization

If the table already has an `embedding` column:
- Only process rows where `embedding IS NULL`
- This supports adding new rows without re-vectorizing everything
- Report: "Found 50 new rows to vectorize (1234 already done)"

## Re-vectorization

If the user wants to change the column selection:
```sql
-- Clear existing embeddings
UPDATE MY_TABLE SET embedding = NULL;
COMMIT;
```
Then re-run the vectorization with the new column selection.

## Performance Notes

- Local embedding (~100 rows/minute on CPU)
- For tables > 5,000 rows, warn the user about time
- For tables > 50,000 rows, suggest running in the background or using a GPU vectorization service
- Each embedding is 384 × 4 bytes = 1.5 KB per row
- 10,000 rows ≈ 15 MB of vector data

## Error Handling

- If embedding fails for a row (e.g., empty text), set embedding to NULL and continue
- Log failed rows at the end
- The user can re-run to retry failed rows (incremental mode picks them up)

## Example Prompts

- "Vectorize the PRODUCTS table so I can search for similar products"
- "I want to do similarity search on SUPPORT_TICKETS — vectorize it"
- "Vectorize ARTICLES on the content column"
- "Add the EMPLOYEES table to the knowledge base for searching by skills and experience"
