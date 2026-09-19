const brightDataTriggerUrl = "https://api.brightdata.com/datasets/v3/trigger";
//This stores the Bright Data API endpoint used to start a scraping job.
const brightDataProgressUrl = "https://api.brightdata.com/datasets/v3/progress";
//Checking whether the scraping job has finished.
const brightDataSnapshotUrl = "https://api.brightdata.com/datasets/v3/snapshot";
//This endpoint is used to download the result after the scraping job is ready.

//This is a function that creates an object containing the HTTP headers needed when talking to Bright Data.
const getBrightDataHeaders = () => ({
  Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,

  //Bearer is a standard way of sending an authentication token in an HTTP Authorization header.
  "Content-Type": "application/json",
  //The body of my HTTP request is JSON
});

//Figure out the public URL of your backend API.
//Because in production, Bright Data needs to know:"Where should I send the scraped YouTube data when the scraping is finished?"
export const getApiUrl = () => {
  if (process.env.API_URL) {
    return process.env.API_URL;
  }

  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    return `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  }

  return "";
};
//Determine whether the backend is running locally or on a public server.
const isLocalApiUrl = () => {
  const apiUrl = getApiUrl();

  if (!apiUrl) {
    return false;
  }

  try {
    const parsedUrl = new URL(apiUrl);
    return ["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname);
  } catch {
    return false;
  }
};

export const shouldUseLocalBrightDataPolling = () => isLocalApiUrl();
//this function does NOT return the transcript.
//Take a YouTube URL, send it to Bright Data, start an asynchronous scraping job, and return the snapshot_id.
export const triggerYoutubeVideoScrape = async (url) => {
  if (!process.env.BRIGHTDATA_API_KEY) {
    throw new Error("Missing BRIGHTDATA_API_KEY environment variable.");
  }

  const apiUrl = getApiUrl();
//Because without url, Bright Data won't know where to send the scraped data when it's done.
  if (!apiUrl) {
    throw new Error("Missing API_URL environment variable.");
  }
//This creates the query parameters that will be attached to the Bright Data URL.
//query parameters are key-value pairs that are appended to the end of a URL after a question mark (?). They provide additional information to the server about the request being made.

  const params = new URLSearchParams({
    dataset_id:
      process.env.BRIGHTDATA_DATASET_ID || "gd_lk56epmy2i5g7lzu0k",
      //A dataset tells Bright Data what kind of scraping job you want.
      //in our case, we want to scrape YouTube videos and extract their transcripts.
  });

  if (!isLocalApiUrl()) {
    //telling brightdata When the scraping result is ready, send it to this endpoint."
    params.set("endpoint", `${apiUrl}/webhook`);
    //This configures how Bright Data sends the webhook payload.
    params.set("format", "json");
    //Return/send the result in JSON format.
    params.set("uncompressed_webhook", "true");
    params.set("include_errors", "true");
    //This tells Bright Data to include error information in the result if something went wrong.
  }
//This is where your backend actually sends the request to Bright Data.
//fetch() makes a network request to the Bright Data API endpoint, asking it to start scraping the YouTube video at the given URL.
  const response = await fetch(`${brightDataTriggerUrl}?${params.toString()}`, {
    method: "POST",
    headers: getBrightDataHeaders(),
    body: JSON.stringify([{ url, country: "" }]),
    //javaScript object needs to be converted into JSON text.
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bright Data trigger failed: ${errorText}`);
  }
//This converts the JSON response into a JavaScript object.
  const result = await response.json();
  return result.snapshot_id;
};
//Keep checking Bright Data until that scraping job is ready, failed, or times out.
export const waitForBrightDataSnapshot = async (
  snapshotId,
  { timeoutMs = 120000, pollIntervalMs = 3000 } = {}
  //Repeatedly asking a service whether something is ready ever 3000ms or 3 sec 
  // //Give Bright Data at most 12000 ms or 2 min minutes to become ready..
) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    //This sends a request to Bright Data's progress endpoint.
    const response = await fetch(`${brightDataProgressUrl}/${snapshotId}`, {
      headers: {
        Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bright Data progress check failed: ${errorText}`);
    }
//progress is a JavaScript object containing Bright Data's status information.
    const progress = await response.json();

    if (progress.status === "ready") {
      return progress;
    }

    if (progress.status === "failed") {
      throw new Error("Bright Data snapshot failed.");
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    //wait for 3 sec and while loop start again 
  }

  throw new Error("Timed out waiting for Bright Data snapshot to become ready.");
};
//Because fetch() uses GET by default when no method is specified.This sends a request to Bright Data.
//fetch(...)returns a Promise.So:await fetch(...)means:Wait for Bright Data's HTTP response before continuing.
//fetch() sends a request to Bright Data's snapshot endpoint, asking it to return the scraped data for the given snapshot ID in JSON format.
export const downloadBrightDataSnapshot = async (snapshotId) => {
  //response
// HTTP response
//   ├── status
//   ├── headers
//   └── body
  const response = await fetch(`${brightDataSnapshotUrl}/${snapshotId}?format=json`, {
    headers: {
      Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    //"Read the body of this HTTP response and give it to me as text."
    //But reading the response body is asynchronous, so it returns a Promise.
    //Now wait for the response body to be read as text. without await errorTest would simply be a promise 
    throw new Error(`Bright Data snapshot download failed: ${errorText}`);
  }

  return response.json();
};
