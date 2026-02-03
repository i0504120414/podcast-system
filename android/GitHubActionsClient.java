package de.danoeh.antennapod.net.common;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Client for GitHub Actions-based podcast proxy system.
 * Triggers workflows and polls for results.
 */
public class GitHubActionsClient {
    private static final String TAG = "GitHubActionsClient";
    
    // Configure these for your repository
    private static final String GITHUB_OWNER = "i0504120414";
    private static final String GITHUB_REPO = "podcast-system";
    private static final String GITHUB_TOKEN = ""; // Set via setGitHubToken()
    
    // GitHub Pages URL for reading data
    private static final String PAGES_BASE_URL = "https://" + GITHUB_OWNER + ".github.io/" + GITHUB_REPO;
    
    // GitHub API URL for triggering actions
    private static final String API_BASE_URL = "https://api.github.com/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO;
    
    private static String githubToken = GITHUB_TOKEN;
    private static OkHttpClient client;
    
    public static void setGitHubToken(String token) {
        githubToken = token;
    }
    
    private static OkHttpClient getClient() {
        if (client == null) {
            client = new OkHttpClient.Builder()
                    .connectTimeout(30, TimeUnit.SECONDS)
                    .readTimeout(30, TimeUnit.SECONDS)
                    .build();
        }
        return client;
    }
    
    /**
     * Generate a unique request ID for tracking
     */
    public static String generateRequestId() {
        return UUID.randomUUID().toString().substring(0, 8) + "-" + System.currentTimeMillis();
    }
    
    /**
     * Get data from GitHub Pages (cached/static data)
     */
    public static void getData(String path, DataCallback callback) {
        String url = PAGES_BASE_URL + path;
        Log.d(TAG, "GET: " + url);
        
        Request request = new Request.Builder()
                .url(url)
                .header("Accept", "application/json")
                .build();
        
        getClient().newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                Log.e(TAG, "GET failed: " + e.getMessage());
                runOnMainThread(() -> callback.onError(e.getMessage()));
            }
            
            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (response.isSuccessful()) {
                    String body = response.body().string();
                    runOnMainThread(() -> callback.onSuccess(body));
                } else {
                    runOnMainThread(() -> callback.onError("HTTP " + response.code()));
                }
            }
        });
    }
    
    /**
     * Trigger a GitHub Action and poll for results
     */
    public static void triggerAction(String eventType, JSONObject payload, String requestId, ActionCallback callback) {
        if (githubToken == null || githubToken.isEmpty()) {
            callback.onError("GitHub token not configured");
            return;
        }
        
        try {
            // Add request ID to payload
            payload.put("request_id", requestId);
            
            JSONObject dispatchBody = new JSONObject();
            dispatchBody.put("event_type", eventType);
            dispatchBody.put("client_payload", payload);
            
            String url = API_BASE_URL + "/dispatches";
            Log.d(TAG, "Triggering action: " + eventType);
            
            Request request = new Request.Builder()
                    .url(url)
                    .header("Accept", "application/vnd.github+json")
                    .header("Authorization", "Bearer " + githubToken)
                    .post(RequestBody.create(dispatchBody.toString(), MediaType.parse("application/json")))
                    .build();
            
            getClient().newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    Log.e(TAG, "Trigger failed: " + e.getMessage());
                    runOnMainThread(() -> callback.onError(e.getMessage()));
                }
                
                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    if (response.code() == 204 || response.code() == 200) {
                        Log.d(TAG, "Action triggered, polling for results...");
                        // Start polling for results
                        pollForResults(requestId, callback, 0);
                    } else {
                        String body = response.body() != null ? response.body().string() : "";
                        Log.e(TAG, "Trigger failed: " + response.code() + " - " + body);
                        runOnMainThread(() -> callback.onError("HTTP " + response.code()));
                    }
                }
            });
            
        } catch (Exception e) {
            callback.onError(e.getMessage());
        }
    }
    
    /**
     * Poll GitHub Pages for action results
     */
    private static void pollForResults(String requestId, ActionCallback callback, int attempt) {
        if (attempt > 60) { // Max 60 attempts (2 minutes with 2 second intervals)
            runOnMainThread(() -> callback.onError("Timeout waiting for results"));
            return;
        }
        
        String url = PAGES_BASE_URL + "/data/requests/" + requestId + ".json";
        
        Request request = new Request.Builder()
                .url(url)
                .header("Cache-Control", "no-cache")
                .build();
        
        getClient().newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                // Retry after delay
                scheduleRetry(requestId, callback, attempt);
            }
            
            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (response.isSuccessful()) {
                    String body = response.body().string();
                    Log.d(TAG, "Got results: " + body.substring(0, Math.min(100, body.length())));
                    runOnMainThread(() -> callback.onSuccess(body));
                } else if (response.code() == 404) {
                    // Not ready yet, retry
                    scheduleRetry(requestId, callback, attempt);
                } else {
                    runOnMainThread(() -> callback.onError("HTTP " + response.code()));
                }
            }
        });
    }
    
    private static void scheduleRetry(String requestId, ActionCallback callback, int attempt) {
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            pollForResults(requestId, callback, attempt + 1);
        }, 2000); // 2 second delay
    }
    
    private static void runOnMainThread(Runnable runnable) {
        new Handler(Looper.getMainLooper()).post(runnable);
    }
    
    // === Convenience methods ===
    
    /**
     * Get top podcasts for a country
     */
    public static void getTopPodcasts(String country, DataCallback callback) {
        getData("/data/top_" + country + ".json", callback);
    }
    
    /**
     * Get lookup data for an iTunes ID
     */
    public static void getLookup(String itunesId, DataCallback callback) {
        getData("/data/lookups/" + itunesId + ".json", callback);
    }
    
    /**
     * Get all lookups
     */
    public static void getAllLookups(DataCallback callback) {
        getData("/data/all_lookups.json", callback);
    }
    
    /**
     * Get subscriptions list
     */
    public static void getSubscriptions(DataCallback callback) {
        getData("/data/subscriptions.json", callback);
    }
    
    /**
     * Get episodes for a podcast
     */
    public static void getEpisodes(String podcastId, DataCallback callback) {
        getData("/data/episodes/" + podcastId + "/list.json", callback);
    }
    
    /**
     * Trigger a search
     */
    public static void search(String query, ActionCallback callback) {
        try {
            String requestId = generateRequestId();
            JSONObject payload = new JSONObject();
            payload.put("query", query);
            payload.put("limit", 25);
            triggerAction("search", payload, requestId, callback);
        } catch (Exception e) {
            callback.onError(e.getMessage());
        }
    }
    
    /**
     * Subscribe to a podcast
     */
    public static void subscribe(String feedUrl, String podcastId, String title, ActionCallback callback) {
        try {
            String requestId = generateRequestId();
            JSONObject payload = new JSONObject();
            payload.put("feed_url", feedUrl);
            payload.put("podcast_id", podcastId);
            payload.put("podcast_title", title);
            triggerAction("subscribe", payload, requestId, callback);
        } catch (Exception e) {
            callback.onError(e.getMessage());
        }
    }
    
    /**
     * Download an episode
     */
    public static void downloadEpisode(String episodeUrl, String episodeId, String podcastId, ActionCallback callback) {
        try {
            String requestId = generateRequestId();
            JSONObject payload = new JSONObject();
            payload.put("episode_url", episodeUrl);
            payload.put("episode_id", episodeId);
            payload.put("podcast_id", podcastId);
            triggerAction("download", payload, requestId, callback);
        } catch (Exception e) {
            callback.onError(e.getMessage());
        }
    }
    
    // === Callbacks ===
    
    public interface DataCallback {
        void onSuccess(String jsonData);
        void onError(String error);
    }
    
    public interface ActionCallback {
        void onSuccess(String jsonResult);
        void onError(String error);
    }
}
