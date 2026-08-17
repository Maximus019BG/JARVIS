import type { MetadataRoute } from "next";
import { ORIGIN_URL } from "~/config/url.ts";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${ORIGIN_URL}`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${ORIGIN_URL}/auth/(protected)`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${ORIGIN_URL}/auth/reset-password`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${ORIGIN_URL}/auth/verify-email`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${ORIGIN_URL}/auth/verify-2fa`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${ORIGIN_URL}/link`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    },
  ];
}
