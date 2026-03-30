#!/usr/bin/env node

/**
 * Sapient Embed MCP Server
 *
 * Provides a text embedding tool via MCP (stdio transport).
 * Uses Xenova/transformers.js to run sentence-transformers locally.
 *
 * Tools:
 *   embed - Convert text to a vector string for use in Oracle VECTOR_DISTANCE() queries
 *
 * Config env vars:
 *   EMBED_MODEL  - HuggingFace model name (default: Xenova/all-MiniLM-L6-v2)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const MODEL_NAME = process.env.EMBED_MODEL || "Xenova/all-MiniLM-L6-v2";

let pipeline = null;

async function getEmbedder() {
  if (pipeline) return pipeline;

  // Dynamic import — transformers.js is ESM
  const { pipeline: createPipeline } = await import("@xenova/transformers");

  console.error(`[embed-mcp] Loading model: ${MODEL_NAME}`);
  pipeline = await createPipeline("feature-extraction", MODEL_NAME, {
    quantized: true,
  });
  console.error(`[embed-mcp] Model loaded`);
  return pipeline;
}

const server = new McpServer({
  name: "sapient-embed",
  version: "0.1.0",
});

server.tool(
  "embed",
  "Convert text into a vector embedding string. Returns a format suitable for Oracle TO_VECTOR() and VECTOR_DISTANCE() queries.",
  {
    text: z.string().describe("The text to embed"),
    format: z
      .enum(["oracle", "json"])
      .default("oracle")
      .describe(
        "Output format: 'oracle' returns '[0.1,0.2,...]' for TO_VECTOR(), 'json' returns a JSON array"
      ),
  },
  async ({ text, format }) => {
    const embedder = await getEmbedder();
    const output = await embedder(text, { pooling: "mean", normalize: true });
    const embedding = Array.from(output.data);

    let result;
    if (format === "json") {
      result = JSON.stringify(embedding);
    } else {
      // Oracle TO_VECTOR() format: [0.1,0.2,...]
      result = "[" + embedding.map((v) => v.toFixed(8)).join(",") + "]";
    }

    return {
      content: [
        {
          type: "text",
          text: result,
        },
      ],
    };
  }
);

server.tool(
  "embed_batch",
  "Convert multiple texts into vector embeddings. Returns one vector per input text.",
  {
    texts: z.array(z.string()).describe("Array of texts to embed"),
    format: z
      .enum(["oracle", "json"])
      .default("oracle")
      .describe("Output format per vector"),
  },
  async ({ texts, format }) => {
    const embedder = await getEmbedder();
    const results = [];

    for (const text of texts) {
      const output = await embedder(text, { pooling: "mean", normalize: true });
      const embedding = Array.from(output.data);

      if (format === "json") {
        results.push(JSON.stringify(embedding));
      } else {
        results.push(
          "[" + embedding.map((v) => v.toFixed(8)).join(",") + "]"
        );
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(results),
        },
      ],
    };
  }
);

server.tool(
  "embed_info",
  "Get information about the loaded embedding model (name, dimensions).",
  {},
  async () => {
    const embedder = await getEmbedder();
    // Run a dummy embed to get dimensions
    const output = await embedder("test", { pooling: "mean", normalize: true });
    const dim = output.data.length;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            model: MODEL_NAME,
            dimensions: dim,
            format: "FLOAT32",
            oracleType: `VECTOR(${dim}, FLOAT32)`,
          }),
        },
      ],
    };
  }
);

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
