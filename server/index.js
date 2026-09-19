import "dotenv/config";
//dotenv reads .env file and loads env variable in process.env
//allowing secrets and environment-specific configuration such as API keys and database URLs to remain outside the source code.
import cors from "cors";
//cross origin resource sharing 
//cors is a middleware that allows cross-origin requests, enabling the server to handle requests from different domains or ports, which is essential for web applications that interact with APIs hosted on different servers.
import express from "express";
//without express, we would have to manually handle HTTP requests and responses, which can be cumbersome and error-prone. Express provides a clean and simple API for defining routes, handling requests, and sending responses.

import { ChatGoogle } from "@langchain/google/node";
//LangChain provides common abstractions around these models.So instead of your application having to understand every provider's API, you can work with LangChain interfaces.

//@ means scope
//@langchain/google means package owned by langchain & that package prov langchain integration with google services

//chatgoogle is lc class that provides a wrapper around the Google Gemini API, allowing you to interact with Google's language model for generating text-based responses. It simplifies the process of sending requests to the Gemini API and handling responses, making it easier to integrate Google's language capabilities into your applications.

import { agent } from "./agent.js";
import {
  addYTVideoToVectorStore,
  hasVideoInVectorStore,
  vectorStore,
  //This is the actual vector database interface imported from: embedding .js
} from "./embeddings.js";
import {
  downloadBrightDataSnapshot,//download the scraped data
  shouldUseLocalBrightDataPolling,
  triggerYoutubeVideoScrape,//start scraping
  waitForBrightDataSnapshot,//wait for scraping to complete
} from "./brightdata.js";
//process nodejs ka global obj h jo current runnig process ki info rkhta h 
const port = process.env.PORT || 3000;
const app = express();
//expres is js lib and express()is func tjat creat express app instance
//al the power of express lies in app and app is express instance. any req coming on server is handeled by app.resp of reouting, req handling middleware
const threadVideoIds = new Map();
//thread->ytvdo id
//Remembers which video a conversation thread is associated with
const indexingJobs = new Map();
//vdo id ->indexing status

// Suppose the user sends a YouTube URL.The transcript isn't indexed yet.You trigger scrapingbut scraping may take time.You don't want multiple requests to start the exact same indexing process.
const resolveGeminiModel = () => {
  const requestedModel = process.env.GEMINI_MODEL || "gemini-flash-latest";
  return requestedModel === "gemini-2.5-flash"
    ? "gemini-flash-latest"
    : requestedModel;
};
//ChatGoogle is a class provided by LangChain.
//here u have created an object o that class
const llm = new ChatGoogle({
  model: resolveGeminiModel(),
  temperature: 0.2,
});
//llm is client/var/obj of class chatgoogle that is resp for interacting  with actual google llm on goole infra.


//This is a regular expression, commonly called a regex.Regex is a pattern used to search/validate/extract text.

const extractYoutubeUrl = (text) => {
  return text.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?[^ \n]+|youtu\.be\/[^ \n]+)/)?.[0];
};
//text.match(regex)doesn't directly return the string.It returns a match result array when a match exists. so [0] to get first element of that array that is the url
const extractVideoId = (url) => {
  const parsedUrl = new URL(url);
//URL is a built-in JavaScript class that provides a convenient way to parse and manipulate URLs. It allows you to extract various components of a URL, such as the hostname, pathname, search parameters, etc.
//protocol  → https:
//hostname  → www.youtube.com
//pathname  → /watch
//searchparams   → ?v=ABC123
//slice(1) means start from index 1 so skip the /
  if (parsedUrl.hostname.includes("youtu.be")) {
    return parsedUrl.pathname.slice(1);
  }

  return parsedUrl.searchParams.get("v");
};

const startIndexingVideo = (url, videoId) => {
  //to make sure we dont do the indexing job for same vdo twice what if user sends multiple requests for same vdo before indexing is done. so we check if indexingJobs has that vdo id, if yes return the promise of that job. if not start a new indexing job and store the promise in indexingJobs map.
  if (indexingJobs.has(videoId)) {
    return indexingJobs.get(videoId);
  }
//An async function always returns a Promise.
//this job is a promise 
//A Promise is basically a JavaScript object representing:"I don't have the final result yet, but I promise I'll give you the result later."
  const job = (async () => {
    //await pauses the execution of this async function until the Promise settles.it does not freeze the entire Node.js process.
    const snapshotId = await triggerYoutubeVideoScrape(url);

    if (!shouldUseLocalBrightDataPolling()) {
      return;
    }

    await waitForBrightDataSnapshot(snapshotId);
    //Once scraping is triggered, 
    // Bright Data may need time to finish.
    const videos = await downloadBrightDataSnapshot(snapshotId);
//videos is an array containg multiple vdo scraped data and the downloadbrightdata return is stored in the videos array
    if (!Array.isArray(videos) || videos.length === 0) {
      throw new Error("Bright Data returned no video data.");
    }

//addYTVideoToVectorStore() is asynchronous. it returns a Promise that resolves when the video is successfully added to the vector store. By using Promise.all(), we can wait for all these Promises to resolve before proceeding. This ensures that all videos are indexed before the job is considered complete.
    await Promise.all(videos.map((video) => addYTVideoToVectorStore(video)));
    
  })().finally(() => {
    //.finally() runs only after the Promise  upar wale func ka  is settled.
// “Settled” means the Promise is no longer pending. It has reached one of these states:
// fulfilled: the async function completed successfully
// rejected: the async function threw an error
    if (shouldUseLocalBrightDataPolling()) {
      indexingJobs.delete(videoId);
      return;
    }

    setTimeout(() => indexingJobs.delete(videoId), 5 * 60 * 1000);
    //delete vdo id after 5 min if no polling bcoz wehbook may take time to get the data 
    //.finally()Run this code when the Promise finishes, whether it succeeds or fails.
    //success or failure in promise just remove the job from the map bcoz even if it failed it is not active 
  });

  indexingJobs.set(videoId, job);
  job.catch((error) => console.error("Background indexing failed:", error));
  return job;// gives back the Promise created by this async job
};

const answerFromTranscript = async (query, videoId) => {
  //terminology, retrieved pieces of text are commonly represented as Document objects.
  //return top 4 chunks/doc object  similar to query 
  //docs is array of Document objects
  const docs = await vectorStore.similaritySearch(query, 4, {
    video_id: videoId,
  });

  if (docs.length === 0) {
    return "I do not have transcript chunks for this video yet. Please try again after indexing finishes.";
  }
//iterade over the array docs and extract page content from each doc object in the array and join them with two newlines in between to create a single string that represents the combined transcript context. This context will be used to answer the user's query.
  const context = docs.map((doc) => doc.pageContent).join("\n\n");
  //llm is not real llm here but
  //.invoke is used to send a request to the language model (in this case, the Google Gemini model) with a specific prompt. The prompt includes instructions for the model to answer the user's question using only the provided transcript context. The model is expected to generate a response based on this context and return it.
  const response = await llm.invoke(`
Answer the user's question using only the YouTube transcript context below.
If the answer is not present in the transcript, say that clearly.

Transcript context:
${context}

Question:
${query}
  `);

  return typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);
};
//Add middleware to the Express application.

//Middleware is basically a function that runs as part of the request-processing pipeline. this middleware parse the json of req and make it availabe as req.body
//limit: "200mb" sets the maximum size of incoming JSON payloads to 200 megabytes. This is useful for handling large requests, such as those that might include extensive data or files.
app.use(express.json({ limit: "200mb" }));
app.use(
  cors({
    origin: process.env.CLIENT_URL || "*",
  })
);

app.get("/", (_req, res) => {
  res.send("AI Chat With YouTube backend is running.");
});

app.post("/generate", async (req, res) => {
  try {
    //threadid is a unique identifier for conversation thread
    const { query, thread_id } = req.body;
    const threadKey = String(thread_id || "default-thread");

    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }

    const youtubeUrl = extractYoutubeUrl(query);

    if (youtubeUrl) {
      const videoId = extractVideoId(youtubeUrl);

      if (!videoId) {
        return res.status(400).send("I could not read the YouTube video id from that URL.");
      }

      threadVideoIds.set(threadKey, videoId);

      if (!(await hasVideoInVectorStore(videoId))) {
        startIndexingVideo(youtubeUrl, videoId);
        return res.send(
          "I started indexing this video. This can take a little while for long videos, but you do not need to keep waiting on this request. Ask your question again after a short moment."
        );
      }

      return res.send(await answerFromTranscript(query, videoId));
   }
//if user sends a query without a youtube url, we check if the thread has an active video id associated with it. If it does, we check if that video is still being indexed or if it is already in the vector store. If it's still being indexed, we inform the user to ask again later. If it's already indexed, we answer the user's query based on the transcript of that video. If there's no active video id for the thread, we proceed to invoke the agent to handle the query.
//we reach here if not yt url in query
    const activeVideoId = threadVideoIds.get(threadKey);

    if (activeVideoId) {
      if (await hasVideoInVectorStore(activeVideoId)) {
        return res.send(await answerFromTranscript(query, activeVideoId));
      }

      if (indexingJobs.has(activeVideoId)) {
        return res.send(
          "The video is still being indexed. Please ask again in a short moment."
        );
      }
    }
//we reach here if not activevdoid correponding to threadid
//invoke =Run this LangGraph agent with this input."
    const result = await agent.invoke(
      {
        messages: [
          {
            role: "user",
            content: query,
          },
        ],
      },
      {
        configurable: {
          thread_id: threadKey,
    //Treat this invocation as belonging to this conversation thread. the       
        },
      }
    );

    return res.send(result.messages.at(-1)?.content || "");

    //last element of messages array is resp from agent 
  } catch (error) {
    console.error("Generate failed:", error);
    return res.status(500).json({
      error: "Failed to generate response",
      details: error.message,
    });
  }
});
//A webhook is an HTTP endpoint that another service calls to notify our application when an event happens.
//your frontend call backend is diff and another service calls backend 
//Your server doesn't want to constantly keep asking:
// Are you finished?
// Depending on how the Bright Data integration is configured, Bright Data can notify your backend when the result is ready.
// That notification is the webhook.

app.post("/webhook", async (req, res) => {
  try {
    const payload = Array.isArray(req.body) ? req.body : [req.body];

    await Promise.all(payload.map((video) => addYTVideoToVectorStore(video)));

    return res.send("OK");
  } catch (error) {
    console.error("Webhook processing failed:", error);
    return res.status(500).json({
      error: "Failed to process Bright Data webhook",
      details: error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
