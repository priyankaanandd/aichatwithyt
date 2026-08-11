const brightDataTriggerUrl = "https://api.brightdata.com/datasets/v3/trigger";
const brightDataProgressUrl = "https://api.brightdata.com/datasets/v3/progress";
const brightDataSnapshotUrl = "https://api.brightdata.com/datasets/v3/snapshot";

const getBrightDataHeaders = () => ({
  Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
  "Content-Type": "application/json",
});

export const getApiUrl = () => {
  if (process.env.API_URL) {
    return process.env.API_URL;
  }

  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    return `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
  }

  return "";
};

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

export const triggerYoutubeVideoScrape = async (url) => {
  if (!process.env.BRIGHTDATA_API_KEY) {
    throw new Error("Missing BRIGHTDATA_API_KEY environment variable.");
  }

  const apiUrl = getApiUrl();

  if (!apiUrl) {
    throw new Error("Missing API_URL environment variable.");
  }

  const params = new URLSearchParams({
    dataset_id:
      process.env.BRIGHTDATA_DATASET_ID || "gd_lk56epmy2i5g7lzu0k",
  });

  if (!isLocalApiUrl()) {
    params.set("endpoint", `${apiUrl}/webhook`);
    params.set("format", "json");
    params.set("uncompressed_webhook", "true");
    params.set("include_errors", "true");
  }

  const response = await fetch(`${brightDataTriggerUrl}?${params.toString()}`, {
    method: "POST",
    headers: getBrightDataHeaders(),
    body: JSON.stringify([{ url, country: "" }]),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bright Data trigger failed: ${errorText}`);
  }

  const result = await response.json();
  return result.snapshot_id;
};

export const waitForBrightDataSnapshot = async (
  snapshotId,
  { timeoutMs = 120000, pollIntervalMs = 3000 } = {}
) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${brightDataProgressUrl}/${snapshotId}`, {
      headers: {
        Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bright Data progress check failed: ${errorText}`);
    }

    const progress = await response.json();

    if (progress.status === "ready") {
      return progress;
    }

    if (progress.status === "failed") {
      throw new Error("Bright Data snapshot failed.");
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("Timed out waiting for Bright Data snapshot to become ready.");
};

export const downloadBrightDataSnapshot = async (snapshotId) => {
  const response = await fetch(`${brightDataSnapshotUrl}/${snapshotId}?format=json`, {
    headers: {
      Authorization: `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bright Data snapshot download failed: ${errorText}`);
  }

  return response.json();
};
