import { addNotificationListeners, registerForPushNotificationsAsync } from "@/hooks/use-notifications";
import { API_URL, BASE_URL, APP_RETURN_SCHEME } from "@/lib/constants";
import * as Linking from "expo-linking";
import React, { useCallback,  useRef, useState } from "react";
import { WebView } from "react-native-webview";

export default function HomeScreen() {
    const webviewRef = useRef<WebView | null>(null);
    const [currentUrl, setCurrentUrl] = useState<string>("");

    // Setup notifications: get permission, token, and listeners
    const SetNotifications = async () => {
        async function setupNotifications() {
            const token = await registerForPushNotificationsAsync();
            if (token) {
                try {
                    await fetch(`${API_URL}/mobile/notifications`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ expoToken: token }),
                    });
                } catch (error) {
                    console.error("[HomeScreen] Notification request failed:", error);
                }
            }
        }

        setupNotifications();
        return addNotificationListeners();
    };

    // Handle incoming deep links (from Google redirect)
    const handleDeepLink = useCallback((event: { url: string }) => {
        const { url } = event;
        if (url.startsWith(APP_RETURN_SCHEME)) {
            try {
                const query = url.split("?")[1];
                const params = query ? Object.fromEntries(new URLSearchParams(query)) : {};
                const queryString = new URLSearchParams(params).toString();
                console.log("[Deep Link Received]", params);

                if (!params.code) {
                    if (webviewRef.current) {
                        webviewRef.current.injectJavaScript(`document.cookie.split(';').forEach(c => document.cookie = c.replace(/^\\s*[^=]+\\s*=\\s*[^;]*;?/, ''));`);
                    }
                    console.warn("[Deep Link] No code parameter found");
                    return;
                }

                if (webviewRef.current) {
                    console.log("[Injecting JS into WebView to complete auth]");
                    console.log(`${BASE_URL}/api/auth/callback/google?${queryString}&mobile=true`);

                    webviewRef.current.injectJavaScript(`window.location.href = "${BASE_URL}/api/auth/callback/google?${queryString}&mobile=true"; true;`);

                    //Notifications setup after redirect from the callback
                    setTimeout(() => {
                        if (currentUrl.includes("/dashboard")) {
                            SetNotifications();
                        }
                    }, 2000); // 2 seconds
                }
            } catch (err) {
                console.error("[Deep Link Parse Error]", err);
            }
        }
    }, [currentUrl]);

    // Track WebView navigation
    const handleNavigationStateChange = useCallback((navState: { url: string }) => {
        setCurrentUrl(navState.url);
        console.log("[WebView Navigation]", navState.url);
        
        // Setup notifications when reaching dashboard
        if (navState.url.includes("/dashboard")) {
            SetNotifications();
        }
    }, []);

    // ...existing code...

    // Intercept WebView navigation (detect Google login clicks)
    const handleShouldStartLoadWithRequest = useCallback((request: { url: string }) => {
        const { url } = request;

        // When your backend redirects to your custom scheme (deep link)
        if (url.startsWith(APP_RETURN_SCHEME)) {
            if (webviewRef.current) webviewRef.current.stopLoading();

            console.log("[Redirect Detected in WebView]", url);
            Linking.openURL(url).catch((err) => console.error("Failed to open deep link:", err));
            return false;
        }

        // When user clicks "Continue with Google" — stop WebView and open browser
        if (url.includes("accounts.google.com") || url.includes("/auth/google")) {
            if (webviewRef.current) webviewRef.current.stopLoading();

            console.log("[Intercepted Google Login Click]", url);
            Linking.openURL(url).catch((err) => console.error("Failed to open Google login in browser:", err));
            return false; // prevent navigation inside WebView
        }

        return true; // allow other navigation
    }, []);

    return (
        <WebView
            ref={webviewRef}
            source={{
                uri: `${BASE_URL}/auth/sign-in`,
            }}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            originWhitelist={["*"]}
            javaScriptEnabled
            domStorageEnabled
            onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
            onNavigationStateChange={handleNavigationStateChange}
            style={{ marginTop: 40 }}
        />
    );
}