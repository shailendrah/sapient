---
name: hybrid-search
description: Combine keyword/full-text search with vector similarity search for higher-quality retrieval. Use when a user asks a question that could benefit from both exact keyword matches and semantic similarity. Works with any database that supports text search and vector columns.
metadata:
  openclaw:
    emoji: "🔀"
---
# Hybrid Search (Text + Vector)

Combine keyword search and vector similarity search, then merge results using Reciprocal Rank Fusion (RRF) for higher-quality retrieval than either method alone.

## When to Use

- User asks a domain question and you have both text and vector columns available
- Pure vector search might miss exact keyword matches (e.g., product codes, error messages, names)
- Pure text search might miss semantically similar but differently worded content
- You want the best of both: precision from keywords + recall from semantics

## When NOT to Use

- Simple factual lookups (use text search alone)
- No vector columns exist (use text search alone)
- No text/content columns exist (use vector search alone)
- The query is about current events (use WebSearch instead)

## The Hybrid Search Pattern

### Step 1: Discover Available Columns

```sql
-- Find tables with both text and vector columns
SELECT t.table_name,
       MAX(CASE WHEN c.data_type = 'VECTOR' THEN c.column_name END) AS vector_col,
       MAX(CASE WHEN c.data_type IN ('VARCHAR2','CLOB','NVARCHAR2') THEN c.column_name END) AS text_col
FROM user_tables t
JOIN user_tab_columns c ON t.table_name = c.table_name
WHERE c.data_type IN ('VECTOR','VARCHAR2','CLOB','NVARCHAR2')
GROUP BY t.table_name
HAVING MAX(CASE WHEN c.data_type = 'VECTOR' THEN 1 END) = 1
   AND MAX(CASE WHEN c.data_type IN ('VARCHAR2','CLOB','NVARCHAR2') THEN 1 END) = 1
```

### Step 2: Run Both Searches

**Text search** — keyword matching with ranking:

```sql
-- Oracle Text (if configured)
SELECT id, content, SCORE(1) AS text_score
FROM documents
WHERE CONTAINS(content, 'search terms', 1) > 0
ORDER BY SCORE(1) DESC
FETCH FIRST 20 ROWS ONLY

-- Simple LIKE fallback (if Oracle Text not available)
SELECT id, content, 1 AS text_score
FROM documents
WHERE LOWER(content) LIKE '%search%' OR LOWER(content) LIKE '%terms%'
FETCH FIRST 20 ROWS ONLY
```

**Vector search** — semantic similarity:

```sql
-- First, get the query embedding using the embed tool
-- embed({ text: "user's question", format: "oracle" }) → vector string

SELECT id, content,
       VECTOR_DISTANCE(embedding, TO_VECTOR(:qvec), COSINE) AS vector_dist
FROM documents
ORDER BY VECTOR_DISTANCE(embedding, TO_VECTOR(:qvec), COSINE)
FETCH FIRST 20 ROWS ONLY
```

### Step 3: Reciprocal Rank Fusion (RRF)

Merge the two result sets using RRF. The formula:

```
RRF_score(doc) = Σ  1 / (k + rank_in_list)
```

Where `k` is a constant (typically 60) that prevents top-ranked results from dominating.

**How to compute RRF:**

For each document that appears in either result set:
1. Find its rank in the text results (or set to a large number if absent)
2. Find its rank in the vector results (or set to a large number if absent)
3. `RRF = 1/(60 + text_rank) + 1/(60 + vector_rank)`
4. Sort by RRF descending — highest score wins

**Example calculation:**

| Document | Text Rank | Vector Rank | RRF Score |
|----------|-----------|-------------|-----------|
| doc_A    | 1         | 5           | 1/61 + 1/65 = 0.0318 |
| doc_B    | 3         | 1           | 1/63 + 1/61 = 0.0323 |
| doc_C    | 2         | 8           | 1/62 + 1/68 = 0.0308 |
| doc_D    | -         | 2           | 0 + 1/62 = 0.0161    |

Result: doc_B wins (strong in both), then doc_A, then doc_C, then doc_D.

### Step 4: Combined SQL (Oracle)

For Oracle databases, you can do hybrid search in a single query:

```sql
WITH text_results AS (
    SELECT id, content,
           ROW_NUMBER() OVER (ORDER BY SCORE(1) DESC) AS text_rank
    FROM documents
    WHERE CONTAINS(content, :search_terms, 1) > 0
    FETCH FIRST 20 ROWS ONLY
),
vector_results AS (
    SELECT id, content,
           ROW_NUMBER() OVER (ORDER BY VECTOR_DISTANCE(embedding, TO_VECTOR(:qvec), COSINE)) AS vec_rank
    FROM documents
    ORDER BY VECTOR_DISTANCE(embedding, TO_VECTOR(:qvec), COSINE)
    FETCH FIRST 20 ROWS ONLY
),
merged AS (
    SELECT COALESCE(t.id, v.id) AS id,
           COALESCE(t.content, v.content) AS content,
           1.0 / (60 + COALESCE(t.text_rank, 1000)) +
           1.0 / (60 + COALESCE(v.vec_rank, 1000)) AS rrf_score
    FROM text_results t
    FULL OUTER JOIN vector_results v ON t.id = v.id
)
SELECT id, content, rrf_score
FROM merged
ORDER BY rrf_score DESC
FETCH FIRST 10 ROWS ONLY
```

### Step 5: Present Results

When presenting hybrid search results:
- Show the RRF score or a normalized relevance percentage
- Indicate which signal contributed most (text match, semantic match, or both)
- Cite the source table and row identifier

## Adapting to Other Databases

### PostgreSQL (with pgvector)

```sql
-- Text: ts_rank with tsvector
-- Vector: pgvector <=> operator
-- Same RRF merge pattern with CTEs
WITH text_results AS (
    SELECT id, content,
           ROW_NUMBER() OVER (ORDER BY ts_rank(to_tsvector(content), plainto_tsquery(:query)) DESC) AS text_rank
    FROM documents
    WHERE to_tsvector(content) @@ plainto_tsquery(:query)
    LIMIT 20
),
vector_results AS (
    SELECT id, content,
           ROW_NUMBER() OVER (ORDER BY embedding <=> :query_vec) AS vec_rank
    FROM documents
    ORDER BY embedding <=> :query_vec
    LIMIT 20
)
-- ... same FULL OUTER JOIN + RRF as above
```

### Elasticsearch

```json
{
  "query": {
    "hybrid": {
      "queries": [
        { "match": { "content": "search terms" } },
        { "knn": { "field": "embedding", "query_vector": [...], "k": 20 } }
      ]
    }
  }
}
```

### In-Memory (no database)

If working with local files, the agent can:
1. `Grep` for keyword matches → text results with line numbers as rank
2. `embed` each matching chunk + the query → compute cosine similarity
3. Apply RRF manually in reasoning

## Key Constants

| Parameter | Default | Purpose |
|-----------|---------|---------|
| k (RRF)  | 60      | Dampening factor — higher = more equal weighting |
| Top-N per search | 20 | Candidates from each search before fusion |
| Final top-K | 5-10 | Results returned after fusion |

## Tips

- If text search returns no results, fall back to vector-only
- If vector search returns high distances (> 0.7), text results may be more reliable
- For short queries (1-3 words), text search often outperforms vector
- For long natural-language questions, vector search usually wins
- Hybrid is most valuable when both signals are available and moderately confident
