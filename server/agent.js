import { ChatGoogle } from "@langchain/google/node";
//LangChain provides common interfaces/components for working with LLMs.
//ChatGoogle is the LangChain class/interface you use to communicate with a Google chat model such as Gemini.
import { tool } from "@langchain/core/tools";
//tool is a function provided by LangChain that ai agent is allowed to use if we wrap a normal js func around it .
import { MemorySaver } from "@langchain/langgraph";
//memorySaver is a class provided by LangGraph that allows you to persist the state of your agent's memory across invocations. It stores the agent's state/conversation in memory so that different calls belonging to the same thread can maintain context.
import { createReactAgent } from "@langchain/langgraph/prebuilt";
//langraph  is a framework to implement ai workflow. It allows you to create agents that can use tools and memory to perform complex tasks.
//means you're importing a prebuilt agent implementation provided by LangGraph.Instead of manually constructing every node and edge of the agent graph yoursel
import { z } from "zod";
//zos is schema validation lib. decide the input schema to the tools . it ensure the data pass to tools is as expected/
import { vectorStore, hasVideoInVectorStore, addYTVideoToVectorStore,} from "./embeddings.js";
import {
  downloadBrightDataSnapshot,
  shouldUseLocalBrightDataPolling,
  triggerYoutubeVideoScrape,
  waitForBrightDataSnapshot,} from "./brightdata.js";


// It converts
// URL
// ↓
// Video ID

// This process is called Normalization
// Normalization means converting different formats into one standard format.
const normalizeVideoIdentifier = ({ url, video_id }) => {
  if (video_id) {
    return video_id;
  }

  if (!url) {
    throw new Error("Either url or video_id is required.");
  }

  const parsedUrl = new URL(url);
  //URL-> It is a built-in JavaScript Web API class used for parsing and manipulating URLs.
  //URL Object
// { hostname:"youtu.be", pathname:"/abc123", search:"", protocol:"https:",}

  if (parsedUrl.hostname.includes("youtu.be")) {
    return parsedUrl.pathname.slice(1);
    //to remove the leading slash from the pathname to get the video ID. /abc se / remove hoga
  }

  return parsedUrl.searchParams.get("v");
  //https://www.youtube.com/watch?v=abc123&t=30
  //since param are key value pairs Give me the value associated with key "v".
};
//A Tool is a function that an agent can decide to invoke in order to access external information or perform actions that it cannot do on its own.

// Suppose we do  -> tools:[ checkVideo]

// How would Gemini know.   when to call it?
// what arguments it needs?  what it returns?  what it actually does?

// It can't. bcz A JS function is just code.
// An LLM understands descriptions, not source code.

//tool func take input and wrap a func in a way agentcan understand. it return a tool object


//the args a tool takes->
// tool(Function,Configuration)

// First
// How to perform the task.
// Second
// Everything the AI needs to know about that task.
// A Tool = Function + Metadata (name, description, input schema).
// Because an LLM cannot understand source code directly. It needs metadata such as the tool's name, description, and input schema to decide when and how to invoke it.

//The LLM only says something equivalent to:
// "I want to call checkVideoInVectorStore with these arguments."
// LangChain receives that request and executes the JavaScript function on behalf of the LLM, then returns the result back to the LLM.
const checkVideoInVectorStoreTool = tool(
  async ({ url, video_id }) => {
    // Normalize the user's input so every tool works with a single,
// consistent video identifier regardless of whether the user
// provides a URL or a raw video_id.
    const resolvedVideoId = normalizeVideoIdentifier({ url, video_id });

    if (!resolvedVideoId) {
      return "false";
    }

    const exists = await hasVideoInVectorStore(resolvedVideoId);
    return exists ? "true" : "false";
    // Return the result as a string for the LLM to interpret.
  },
  {
    name: "checkVideoInVectorStore",
    //llm ko code smjh nhi aata.  it needs metadata such as the tool's name, description, and input schema to decide when and how to invoke it.
    description: `
Check whether a YouTube video is already indexed in the vector store.
Use this before triggering Bright Data scraping.
Return value is the string "true" or "false".
    `,
    //A schema defines the structure and validation rules of the input expected by a tool.
    //Zod is a validation library. it validate the imput and ensure data is in expected structure/format
    //  LangChain validates using Zod
    //z.object means input to tool must be an object so gemini create that and pass to tool and lanchain validate it using zod and based on result exec or trow error  and give back resp to llm
    schema: z.object({
      url: z.string().url().optional(),
      video_id: z.string().optional(),
    }),
  }
);

const triggerYoutubeVideoScrapeTool = tool(
  async ({ url }) => {
    //Bright Data doesn't necessarily give you the complete transcript immediately.Instead, it starts a scraping job and gives you an identifier:
    const snapshotId = await triggerYoutubeVideoScrape(url);

    if (shouldUseLocalBrightDataPolling()) {
      await waitForBrightDataSnapshot(snapshotId);
      const videos = await downloadBrightDataSnapshot(snapshotId);

      if (!Array.isArray(videos) || videos.length === 0) {
        return "Scrape completed, but no video data was returned.";
      }

      await Promise.all(videos.map((video) => addYTVideoToVectorStore(video)));
      return "Scrape completed and the video transcript has been indexed locally. You can ask questions about it now.";
    }

    //Scraping is a long-running asynchronous operation. Returning a snapshot ID allows the application to acknowledge that the job has started without making the user wait for the entire scraping process to complete.
    //A snapshot is essentially a saved result or a scraping job instance.
    return `Scrape triggered successfully. Snapshot id: ${snapshotId}`;
  },
  {
    name: "triggerYoutubeVideoScrape",
    description: `
Trigger the scraping of a YouTube video using Bright Data.
Use this only if the video is not already present in the vector store.
The tool returns a snapshot id for the scraping job.
    `,
    schema: z.object({
      url: z.string().url(),
    }),
  }
);

const retrieveTool = tool(
  async ({ query, url, video_id }) => {
    const resolvedVideoId = normalizeVideoIdentifier({ url, video_id });

    if (!resolvedVideoId) {
      return "I could not determine the YouTube video id to retrieve from.";
    }
//Retrieval-Augmented Generation (RAG) is a technique where an LLM retrieves relevant external information before generating an answer.
    const retrievedDocs = await vectorStore.similaritySearch(query, 3, {
      video_id: resolvedVideoId,
    });

    if (retrievedDocs.length === 0) {
      return "No relevant transcript chunks found for this video yet.";
    }

    return retrievedDocs.map((doc) => doc.pageContent).join("\n");
    //The agent doesn't really need all the database object information.It needs the actual information retrieved from the transcript.so we extract pagecontnet from each doc and join them
  },
  {
    name: "retrieve",
    description: `
Retrieve the most relevant transcript chunks for a specific YouTube video.
Pass either the full YouTube url or the video_id.
    `,
    schema: z.object({
      query: z.string(),
      url: z.string().url().optional(),
      video_id: z.string().optional(),
    }),
  }
);


const retrieveSimilarVideosTool = tool(
  async ({ query }) => {
    const retrievedDocs = await vectorStore.similaritySearch(query, 30);
    const ids = [...new Set(retrievedDocs.map((doc) => doc.metadata.video_id))];

    return ids.length > 0
      ? ids.join("\n")
      : "No similar videos found in the vector store.";
  },
  {
    name: "retrieveSimilarVideos",
    description:
      "Retrieve video ids for the videos that are most similar to the user query.",
    schema: z.object({
      query: z.string(),
    }),
  }
);

const resolveGeminiModel = () => {
  const requestedModel = process.env.GEMINI_MODEL || "gemini-flash-latest";

  // Keep older tutorial env values working by mapping them
  // to a currently supported Gemini alias.
  if (requestedModel === "gemini-2.5-flash") {
    return "gemini-flash-latest";
  }

  return requestedModel;
};

const llm = new ChatGoogle({
  model: resolveGeminiModel(),
  temperature: 0.2,
});
//checkpointer stores the state of the graph at different points so it can be recovered later.
const checkpointer = new MemorySaver();

// This is the factory function that creates your ReAct agent.
// Think of it as:
// "Build me an agent using this LLM, these tools, and this memory."


//Create a LangGraph ReAct agent that uses my LLM to reason, has these three tools available, and saves conversation state using the checkpointer.
export const agent = createReactAgent({
  llm,
  //You're giving the agent the LLM it should use for reasoning and generating responsesThe agent uses this model to decide what to do.
  
  tools: [
    checkVideoInVectorStoreTool,
    triggerYoutubeVideoScrapeTool,
    retrieveTool,
    retrieveSimilarVideosTool,
  ],
  checkpointer,
  prompt: `
You are an AI assistant that answers questions about YouTube videos.

Rules:
1. If the user shares a YouTube URL and asks to discuss that video, first check whether it is already indexed using checkVideoInVectorStore.
2. If the video is not indexed, call triggerYoutubeVideoScrape.
3. Do not claim that the transcript is available immediately after scraping; tell the user it may take a few seconds.
4. When the video is indexed, use retrieve to answer based only on the transcript context.
5. If the answer is not in the transcript, say so clearly.
6. If the user asks for related videos across the indexed collection, use retrieveSimilarVideos.
  `,
});
