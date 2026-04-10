## Vector Knowledge Base

This file describes the vectorized data available for similarity search (RAG).
The agent uses this to know which tables to query and what they contain.

### Collection: General Knowledge
- **Table:** `test_docs`
- **Vector column:** `embedding` (384 dims, FLOAT32)
- **Content column:** `content`
- **Metadata columns:** `id`, `source_name`
- **Description:** General knowledge base with articles on technology, science, history, environment, and biology
- **Embedding model:** all-MiniLM-L6-v2
- **Row count:** ~10 documents

### How to Query

1. Get the query embedding:
   ```
   embed({ text: "user's question", format: "oracle" })
   ```

2. Run similarity search:
   ```sql
   SELECT id, content, source_name,
          VECTOR_DISTANCE(embedding, TO_VECTOR(:qvec), COSINE) AS distance
   FROM test_docs
   ORDER BY VECTOR_DISTANCE(embedding, TO_VECTOR(:qvec), COSINE)
   FETCH FIRST 5 ROWS ONLY
   ```

3. Results with distance < 0.5 are strong matches.

### Adding New Collections

To add a new vectorized dataset:
1. Create a table with a `VECTOR` column
2. Insert data with embeddings (use the same embedding model: all-MiniLM-L6-v2)
3. Add a section to this file describing the table, columns, and content
