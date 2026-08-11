//An embedding is a numerical representation of text that captures its semantic meaning.
//Take a YouTube transcript and convert it into chunk and then later searchable vectors, then store those vectors in PGVector.
import { Document } from "@langchain/core/documents";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import pg from "pg";

const { Pool } = pg;

const embeddings = new GoogleGenerativeAIEmbeddings({
  model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
});

const pgConfig = {
  connectionString: process.env.DB_URL,
};

export const vectorStore = await PGVectorStore.initialize(embeddings, {
  postgresConnectionOptions: pgConfig,
  tableName: "transcripts",
  columns: {
    idColumnName: "id",
    vectorColumnName: "vector",
    contentColumnName: "content",
    metadataColumnName: "metadata",
  },
  distanceStrategy: "cosine",
});

const pool = new Pool(pgConfig);

export const hasVideoInVectorStore = async (videoId) => {
  const result = await pool.query(
    `SELECT 1 FROM transcripts WHERE metadata->>'video_id' = $1 LIMIT 1`,
    [videoId]
  );

  return result.rowCount > 0;
};

const normalizeTranscript = (videoData) => {
  if (typeof videoData.transcript === "string" && videoData.transcript.trim()) {
    return videoData.transcript.trim();
  }

  if (Array.isArray(videoData.formatted_transcript)) {
    return videoData.formatted_transcript
      .map((item) => item.text)
      .filter(Boolean)
      .join(" ");
  }

  return "";
};

const embedDocumentsWithRetries = async (texts) => {
  const vectors = [];

  for (let index = 0; index < texts.length; index += 1) {
    let lastError;

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        const vector = await embeddings.embedQuery(texts[index]);

        if (Array.isArray(vector) && vector.length > 0) {
          vectors.push(vector);
          break;
        }

        throw new Error(`Gemini returned an empty embedding for chunk ${index}.`);
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const isRateLimit = message.includes("429") || message.includes("quota");

        if (!isRateLimit || attempt === 5) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, 15000));
      }
    }

    if (vectors.length !== index + 1) {
      throw lastError || new Error(`Failed to embed chunk ${index}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  return vectors;
};

export const addYTVideoToVectorStore = async (videoData) => {
  const videoId = videoData.video_id || videoData.shortcode;
  const transcript = normalizeTranscript(videoData);

  if (!videoId) {
    throw new Error("Bright Data payload is missing video_id.");
  }

  if (!transcript) {
    throw new Error(`No transcript found for video ${videoId}.`);
  }

  await pool.query(
    `DELETE FROM transcripts WHERE metadata->>'video_id' = $1`,
    [videoId]
  );

  const docs = [
    new Document({
      pageContent: transcript,
      metadata: {
        video_id: videoId,
        title: videoData.title || "",
        url: videoData.url || "",
        youtuber: videoData.youtuber || "",
      },
    }),
  ];

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 6000,
    chunkOverlap: 600,
  });

  const chunks = await splitter.splitDocuments(docs);
  const vectors = await embedDocumentsWithRetries(
    chunks.map((chunk) => chunk.pageContent)
  );

  const invalidVectorIndex = vectors.findIndex(
    (vector) => !Array.isArray(vector) || vector.length === 0
  );

  if (invalidVectorIndex !== -1) {
    throw new Error(
      `Gemini returned an empty embedding for chunk ${invalidVectorIndex}. Try again in a few seconds.`
    );
  }

  await vectorStore.addVectors(vectors, chunks);
};
