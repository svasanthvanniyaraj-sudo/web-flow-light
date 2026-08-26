import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import markup from "@/legacy/ecoconnect.html?raw";
import "@/legacy/ecoconnect.css";
import { initEcoConnect } from "@/legacy/ecoconnect-app";
import coverAsset from "@/assets/eco-cover.jpg.asset.json";
import artAsset from "@/assets/eco-art.jpg.asset.json";

const html = markup.replaceAll("__COVER__", coverAsset.url).replaceAll("__ART__", artAsset.url);

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EcoConnect — Report Pollution in Virudhunagar District" },
      {
        name: "description",
        content:
          "Report water waste, air pollution, land pollution and wire hazards across Virudhunagar district with photo, video and live-location proof.",
      },
      { property: "og:title", content: "EcoConnect — Water | Air | Land | Wire" },
      {
        property: "og:description",
        content:
          "A citizen-powered environmental reporting platform for a cleaner Virudhunagar. Connect · Report · Protect.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  component: Index,
});

function Index() {
  useEffect(() => initEcoConnect(), []);

  return <div id="ecoconnect-root" dangerouslySetInnerHTML={{ __html: html }} />;
}
