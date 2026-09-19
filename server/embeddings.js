//An embedding is a numerical representation of text that captures its semantic meaning.
//Take a YouTube transcript and convert it into chunk and then later searchable vectors, then store those vectors in PGVector.
import { Document } from "@langchain/core/documents";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
//postgre SQL is an open-source relational database management system that uses and extends the SQL language combined with many features that safely store and scale the most complicated data workloads
//PGVector adds the ability to store and search vectors inside PostgreSQL.
//A tool in LangChain that acts as a bridge to save and query vector data.
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
//@langchain/gen-ai is a software package that connects the LangChain application framework with genaI's artificial intelligence models
//The GoogleGenerativeAIEmbeddings class is a wrapper around the Google Generative AI Embeddings API, which allows you to generate embeddings for text using Google's AI models.
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
//@langchain/text-splitters is a utility package in the LangChain framework designed to break large, long-form documents into smaller, manageable chunks
//The RecursiveCharacterTextSplitter class is a specific implementation of a text splitter that recursively splits text based on character count, ensuring that each chunk is within a specified size limit while maintaining context.
import pg from "pg";
//Allows Node.js/PostgreSQL communication
const { Pool } = pg;
//pool is a class from node.js ki pg library that manages a collection of database connections, allowing efficient reuse of connections for multiple database operations without the overhead of establishing a new connection each time.
const embeddings = new GoogleGenerativeAIEmbeddings({
  model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
});

const pgConfig = {
  connectionString: process.env.DB_URL,
  //address/connection information for my database
  max: 5,
  idleTimeoutMillis: 30000,
};

// Use one managed pool for both direct SQL queries and LangChain's vector store.
// Cloud PostgreSQL providers can close idle connections; the pool recreates them
// for the next request instead of letting an unhandled client error stop Node.
const pool = new Pool(pgConfig);
pool.on("error", (error) => {
  console.error("PostgreSQL pool connection error:", error.message);
});

//Create a PGVector vector store using my embedding model, connect it to my PostgreSQL database, use the transcripts table, tell it which columns contain IDs, vectors, content and metadata, and use cosine similarity for vector search.
export const vectorStore = await PGVectorStore.initialize(embeddings, {
  pool,
  tableName: "transcripts",
  columns: {
    idColumnName: "id",
    vectorColumnName: "vector",
    contentColumnName: "content",
    metadataColumnName: "metadata",
  },
  distanceStrategy: "cosine",
});

// PGVectorStore uses a client only while it initializes the table. Keeping that
// client checked out permanently makes a cloud database disconnect crash Node.
vectorStore.client?.release();
vectorStore.client = undefined;
//Instead of opening and closing a brand new connection for every single user request or query, the app borrows an existing connection and returns it when done.
//Pool→ direct SQL operations

export const hasVideoInVectorStore = async (videoId) => {
  const result = await pool.query(
    `SELECT 1 FROM transcripts WHERE metadata->>'video_id' = $1 LIMIT 1`,
    [videoId]
  );
  //pool.query Send this SQL query to PostgreSQL.
  //Does the transcripts table contain at least one row whose metadata contains this video ID?"

  return result.rowCount > 0;
};
//videoData is objct recieved from brightData , it can be in diff format so before embedding we need to normalize
const normalizeTranscript = (videoData) => {
  if (typeof videoData.transcript === "string" && videoData.transcript.trim()) {
    //trim() removes whitespace from the beginning and end.
    //After removing surrounding spaces, is there actually some text? if yes return the trans
    return videoData.transcript.trim();
  }

  if (Array.isArray(videoData.formatted_transcript)) {
    return videoData.formatted_transcript
      .map((item) => item.text)
      //This extracts the text from every item.
      .filter(Boolean)
      .join(" ");
      //all part in formatted tranjoined to one 
  }

  return "";
};

//texts is array of transcript chunks
const embedDocumentsWithRetries = async (texts) => {
  const vectors = [];
//process each chunk one by one 
  for (let index = 0; index < texts.length; index += 1) {
    let lastError;

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        const vector = await embeddings.embedQuery(texts[index]);
//Convert this text into an embedding vector
//Wait until the embedding request finishes, then put the resulting vector into vector.
        if (Array.isArray(vector) && vector.length > 0) {
          vectors.push(vector);
          break;
        }

        throw new Error(`Gemini returned an empty embedding for chunk ${index}.`);
      } catch (error) {
        lastError = error;
        //Converting error into a message
        const message = error instanceof Error ? error.message : String(error);
        const isRateLimit = message.includes("429") || message.includes("quota");
        //ratelimit errer is too many req to a server 
        if (!isRateLimit || attempt === 5) {
          throw error;
        }
        //bcoz if not ratelinit error then no point of retryting bcz error will persist
        //if not rate limit error 
        //Wait 15000ms ie 15 seconds. and then retry
        await new Promise((resolve) => setTimeout(resolve, 15000));
      }
    }

    if (vectors.length !== index + 1) {
      throw lastError || new Error(`Failed to embed chunk ${index}.`);
    }
//Wait 800 milliseconds before processing the next chunk.
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  return vectors;
};
//videoData has video_id & transcript 
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
//Delete all existing rows belonging to this video before inserting the new version. Now Bright Data gives us an updated transcript.
//we're initially creating one Document, LangChain's splitting functions work naturally with arrays of documents.
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
    //chunks is an array of objects, each containing a pageContent property that holds the text of the chunk. The map function is used to extract the pageContent from each chunk and create an array of texts to be embedded.
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
