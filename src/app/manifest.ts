import type { MetadataRoute } from "next";

// minha versao: manifesto com a marca nova (Z com nucleo em ambar sobre grafite)
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "ZapHub",
        short_name: "ZapHub",
        description: "Atendimento de WhatsApp do NOC",
        start_url: "/dashboard",
        display: "standalone",
        background_color: "#0D0E10",
        theme_color: "#0D0E10",
        icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
    };
}
