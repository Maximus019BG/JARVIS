import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      { userAgent: "OAI-SearchBot", disallow: ["/"] },
      { userAgent: "OAI-ImageBot", disallow: ["/"] },

      // Security scanners and crawlers that are known to be malicious or abusive
      { userAgent: "CensysInspect", disallow: ["/"] },
      { userAgent: "Expanse", disallow: ["/"] },
      { userAgent: "internet-measurement", disallow: ["/"] },
      { userAgent: "Go-http-client", disallow: ["/"] },

      // Data collection and selling
      { userAgent: "BW/1.1", disallow: ["/"] },
      { userAgent: "Dalvik/2.1.0", disallow: ["/"] },
      
      //Unknown user agents that are known to be malicious or abusive
      { userAgent: "Orbbot", disallow: ["/"] },
      { userAgent: "Screaming Frog SEO Spider", disallow: ["/"] },
      { userAgent: "AhrefsBot", disallow: ["/"] },
      { userAgent: "SemrushBot", disallow: ["/"] },
      { userAgent: "MJ12bot", disallow: ["/"] },
    ],
  };
}
